/**
 * Auto-Reply Routes
 * API endpoints for auto-reply rules
 */

const express = require('express');
const router = express.Router();
const AutoReply = require('../models/AutoReply');

/**
 * GET /api/auto-replies
 * Get all auto-reply rules
 */
router.get('/', async (req, res) => {
    try {
        const clientId = req.query.clientId || 1;
        const rules = await AutoReply.getAll(clientId);
        res.json({ success: true, data: rules });
    } catch (error) {
        console.error('Error fetching auto-replies:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/auto-replies/:id
 * Get a specific rule
 */
router.get('/:id', async (req, res) => {
    try {
        const rule = await AutoReply.getById(req.params.id);
        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }
        res.json({ success: true, data: rule });
    } catch (error) {
        console.error('Error fetching auto-reply:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/auto-replies
 * Create a new rule
 */
router.post('/', async (req, res) => {
    try {
        const { trigger_word, reply_message, match_type, is_active } = req.body;
        const clientId = req.body.client_id || 1;

        if (!trigger_word || !reply_message) {
            return res.status(400).json({
                success: false,
                error: 'trigger_word and reply_message are required'
            });
        }

        const rule = await AutoReply.create({
            client_id: clientId,
            trigger_word,
            reply_message,
            match_type: match_type || 'contains',
            is_active: is_active !== false
        });

        res.status(201).json({ success: true, data: rule });
    } catch (error) {
        console.error('Error creating auto-reply:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/auto-replies/:id
 * Update a rule
 */
router.put('/:id', async (req, res) => {
    try {
        const { trigger_word, reply_message, match_type, is_active } = req.body;

        const rule = await AutoReply.update(req.params.id, {
            trigger_word,
            reply_message,
            match_type,
            is_active
        });

        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }

        res.json({ success: true, data: rule });
    } catch (error) {
        console.error('Error updating auto-reply:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/auto-replies/:id
 * Delete a rule
 */
router.delete('/:id', async (req, res) => {
    try {
        const rule = await AutoReply.delete(req.params.id);

        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }

        res.json({ success: true, message: 'Rule deleted' });
    } catch (error) {
        console.error('Error deleting auto-reply:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/auto-replies/:id/toggle
 * Toggle rule active status
 */
router.post('/:id/toggle', async (req, res) => {
    try {
        const rule = await AutoReply.toggle(req.params.id);

        if (!rule) {
            return res.status(404).json({ success: false, error: 'Rule not found' });
        }

        res.json({ success: true, data: rule });
    } catch (error) {
        console.error('Error toggling auto-reply:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
