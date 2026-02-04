// Webhook Logs API Routes
const express = require('express');
const router = express.Router();
const WebhookLog = require('../models/WebhookLog');
const { pool } = require('../config/database');

// Get all webhook logs with filters
router.get('/', async (req, res) => {
    try {
        const { profile_id, webhook_type, limit = 100, offset = 0 } = req.query;

        const logs = await WebhookLog.getAll({
            profile_id: profile_id ? parseInt(profile_id) : null,
            webhook_type,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        console.error('Error fetching webhook logs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get webhook stats by profile
router.get('/stats', async (req, res) => {
    try {
        const stats = await WebhookLog.getStatsByProfile();

        // Also get total counts
        const totalQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN webhook_type = 'incoming_message' THEN 1 ELSE 0 END) as incoming,
                SUM(CASE WHEN webhook_type = 'unread_message' THEN 1 ELSE 0 END) as unread,
                SUM(CASE WHEN webhook_type = 'read_no_reply' THEN 1 ELSE 0 END) as read_no_reply
            FROM webhook_logs
            WHERE created_at >= NOW() - INTERVAL '48 hours'
        `;
        const totalResult = await pool.query(totalQuery);

        res.json({
            success: true,
            data: {
                byProfile: stats,
                totals: totalResult.rows[0]
            }
        });
    } catch (error) {
        console.error('Error fetching webhook stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get single webhook log
router.get('/:id', async (req, res) => {
    try {
        const log = await WebhookLog.getById(req.params.id);

        if (!log) {
            return res.status(404).json({
                success: false,
                error: 'Webhook log not found'
            });
        }

        res.json({
            success: true,
            data: log
        });
    } catch (error) {
        console.error('Error fetching webhook log:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get profiles for dropdown
router.get('/profiles/list', async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT 
                c.id,
                c.device_name,
                c.phone_number,
                c.webhook_url
            FROM clients c
            WHERE c.webhook_url IS NOT NULL AND c.webhook_url != ''
            ORDER BY c.device_name
        `;
        const result = await pool.query(query);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error('Error fetching profiles:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
