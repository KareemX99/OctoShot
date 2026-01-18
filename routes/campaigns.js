/**
 * Campaign Routes
 * REST API endpoints for campaign management
 */

const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const CampaignQueue = require('../services/campaignQueue');

// ==================== CAMPAIGNS CRUD ====================

/**
 * POST /api/campaigns
 * Create a new campaign
 */
router.post('/', async (req, res) => {
    try {
        const { device_id, name, type, ...rest } = req.body;

        if (!device_id || !name) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: device_id, name'
            });
        }

        if (type && !['single', 'sequential'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Type must be "single" or "sequential"'
            });
        }

        const campaign = await Campaign.create({ device_id, name, type, ...rest });

        res.status(201).json({
            success: true,
            campaign
        });
    } catch (error) {
        console.error('Create campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/campaigns
 * Get all campaigns (optionally filter by device)
 */
router.get('/', async (req, res) => {
    try {
        const { device_id, status, type, limit, offset } = req.query;

        let campaigns;

        if (device_id) {
            // Get campaigns for specific device
            campaigns = await Campaign.getAll(device_id, { status, type, limit, offset });
        } else {
            // Get all campaigns globally
            campaigns = await Campaign.getAllGlobal({ status, type, limit, offset });
        }

        res.json({
            success: true,
            data: campaigns,
            campaigns, // Keep for backwards compatibility
            count: campaigns.length
        });
    } catch (error) {
        console.error('Get campaigns error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/campaigns/:id
 * Get campaign by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const campaign = await Campaign.getById(req.params.id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                error: 'Campaign not found'
            });
        }

        res.json({ success: true, campaign });
    } catch (error) {
        console.error('Get campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/campaigns/:id/device-stats
 * Get per-device statistics for a campaign
 */
router.get('/:id/device-stats', async (req, res) => {
    console.log(`📊 Getting device stats for campaign ${req.params.id}`);
    try {
        const deviceStats = await Campaign.getPerDeviceStats(req.params.id);
        console.log(`📊 Device stats result: ${deviceStats.length} devices`);

        res.json({
            success: true,
            deviceStats
        });
    } catch (error) {
        console.error('Get device stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/campaigns/:id
 * Update campaign
 */
router.put('/:id', async (req, res) => {
    try {
        const campaign = await Campaign.update(req.params.id, req.body);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                error: 'Campaign not found'
            });
        }

        res.json({ success: true, campaign });
    } catch (error) {
        console.error('Update campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/campaigns/:id
 * Delete campaign
 */
router.delete('/:id', async (req, res) => {
    try {
        const campaign = await Campaign.delete(req.params.id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                error: 'Campaign not found'
            });
        }

        res.json({ success: true, message: 'Campaign deleted successfully' });
    } catch (error) {
        console.error('Delete campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== STEPS ====================

/**
 * POST /api/campaigns/:id/steps
 * Add step to campaign
 */
router.post('/:id/steps', async (req, res) => {
    try {
        const { message_type, content, media_url, filename, delay_seconds, use_spintax } = req.body;

        if (!message_type) {
            return res.status(400).json({
                success: false,
                error: 'message_type is required'
            });
        }

        const validTypes = ['text', 'image', 'video', 'audio', 'document'];
        if (!validTypes.includes(message_type)) {
            return res.status(400).json({
                success: false,
                error: `message_type must be one of: ${validTypes.join(', ')}`
            });
        }

        // Text messages require content
        if (message_type === 'text' && !content) {
            return res.status(400).json({
                success: false,
                error: 'content is required for text messages'
            });
        }

        // Media messages require media_url
        if (['image', 'video', 'audio', 'document'].includes(message_type) && !media_url) {
            return res.status(400).json({
                success: false,
                error: 'media_url is required for media messages'
            });
        }

        const step = await Campaign.addStep(req.params.id, {
            message_type, content, media_url, filename, delay_seconds, use_spintax
        });

        res.status(201).json({ success: true, step });
    } catch (error) {
        console.error('Add step error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/campaigns/:id/steps
 * Get all steps for a campaign
 */
router.get('/:id/steps', async (req, res) => {
    try {
        const steps = await Campaign.getSteps(req.params.id);
        res.json({ success: true, steps });
    } catch (error) {
        console.error('Get steps error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/campaigns/:id/steps/:stepId
 * Update step
 */
router.put('/:id/steps/:stepId', async (req, res) => {
    try {
        const step = await Campaign.updateStep(req.params.stepId, req.body);

        if (!step) {
            return res.status(404).json({
                success: false,
                error: 'Step not found'
            });
        }

        res.json({ success: true, step });
    } catch (error) {
        console.error('Update step error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/campaigns/:id/steps/:stepId
 * Remove step
 */
router.delete('/:id/steps/:stepId', async (req, res) => {
    try {
        const step = await Campaign.removeStep(req.params.stepId);

        if (!step) {
            return res.status(404).json({
                success: false,
                error: 'Step not found'
            });
        }

        res.json({ success: true, message: 'Step removed successfully' });
    } catch (error) {
        console.error('Remove step error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== RECIPIENTS ====================

/**
 * POST /api/campaigns/:id/recipients
 * Add recipients to campaign
 */
router.post('/:id/recipients', async (req, res) => {
    try {
        const { recipients } = req.body;

        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'recipients array is required'
            });
        }

        const enrollments = await Campaign.addRecipients(req.params.id, recipients);

        res.status(201).json({
            success: true,
            added: enrollments.length,
            enrollments
        });
    } catch (error) {
        console.error('Add recipients error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/campaigns/:id/enrollments
 * Get enrollments for a campaign
 */
router.get('/:id/enrollments', async (req, res) => {
    try {
        const { status, limit } = req.query;
        const enrollments = await Campaign.getEnrollments(req.params.id, { status, limit });

        res.json({
            success: true,
            enrollments,
            count: enrollments.length
        });
    } catch (error) {
        console.error('Get enrollments error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== CAMPAIGN CONTROL ====================

/**
 * POST /api/campaigns/:id/start
 * Start a campaign
 */
router.post('/:id/start', async (req, res) => {
    try {
        const campaign = await Campaign.getById(req.params.id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                error: 'Campaign not found'
            });
        }

        // Validate campaign has steps
        const steps = await Campaign.getSteps(req.params.id);
        if (steps.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Campaign must have at least one step'
            });
        }

        // Validate campaign has recipients
        const enrollments = await Campaign.getEnrollments(req.params.id, { limit: 1 });
        if (enrollments.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Campaign must have at least one recipient'
            });
        }

        const updatedCampaign = await Campaign.start(req.params.id);

        if (!updatedCampaign) {
            return res.status(400).json({
                success: false,
                error: 'Campaign cannot be started (check current status)'
            });
        }

        // Queue jobs for all enrollments via pg-boss
        const result = await CampaignQueue.startCampaign(parseInt(req.params.id));

        res.json({
            success: true,
            message: `Campaign started - ${result.queued} messages queued`,
            campaign: updatedCampaign,
            queued: result.queued
        });
    } catch (error) {
        console.error('Start campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/campaigns/:id/pause
 * Pause a running campaign
 */
router.post('/:id/pause', async (req, res) => {
    try {
        const campaign = await Campaign.pause(req.params.id);

        if (!campaign) {
            return res.status(400).json({
                success: false,
                error: 'Campaign not found or not running'
            });
        }

        // Pause via queue service
        await CampaignQueue.pauseCampaign(parseInt(req.params.id));

        res.json({
            success: true,
            message: 'Campaign paused',
            campaign
        });
    } catch (error) {
        console.error('Pause campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/campaigns/:id/resume
 * Resume a paused campaign
 */
router.post('/:id/resume', async (req, res) => {
    try {
        const campaign = await Campaign.resume(req.params.id);

        if (!campaign) {
            return res.status(400).json({
                success: false,
                error: 'Campaign not found or not paused'
            });
        }

        // Resume via queue service
        await CampaignQueue.resumeCampaign(parseInt(req.params.id));

        res.json({
            success: true,
            message: 'Campaign resumed',
            campaign
        });
    } catch (error) {
        console.error('Resume campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/campaigns/:id/cancel
 * Cancel a campaign
 */
router.post('/:id/cancel', async (req, res) => {
    try {
        const campaign = await Campaign.cancel(req.params.id);

        if (!campaign) {
            return res.status(400).json({
                success: false,
                error: 'Campaign not found or already completed'
            });
        }

        res.json({
            success: true,
            message: 'Campaign cancelled',
            campaign
        });
    } catch (error) {
        console.error('Cancel campaign error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== STATISTICS ====================

/**
 * GET /api/campaigns/:id/stats
 * Get campaign statistics
 */
router.get('/:id/stats', async (req, res) => {
    try {
        const stats = await Campaign.getStats(req.params.id);

        if (!stats) {
            return res.status(404).json({
                success: false,
                error: 'Campaign not found'
            });
        }

        res.json({ success: true, stats });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== RETRY & LABELS ====================

/**
 * POST /api/campaigns/:id/retry/:enrollmentId
 * Retry a failed message
 */
router.post('/:id/retry/:enrollmentId', async (req, res) => {
    try {
        const { id: campaignId, enrollmentId } = req.params;

        // Reset enrollment status to pending
        await Campaign.updateEnrollmentStatus(enrollmentId, 'pending');

        // Clear error in message log
        const { pool } = require('../config/database');
        await pool.query(`
            DELETE FROM campaign_message_log 
            WHERE enrollment_id = $1 AND status = 'failed'
        `, [enrollmentId]);

        // Queue it again
        const CampaignQueue = require('../services/campaignQueue');
        await CampaignQueue.queueSingleEnrollment(parseInt(campaignId), parseInt(enrollmentId));

        res.json({ success: true, message: 'Message queued for retry' });
    } catch (error) {
        console.error('Retry message error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/campaigns/enrollments/:enrollmentId/labels
 * Add a label to an enrollment
 */
router.post('/enrollments/:enrollmentId/labels', async (req, res) => {
    try {
        const { enrollmentId } = req.params;
        const { label } = req.body;

        if (!label) {
            return res.status(400).json({ success: false, error: 'Label is required' });
        }

        const { pool } = require('../config/database');

        // Add label to the JSONB labels array
        await pool.query(`
            UPDATE campaign_enrollments 
            SET labels = COALESCE(labels, '[]'::jsonb) || $1::jsonb
            WHERE id = $2
        `, [JSON.stringify([label]), enrollmentId]);

        res.json({ success: true, message: 'Label added' });
    } catch (error) {
        console.error('Add label error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/campaigns/enrollments/:enrollmentId/labels/:label
 * Remove a label from an enrollment
 */
router.delete('/enrollments/:enrollmentId/labels/:label', async (req, res) => {
    try {
        const { enrollmentId, label } = req.params;

        const { pool } = require('../config/database');

        // Remove label from JSONB array
        await pool.query(`
            UPDATE campaign_enrollments 
            SET labels = labels - $1
            WHERE id = $2
        `, [label, enrollmentId]);

        res.json({ success: true, message: 'Label removed' });
    } catch (error) {
        console.error('Remove label error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
