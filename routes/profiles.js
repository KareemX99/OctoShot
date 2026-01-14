/**
 * Profiles API Routes
 * Manage WhatsApp profiles/devices
 */

const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const whatsappManager = require('../whatsapp-manager');

/**
 * GET /api/profiles
 * List all profiles with their status
 */
router.get('/', async (req, res) => {
    try {
        const { search } = req.query;

        let profiles;
        if (search) {
            profiles = await Client.search(search);
        } else {
            profiles = await Client.getAll();
        }

        // Add real-time status from manager and sync database if needed
        const profilesWithStatus = await Promise.all(profiles.map(async (profile) => {
            const managerStatus = whatsappManager.getStatus(profile.id);

            // Determine actual status: manager takes priority if client exists
            let actualStatus = profile.status;
            if (whatsappManager.hasClient(profile.id)) {
                // Client exists in manager - use manager status
                actualStatus = managerStatus.connected ? 'connected' : managerStatus.status;
            } else if (profile.status === 'connected') {
                // Database says connected but no client running - it's stale, update DB
                await Client.updateStatus(profile.id, 'disconnected');
                actualStatus = 'disconnected';
            }

            return {
                ...profile,
                status: actualStatus,  // Use the corrected status
                realtime_status: managerStatus
            };
        }));

        const count = await Client.getCount();

        res.json({
            success: true,
            data: profilesWithStatus,
            count,
            total: profiles.length
        });
    } catch (error) {
        console.error('Error fetching profiles:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/profiles/:id
 * Get single profile details
 */
router.get('/:id', async (req, res) => {
    try {
        const profile = await Client.getById(req.params.id);

        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        profile.realtime_status = whatsappManager.getStatus(profile.id);

        res.json({
            success: true,
            data: profile
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/profiles
 * Create new profile
 */
router.post('/', async (req, res) => {
    try {
        const { device_name, webhook_url } = req.body;

        const profile = await Client.create({
            device_name: device_name || 'New Device',
            webhook_url
        });

        res.status(201).json({
            success: true,
            data: profile,
            message: 'Profile created successfully'
        });
    } catch (error) {
        console.error('Error creating profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/profiles/:id
 * Update profile
 */
router.put('/:id', async (req, res) => {
    try {
        const { device_name, webhook_url, timezone } = req.body;

        const profile = await Client.update(req.params.id, {
            device_name,
            webhook_url,
            timezone
        });

        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({
            success: true,
            data: profile,
            message: 'Profile updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/profiles/:id
 * Delete profile and destroy session
 */
router.delete('/:id', async (req, res) => {
    try {
        // Destroy WhatsApp client if active
        if (whatsappManager.hasClient(parseInt(req.params.id))) {
            await whatsappManager.destroyClient(parseInt(req.params.id));
        }

        const profile = await Client.delete(req.params.id);

        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/profiles/:id/connect
 * Initialize WhatsApp connection for profile
 */
router.post('/:id/connect', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        // Validate profileId is a valid number
        if (isNaN(profileId) || profileId <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid profile ID'
            });
        }

        // Check if profile exists
        const profile = await Client.getById(profileId);
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        // Create WhatsApp client
        await whatsappManager.createClient(profileId);

        res.json({
            success: true,
            message: 'WhatsApp connection initiated. Scan QR code to connect.',
            profileId
        });
    } catch (error) {
        console.error('Error connecting profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/profiles/:id/disconnect
 * Disconnect WhatsApp session and clear session data
 */
router.post('/:id/disconnect', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        // Get profile to check it exists
        const profile = await Client.getById(profileId);
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        // Destroy WhatsApp client if active
        if (whatsappManager.hasClient(profileId)) {
            await whatsappManager.destroyClient(profileId);
        }

        // Delete local session folder
        const fs = require('fs').promises;
        const path = require('path');

        // Delete session folder from .wwebjs_auth
        const localSessionPath = path.join(__dirname, '..', '.wwebjs_auth', `session-profile_${profileId}`);
        try {
            await fs.rm(localSessionPath, { recursive: true, force: true });
            console.log(`🗑️ Local session folder deleted for profile ${profileId}`);
        } catch (e) {
            // Local session might not exist
        }

        // Delete backup file from .wwebjs_sessions_backup
        const backupPath = path.join(__dirname, '..', '.wwebjs_sessions_backup', `profile_${profileId}.tar.gz`);
        try {
            await fs.unlink(backupPath);
            console.log(`🗑️ Session backup deleted for profile ${profileId}`);
        } catch (e) {
            // Backup might not exist
        }

        // Update profile status in database
        await Client.updateStatus(profileId, 'disconnected');

        res.json({
            success: true,
            message: 'Profile disconnected and session data cleared successfully'
        });
    } catch (error) {
        console.error('Error disconnecting profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/profiles/:id/status
 * Get connection status for profile
 */
router.get('/:id/status', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        const status = whatsappManager.getStatus(profileId);

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/profiles/:id/qr
 * Get QR code for profile
 */
router.get('/:id/qr', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        const status = whatsappManager.getStatus(profileId);

        res.json({
            success: true,
            qrCode: status.qrCode,
            status: status.status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/profiles/:id/regenerate-key
 * Regenerate API key for profile
 */
router.post('/:id/regenerate-key', async (req, res) => {
    try {
        const profile = await Client.regenerateAPIKey(req.params.id);

        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({
            success: true,
            data: { api_key: profile.api_key },
            message: 'API key regenerated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/profiles/:id/send-message
 * Send message via specific profile
 */
router.post('/:id/send-message', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and message are required'
            });
        }

        const result = await whatsappManager.sendMessage(profileId, phoneNumber, message);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// UNREAD WEBHOOKS
// ==========================================

const UnreadWebhook = require('../models/UnreadWebhook');

/**
 * GET /api/profiles/:id/unread-webhooks
 * Get all unread webhooks for a profile
 */
router.get('/:id/unread-webhooks', async (req, res) => {
    try {
        const webhooks = await UnreadWebhook.getByClientId(req.params.id);
        res.json({
            success: true,
            data: webhooks,
            count: webhooks.length,
            maxAllowed: 5
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/profiles/:id/unread-webhooks
 * Add a new unread webhook
 */
router.post('/:id/unread-webhooks', async (req, res) => {
    try {
        const { webhook_url, timer_value, timer_unit } = req.body;

        if (!webhook_url || !timer_value || !timer_unit) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: webhook_url, timer_value, timer_unit'
            });
        }

        const webhook = await UnreadWebhook.create(
            req.params.id,
            webhook_url,
            parseInt(timer_value),
            timer_unit
        );

        res.json({
            success: true,
            data: webhook,
            message: 'Unread webhook added successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/profiles/:id/unread-webhooks/:webhookId
 * Update an unread webhook
 */
router.put('/:id/unread-webhooks/:webhookId', async (req, res) => {
    try {
        const { webhook_url, timer_value, timer_unit, is_active } = req.body;

        const webhook = await UnreadWebhook.update(
            req.params.webhookId,
            webhook_url,
            parseInt(timer_value),
            timer_unit,
            is_active !== undefined ? is_active : true
        );

        if (!webhook) {
            return res.status(404).json({
                success: false,
                error: 'Webhook not found'
            });
        }

        res.json({
            success: true,
            data: webhook,
            message: 'Unread webhook updated successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/profiles/:id/unread-webhooks/:webhookId
 * Delete an unread webhook
 */
router.delete('/:id/unread-webhooks/:webhookId', async (req, res) => {
    try {
        const webhook = await UnreadWebhook.delete(req.params.webhookId);

        if (!webhook) {
            return res.status(404).json({
                success: false,
                error: 'Webhook not found'
            });
        }

        res.json({
            success: true,
            message: 'Unread webhook deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// READ NO-REPLY WEBHOOKS
// ==========================================

const ReadNoReplyWebhook = require('../models/ReadNoReplyWebhook');

/**
 * GET /api/profiles/:id/read-no-reply-webhooks
 * Get all read-no-reply webhooks for a profile
 */
router.get('/:id/read-no-reply-webhooks', async (req, res) => {
    try {
        const webhooks = await ReadNoReplyWebhook.getByClientId(req.params.id);
        res.json({
            success: true,
            data: webhooks,
            count: webhooks.length,
            maxAllowed: 5
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/profiles/:id/read-no-reply-webhooks
 * Add a new read-no-reply webhook
 */
router.post('/:id/read-no-reply-webhooks', async (req, res) => {
    console.log('📝 POST /read-no-reply-webhooks called');
    console.log('   Profile ID:', req.params.id);
    console.log('   Body:', req.body);

    try {
        const { webhook_url, timer_value, timer_unit } = req.body;

        if (!webhook_url || !timer_value || !timer_unit) {
            console.log('❌ Missing required fields');
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: webhook_url, timer_value, timer_unit'
            });
        }

        console.log('   Creating webhook with:', { webhook_url, timer_value, timer_unit });

        const webhook = await ReadNoReplyWebhook.create(
            req.params.id,
            webhook_url,
            parseInt(timer_value),
            timer_unit
        );

        console.log('✅ Webhook created:', webhook);

        res.json({
            success: true,
            data: webhook,
            message: 'Read no-reply webhook created successfully'
        });
    } catch (error) {
        console.error('❌ Error creating webhook:', error.message);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/profiles/:id/read-no-reply-webhooks/:webhookId
 * Update a read-no-reply webhook
 */
router.put('/:id/read-no-reply-webhooks/:webhookId', async (req, res) => {
    try {
        const { webhook_url, timer_value, timer_unit, is_active } = req.body;

        const webhook = await ReadNoReplyWebhook.update(
            req.params.webhookId,
            webhook_url,
            parseInt(timer_value),
            timer_unit,
            is_active !== undefined ? is_active : true
        );

        if (!webhook) {
            return res.status(404).json({
                success: false,
                error: 'Webhook not found'
            });
        }

        res.json({
            success: true,
            data: webhook,
            message: 'Read no-reply webhook updated successfully'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/profiles/:id/read-no-reply-webhooks/:webhookId
 * Delete a read-no-reply webhook
 */
router.delete('/:id/read-no-reply-webhooks/:webhookId', async (req, res) => {
    try {
        const webhook = await ReadNoReplyWebhook.delete(req.params.webhookId);

        if (!webhook) {
            return res.status(404).json({
                success: false,
                error: 'Webhook not found'
            });
        }

        res.json({
            success: true,
            message: 'Read no-reply webhook deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==========================================
// USAGE LEVEL SYSTEM
// ==========================================

const usageLevelConfig = require('../services/usageLevelConfig');
const { query } = require('../config/database');

/**
 * GET /api/profiles/:id/usage-level
 * Get usage level details for a profile
 */
router.get('/:id/usage-level', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        const result = await query(`
            SELECT 
                id, usage_level, daily_limit, campaign_active_hours, 
                current_level_hours, questionnaire_completed, 
                last_warning_at, warning_count, current_level_started_at
            FROM clients WHERE id = $1
        `, [profileId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }

        const profile = result.rows[0];
        const levelConfig = usageLevelConfig.getConfig(profile.usage_level);
        const promotion = usageLevelConfig.checkPromotion(
            profile.usage_level,
            parseFloat(profile.current_level_hours) || 0
        );

        res.json({
            success: true,
            data: {
                current_level: profile.usage_level,
                level_name: levelConfig.name,
                level_name_en: levelConfig.nameEn,
                daily_limit: profile.daily_limit,
                color: levelConfig.color,
                emoji: levelConfig.emoji,
                campaign_active_hours: parseFloat(profile.campaign_active_hours) || 0,
                current_level_hours: parseFloat(profile.current_level_hours) || 0,
                questionnaire_completed: profile.questionnaire_completed,
                warning_count: profile.warning_count,
                last_warning_at: profile.last_warning_at,
                promotion_status: promotion,
                all_levels: usageLevelConfig.getAllLevels()
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/profiles/:id/usage-level/questionnaire-options
 * Get questionnaire options for UI
 */
router.get('/:id/usage-level/questionnaire-options', async (req, res) => {
    try {
        res.json({
            success: true,
            data: usageLevelConfig.getQuestionnaireOptions()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/profiles/:id/usage-questionnaire
 * Save usage questionnaire and set initial level
 */
router.post('/:id/usage-questionnaire', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        const { phoneAge, dailyMessageRate, usedSpamSoftware, previousBan } = req.body;

        // Validate required fields
        if (!phoneAge || !dailyMessageRate || !usedSpamSoftware || !previousBan) {
            return res.status(400).json({
                success: false,
                error: 'All questionnaire fields are required: phoneAge, dailyMessageRate, usedSpamSoftware, previousBan'
            });
        }

        const responses = { phoneAge, dailyMessageRate, usedSpamSoftware, previousBan };

        // Determine initial usage level
        const initialLevel = usageLevelConfig.determineInitialLevel(responses);
        const levelConfig = usageLevelConfig.getConfig(initialLevel);

        // Get current profile data
        const currentProfile = await query('SELECT usage_level FROM clients WHERE id = $1', [profileId]);
        if (currentProfile.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }

        const oldLevel = currentProfile.rows[0].usage_level || 1;

        // Update profile with questionnaire data and initial level
        await query(`
            UPDATE clients 
            SET 
                usage_questionnaire = $1,
                questionnaire_completed = TRUE,
                usage_level = $2,
                daily_limit = $3,
                current_level_started_at = CURRENT_TIMESTAMP,
                current_level_hours = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [JSON.stringify(responses), initialLevel, levelConfig.dailyLimit, profileId]);

        // Log level change
        await query(`
            INSERT INTO usage_level_history 
            (profile_id, old_level, new_level, old_daily_limit, new_daily_limit, reason, trigger_type, campaign_hours_at_change)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
        `, [
            profileId,
            oldLevel,
            initialLevel,
            usageLevelConfig.getDailyLimit(oldLevel),
            levelConfig.dailyLimit,
            'Initial level set from questionnaire',
            'questionnaire'
        ]);

        res.json({
            success: true,
            data: {
                usage_level: initialLevel,
                level_name: levelConfig.name,
                level_name_en: levelConfig.nameEn,
                daily_limit: levelConfig.dailyLimit,
                color: levelConfig.color,
                emoji: levelConfig.emoji
            },
            message: `Usage level set to ${levelConfig.name} (${levelConfig.dailyLimit} messages/day)`
        });
    } catch (error) {
        console.error('Error saving questionnaire:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/profiles/:id/report-ban
 * Report a ban/warning - demotes usage level
 */
router.post('/:id/report-ban', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);

        // Get current profile data
        const result = await query(`
            SELECT usage_level, daily_limit, campaign_active_hours, current_level_hours
            FROM clients WHERE id = $1
        `, [profileId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }

        const profile = result.rows[0];
        const currentLevel = profile.usage_level || 1;

        // Handle ban - demote level
        const demotion = usageLevelConfig.handleBan(currentLevel);

        // Update profile
        await query(`
            UPDATE clients 
            SET 
                usage_level = $1,
                daily_limit = $2,
                last_warning_at = CURRENT_TIMESTAMP,
                warning_count = warning_count + 1,
                current_level_started_at = CURRENT_TIMESTAMP,
                current_level_hours = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [demotion.newLevel, demotion.dailyLimit, profileId]);

        // Log level change
        await query(`
            INSERT INTO usage_level_history 
            (profile_id, old_level, new_level, old_daily_limit, new_daily_limit, reason, trigger_type, campaign_hours_at_change)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            profileId,
            currentLevel,
            demotion.newLevel,
            profile.daily_limit,
            demotion.dailyLimit,
            demotion.reason,
            'demotion',
            parseFloat(profile.campaign_active_hours) || 0
        ]);

        const levelConfig = usageLevelConfig.getConfig(demotion.newLevel);

        res.json({
            success: true,
            data: {
                previous_level: currentLevel,
                new_level: demotion.newLevel,
                level_name: levelConfig.name,
                level_name_en: levelConfig.nameEn,
                daily_limit: demotion.dailyLimit,
                color: levelConfig.color,
                emoji: levelConfig.emoji
            },
            message: `Level demoted to ${levelConfig.name} due to ban report`
        });
    } catch (error) {
        console.error('Error reporting ban:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/profiles/:id/usage-level/history
 * Get usage level history for a profile
 */
router.get('/:id/usage-level/history', async (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        const limit = parseInt(req.query.limit) || 20;

        const result = await query(`
            SELECT * FROM usage_level_history 
            WHERE profile_id = $1 
            ORDER BY created_at DESC 
            LIMIT $2
        `, [profileId, limit]);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

