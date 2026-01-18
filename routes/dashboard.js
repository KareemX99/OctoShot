/**
 * Dashboard Routes
 * API endpoints for dashboard statistics and data
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const whatsappManager = require('../whatsapp-manager');

/**
 * GET /api/dashboard/stats
 * Get all dashboard statistics
 */
router.get('/stats', async (req, res) => {
    try {
        // Get device/profile stats
        const deviceResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'connected') as connected,
                COUNT(*) FILTER (WHERE status != 'connected') as disconnected
            FROM clients
        `);
        const deviceStats = deviceResult.rows[0] || { total: 0, connected: 0, disconnected: 0 };

        // Get message stats from api_message_queue
        const messageResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'sent' OR status = 'delivered' OR status = 'read') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'pending' OR status = 'queued') as pending,
                COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today
            FROM api_message_queue
        `);
        const messageStats = messageResult.rows[0] || { total: 0, sent: 0, failed: 0, pending: 0, today: 0 };

        // Get chat message stats from messages table (personal chats)
        const chatMessageResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_from_me = true) as sent,
                COUNT(*) FILTER (WHERE is_from_me = false) as received,
                COUNT(*) FILTER (WHERE timestamp >= CURRENT_DATE) as today
            FROM messages
        `);
        const chatStats = chatMessageResult.rows[0] || { total: 0, sent: 0, received: 0, today: 0 };

        // Get campaign stats
        const campaignResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'running') as running,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                SUM(COALESCE(sent_count, 0)) as total_sent,
                SUM(COALESCE(failed_count, 0)) as total_failed
            FROM campaigns
        `);
        const campaignStats = campaignResult.rows[0] || { total: 0, running: 0, completed: 0, total_sent: 0, total_failed: 0 };

        // Get WhatsApp connection status (from whatsappManager)
        const allStatus = whatsappManager.getAllStatus();
        const connectedProfiles = Object.entries(allStatus).filter(([id, status]) => status.connected);
        const activeProfile = connectedProfiles[0];

        let connectionInfo = {
            status: 'disconnected',
            connected: false,
            phoneNumber: null,
            name: null,
            connectedCount: connectedProfiles.length,
            totalProfiles: Object.keys(allStatus).length
        };

        if (activeProfile) {
            const [profileId, profileStatus] = activeProfile;
            connectionInfo = {
                status: 'connected',
                connected: true,
                phoneNumber: profileStatus.info?.wid?.user || null,
                name: profileStatus.info?.pushname || null,
                connectedCount: connectedProfiles.length,
                totalProfiles: Object.keys(allStatus).length
            };
        }

        res.json({
            success: true,
            data: {
                devices: {
                    total: parseInt(deviceStats.total) || 0,
                    connected: parseInt(deviceStats.connected) || 0,
                    disconnected: parseInt(deviceStats.disconnected) || 0
                },
                messages: {
                    total: parseInt(messageStats.total) + parseInt(campaignStats.total_sent || 0) + parseInt(chatStats.total || 0),
                    sent: parseInt(messageStats.sent) + parseInt(campaignStats.total_sent || 0) + parseInt(chatStats.sent || 0),
                    received: parseInt(chatStats.received || 0),
                    failed: parseInt(messageStats.failed) + parseInt(campaignStats.total_failed || 0),
                    pending: parseInt(messageStats.pending) || 0,
                    today: parseInt(messageStats.today || 0) + parseInt(chatStats.today || 0)
                },
                campaigns: {
                    total: parseInt(campaignStats.total) || 0,
                    running: parseInt(campaignStats.running) || 0,
                    completed: parseInt(campaignStats.completed) || 0
                },
                connection: connectionInfo
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/dashboard/recent-messages
 * Get recent messages for dashboard
 */
router.get('/recent-messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        // Get recent SENT messages from both api_message_queue and messages tables
        // Join with clients to get device_name
        // Only show messages sent FROM the device (is_from_me = true)
        // Use ack column to determine status: 0-1=sent, 2=delivered, 3+=read
        // Clean phone numbers by removing WhatsApp suffixes
        const result = await pool.query(`
            (
                SELECT 
                    q.id,
                    REGEXP_REPLACE(q.recipient, '@(c\.us|g\.us|s\.whatsapp\.net|lid)$', '') as phone_number,
                    q.recipient LIKE '%@g.us' as is_group,
                    c.device_name,
                    COALESCE(q.message_type, 'text') as type,
                    q.status,
                    q.created_at,
                    'api' as source
                FROM api_message_queue q
                LEFT JOIN clients c ON q.device_id = c.id
                ORDER BY q.created_at DESC
                LIMIT $1
            )
            UNION ALL
            (
                SELECT 
                    m.id,
                    REGEXP_REPLACE(m.to_number, '@(c\.us|g\.us|s\.whatsapp\.net|lid)$', '') as phone_number,
                    m.to_number LIKE '%@g.us' as is_group,
                    c.device_name,
                    COALESCE(m.type, 'chat') as type,
                    CASE 
                        WHEN m.ack >= 3 THEN 'read'
                        WHEN m.ack = 2 THEN 'delivered'
                        WHEN m.ack >= 1 THEN 'sent'
                        ELSE 'pending'
                    END as status,
                    m.timestamp as created_at,
                    'chat' as source
                FROM messages m
                LEFT JOIN clients c ON m.client_id = c.id
                WHERE m.is_from_me = true
                ORDER BY m.timestamp DESC
                LIMIT $1
            )
            ORDER BY created_at DESC
            LIMIT $1
        `, [limit]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error fetching recent messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/dashboard/recent-chats
 * Get recent chats/campaigns for dashboard
 */
router.get('/recent-chats', async (req, res) => {
    try {
        // Get recent campaigns instead
        const result = await pool.query(`
            SELECT 
                id,
                name,
                status,
                sent_count,
                failed_count,
                total_recipients,
                created_at
            FROM campaigns
            ORDER BY created_at DESC
            LIMIT 5
        `);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error fetching recent campaigns:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
