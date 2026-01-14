/**
 * API Logs Routes
 * Endpoints for viewing message queue logs
 */

const express = require('express');
const router = express.Router();
const ApiMessageQueue = require('../models/ApiMessageQueue');
const Blacklist = require('../models/Blacklist');

/**
 * GET /api/logs
 * Get paginated message logs
 */
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const status = req.query.status || null;
        const device_id = req.query.device_id || null;
        const batch_id = req.query.batch_id || null;

        const messages = await ApiMessageQueue.getRecent(limit, offset, {
            status,
            device_id,
            batch_id
        });

        const stats = await ApiMessageQueue.getStats(device_id);

        res.json({
            success: true,
            messages,
            stats,
            pagination: { limit, offset }
        });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/logs/stats
 * Get queue statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const device_id = req.query.device_id || null;
        const stats = await ApiMessageQueue.getStats(device_id);
        const pending = await ApiMessageQueue.getPendingCount(device_id);

        res.json({
            success: true,
            stats,
            pendingCount: pending
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/logs/batch/:batchId
 * Get messages by batch ID
 */
router.get('/batch/:batchId', async (req, res) => {
    try {
        const messages = await ApiMessageQueue.getByBatchId(req.params.batchId);

        res.json({
            success: true,
            batchId: req.params.batchId,
            count: messages.length,
            messages
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/logs/blacklist
 * Get blacklisted numbers
 */
router.get('/blacklist', async (req, res) => {
    try {
        const device_id = req.query.device_id;
        if (!device_id) {
            return res.status(400).json({
                success: false,
                error: 'device_id is required'
            });
        }

        const blacklist = await Blacklist.getByDevice(device_id);

        res.json({
            success: true,
            count: blacklist.length,
            blacklist
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/logs/blacklist/:phone
 * Remove from blacklist
 */
router.delete('/blacklist/:phone', async (req, res) => {
    try {
        const device_id = req.query.device_id;
        if (!device_id) {
            return res.status(400).json({
                success: false,
                error: 'device_id is required'
            });
        }

        const removed = await Blacklist.remove(device_id, req.params.phone);

        res.json({
            success: true,
            removed: !!removed
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/logs/retry-failed
 * Retry all failed messages
 */
router.post('/retry-failed', async (req, res) => {
    try {
        const { pool } = require('../config/database');

        const result = await pool.query(`
            UPDATE api_message_queue 
            SET status = 'queued', 
                error_message = NULL, 
                scheduled_at = (NOW() AT TIME ZONE 'Africa/Cairo')
            WHERE status = 'failed'
            RETURNING id
        `);

        res.json({
            success: true,
            retriedCount: result.rows.length,
            message: `${result.rows.length} messages re-queued for retry`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/logs/retry/:id
 * Retry a single message
 */
router.post('/retry/:id', async (req, res) => {
    try {
        const { pool } = require('../config/database');

        const result = await pool.query(`
            UPDATE api_message_queue 
            SET status = 'queued', 
                error_message = NULL, 
                scheduled_at = (NOW() AT TIME ZONE 'Africa/Cairo')
            WHERE id = $1
            RETURNING *
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }

        res.json({
            success: true,
            message: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/logs/batches
 * Get all batches with stats
 */
router.get('/batches', async (req, res) => {
    try {
        const { pool } = require('../config/database');

        const result = await pool.query(`
            SELECT 
                batch_id,
                device_id,
                MIN(created_at) as created_at,
                COUNT(*) as total_messages,
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                MIN(scheduled_at) as first_scheduled,
                MAX(scheduled_at) as last_scheduled
            FROM api_message_queue
            GROUP BY batch_id, device_id
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            count: result.rows.length,
            batches: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/logs/batch/:batchId
 * Destroy a batch completely (remove from database)
 */
router.delete('/batch/:batchId', async (req, res) => {
    try {
        const { pool } = require('../config/database');

        // Get batch info before deleting
        const infoResult = await pool.query(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as already_sent
            FROM api_message_queue
            WHERE batch_id = $1
        `, [req.params.batchId]);

        const info = infoResult.rows[0];

        // Delete all messages in this batch
        const deleteResult = await pool.query(`
            DELETE FROM api_message_queue
            WHERE batch_id = $1
            RETURNING id
        `, [req.params.batchId]);

        res.json({
            success: true,
            batchId: req.params.batchId,
            deletedCount: deleteResult.rows.length,
            alreadySent: parseInt(info.already_sent) || 0,
            message: `Batch destroyed: ${deleteResult.rows.length} messages removed, ${info.already_sent || 0} were already sent`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
