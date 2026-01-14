/**
 * Dashboard Routes
 * API endpoints for dashboard statistics and data
 */

const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const AutoReply = require('../models/AutoReply');
const whatsappManager = require('../whatsapp-manager');

/**
 * GET /api/dashboard/stats
 * Get all dashboard statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;

        // Get message stats
        const messageStats = await Message.getStats(clientId);

        // Get contact stats
        const contactStats = await Contact.getCount(clientId);

        // Get auto-reply count
        const autoReplies = await AutoReply.getAll(clientId);
        const activeReplies = autoReplies.filter(r => r.is_active).length;

        // Get WhatsApp connection status (from first connected profile)
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(id => allStatus[id].connected);
        const waStatus = activeProfileId ? whatsappManager.getStatus(activeProfileId) : { status: 'disconnected', connected: false, info: null };

        res.json({
            success: true,
            data: {
                messages: {
                    total: parseInt(messageStats.total) || 0,
                    sent: parseInt(messageStats.sent) || 0,
                    received: parseInt(messageStats.received) || 0,
                    today: parseInt(messageStats.today) || 0,
                    withMedia: parseInt(messageStats.with_media) || 0
                },
                contacts: {
                    total: parseInt(contactStats.total) || 0,
                    blocked: parseInt(contactStats.blocked) || 0,
                    business: parseInt(contactStats.business) || 0
                },
                autoReplies: {
                    total: autoReplies.length,
                    active: activeReplies
                },
                connection: {
                    status: waStatus.status,
                    connected: waStatus.connected,
                    phoneNumber: waStatus.info?.wid?.user || null,
                    name: waStatus.info?.pushname || null
                }
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
        const clientId = req.query.clientId || 1;
        const limit = parseInt(req.query.limit) || 5;

        const messages = await Message.getRecent(clientId, limit);
        res.json({ success: true, data: messages });
    } catch (error) {
        console.error('Error fetching recent messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/dashboard/recent-chats
 * Get recent chats for dashboard
 */
router.get('/recent-chats', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;

        const chats = await Message.getChatsWithLastMessage(clientId);
        // Return only first 5 chats
        res.json({ success: true, data: chats.slice(0, 5) });
    } catch (error) {
        console.error('Error fetching recent chats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
