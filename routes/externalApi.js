/**
 * External API Routes (v1)
 * Authenticated API for external applications using UUID and API Token
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Client = require('../models/Client');
const ApiMessageQueue = require('../models/ApiMessageQueue');
const Blacklist = require('../models/Blacklist');
const spintax = require('../utils/spintax');
const whatsappManager = require('../whatsapp-manager');
const { MessageMedia } = require('whatsapp-web.js');
const trustLevelConfig = require('../services/trustLevelConfig');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * Authentication Middleware
 * Validates X-Device-UUID and X-API-Token headers
 */
async function authenticateDevice(req, res, next) {
    const uuid = req.headers['x-device-uuid'];
    const token = req.headers['x-api-token'];

    if (!uuid || !token) {
        return res.status(401).json({
            success: false,
            error: 'Missing authentication headers. Required: X-Device-UUID and X-API-Token'
        });
    }

    try {
        const device = await Client.getByUUID(uuid);

        if (!device) {
            return res.status(401).json({
                success: false,
                error: 'Device not found'
            });
        }

        if (device.api_key !== token) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API token'
            });
        }

        // Check if WhatsApp client is actually running and connected (not just database status)
        const clientStatus = whatsappManager.getStatus(device.id);
        if (!clientStatus.connected) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp is not connected. Please connect the device from the Profiles page first.'
            });
        }

        // Attach device to request
        req.device = device;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication error'
        });
    }
}

/**
 * Helper: Format phone number to WhatsApp ID
 */

/**
 * Helper: Format phone number to WhatsApp ID
 */
function formatPhoneNumber(phone) {
    // If usage specific suffixes are found, return as is
    if (phone.endsWith('@g.us') || phone.endsWith('@c.us')) {
        return phone;
    }

    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');

    // Add @c.us suffix
    return `${cleaned}@c.us`;
}

/**
 * Helper: Parse recipients (supports comma-separated)
 */
function parseRecipients(to) {
    if (!to) return [];
    return to.split(',')
        .map(p => p.trim())
        .filter(p => {
            // Allow groups
            if (p.endsWith('@g.us')) return true;
            // Otherwise must be valid number
            const cleaned = p.replace(/\D/g, '');
            return cleaned.length >= 10;
        })
        .map(p => {
            if (p.endsWith('@g.us')) return p;
            return p.replace(/\D/g, '');
        });
}

/**
 * Helper: Simulate typing before sending (anti-ban protection)
 * @param {Object} client - WhatsApp client
 * @param {string} chatId - Chat ID
 * @param {string} messageContent - Actual message content for duration calc
 * @returns {number} The typing duration used (in ms)
 */
async function simulateTyping(client, chatId, messageContent) {
    const typingDuration = trustLevelConfig.getTypingDuration(messageContent || '');
    try {
        const chat = await client.getChatById(chatId);
        if (chat) {
            // Mark as seen (safely - may fail for new chats)
            try {
                if (typeof chat.sendSeen === 'function') {
                    await chat.sendSeen();
                }
            } catch (seenError) {
                console.log(`⚠️ sendSeen skipped: ${seenError.message?.substring(0, 50) || 'unknown error'}`);
            }

            // Start typing (safely)
            try {
                await chat.sendStateTyping();
                console.log(`⌨️ API: Simulating typing for ${typingDuration}ms (${(messageContent || '').length} chars)`);
                await new Promise(resolve => setTimeout(resolve, typingDuration));
                await chat.clearState();
            } catch (typingError) {
                console.log(`⚠️ Typing state skipped: ${typingError.message?.substring(0, 50) || 'unknown error'}`);
            }
        } else {
            console.log(`📝 Skipping typing simulation - chat not found for ${chatId}`);
        }
    } catch (error) {
        console.log(`📝 Typing simulation error (continuing anyway): ${error.message?.substring(0, 50) || 'unknown error'}`);
    }
    return typingDuration;
}

/**
 * POST /api/v1/messages/send-text
 * Send a text message (supports bulk with comma-separated numbers)
 * Returns immediately with queued status - message is sent in background
 */
router.post('/messages/send-text', authenticateDevice, async (req, res) => {
    try {
        const { to, message } = req.body;

        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: to, message'
            });
        }

        const recipients = parseRecipients(to);

        if (recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid phone numbers provided'
            });
        }

        // Detect and remove duplicates
        const originalCount = recipients.length;
        const uniqueRecipients = [...new Set(recipients)];
        const duplicateCount = originalCount - uniqueRecipients.length;

        // Filter out blacklisted numbers
        const validRecipients = await Blacklist.filterBlacklisted(req.device.id, uniqueRecipients);

        if (validRecipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'All recipients are blacklisted'
            });
        }

        // Check if single or bulk
        if (validRecipients.length === 1) {
            // Single message - queue and return immediately
            const chatId = formatPhoneNumber(validRecipients[0]);
            const resolvedMessage = spintax.resolve(message);
            const tempMessageId = uuidv4(); // Temporary ID until sent

            // Create queue entry with 'queued' status
            const queueEntry = await ApiMessageQueue.create({
                batch_id: null,
                device_id: req.device.id,
                recipient: validRecipients[0],
                message_type: 'text',
                original_content: message,
                resolved_content: resolvedMessage,
                scheduled_at: new Date(),
                status: 'queued'
            });

            // RETURN IMMEDIATELY - message will be sent in background
            res.json({
                success: true,
                status: 'queued',
                queueId: queueEntry.id,
                to: chatId,
                messageLength: resolvedMessage.length,
                message: 'Message queued for sending'
            });

            // BACKGROUND: Send message asynchronously (after response)
            setImmediate(async () => {
                try {
                    const client = whatsappManager.getClient(req.device.id);
                    if (!client) {
                        console.error(`❌ No WhatsApp client for device ${req.device.id}`);
                        await ApiMessageQueue.updateStatus(queueEntry.id, 'failed', { error_message: 'WhatsApp client not available' });
                        return;
                    }

                    // Update status to 'sending'
                    await ApiMessageQueue.updateStatus(queueEntry.id, 'sending');

                    // Simulate typing
                    const typingDuration = await simulateTyping(client, chatId, resolvedMessage);

                    // Send the message
                    const result = await whatsappManager.sendMessage(req.device.id, chatId, resolvedMessage);

                    // Update queue entry with actual message ID and sent status
                    await ApiMessageQueue.updateStatus(queueEntry.id, 'sent', {
                        whatsapp_message_id: result.messageId,
                        sent_at: new Date()
                    });

                    console.log(`📤 Sent message ${queueEntry.id} via profile ${req.device.id} (typing: ${typingDuration}ms)`);
                } catch (error) {
                    console.error(`❌ Background send error for queue ${queueEntry.id}:`, error.message);
                    await ApiMessageQueue.updateStatus(queueEntry.id, 'failed', { error_message: error.message });
                }
            });
        } else {
            // Bulk - queue messages with smart batching
            const batchId = uuidv4();

            // Generate resolved messages for each recipient
            const resolvedMessages = validRecipients.map(() => spintax.resolve(message));

            // Get device trust level and timezone
            const trustLevel = req.device.trust_level || 1;
            const timezone = req.device.timezone || 'Africa/Cairo';

            // Queue messages with smart batching based on trust level
            const result = await ApiMessageQueue.createSmartBatches(
                batchId,
                req.device.id,
                validRecipients,
                'text',
                message,
                resolvedMessages,
                null,
                null,
                trustLevel,
                timezone
            );

            // Calculate estimated completion for all batches
            const totalMinutes = result.batchCount === 1
                ? Math.ceil((result.recipientCount * 15) / 60)
                : (result.batchCount - 1) * result.intervalHours * 60 + Math.ceil((result.messagesPerBatch * 15) / 60);

            res.json({
                success: true,
                mode: 'bulk',
                batchId: batchId,
                originalCount: originalCount,
                duplicateCount: duplicateCount,
                uniqueCount: uniqueRecipients.length,
                blacklistedCount: uniqueRecipients.length - validRecipients.length,
                recipientCount: result.recipientCount,
                batchCount: result.batchCount,
                messagesPerBatch: result.messagesPerBatch,
                intervalBetweenBatches: `${result.intervalHours} hours`,
                trustLevel: trustLevel,
                estimatedCompletionTime: totalMinutes < 60
                    ? `${totalMinutes} minutes`
                    : `${Math.ceil(totalMinutes / 60)} hours`,
                message: duplicateCount > 0
                    ? `Messages queued. ${duplicateCount} duplicate numbers removed.`
                    : 'Messages queued successfully - starting immediately'
            });
        }
    } catch (error) {
        console.error('Send text error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


/**
 * POST /api/v1/messages/send-image
 * Send an image message
 */
router.post('/messages/send-image', authenticateDevice, async (req, res) => {
    try {
        const { to, imageUrl, imageBase64, caption } = req.body;

        if (!to || (!imageUrl && !imageBase64)) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: to, imageUrl or imageBase64'
            });
        }

        const chatId = formatPhoneNumber(to);
        let media;

        if (imageBase64) {
            // Base64 image
            const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
                media = new MessageMedia(matches[1], matches[2]);
            } else {
                media = new MessageMedia('image/jpeg', imageBase64);
            }
        } else {
            // URL image
            media = await MessageMedia.fromUrl(imageUrl);
        }

        const client = whatsappManager.getClient(req.device.id);
        if (!client) throw new Error('WhatsApp client not available');

        // Simulate typing before sending
        await simulateTyping(client, chatId, caption?.length || 0);

        const result = await client.sendMessage(chatId, media, { caption });

        // Save to message queue for logging
        await ApiMessageQueue.create({
            batch_id: null,
            device_id: req.device.id,
            recipient: to,
            message_type: 'image',
            original_content: caption || '[Image]',
            resolved_content: caption || '[Image]',
            media_url: imageUrl || '[Base64]',
            caption: caption,
            scheduled_at: new Date(),
            status: 'sent',
            whatsapp_message_id: result.id._serialized,
            sent_at: new Date()
        });

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        });
    } catch (error) {
        console.error('Send image error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/v1/messages/send-document
 * Send a document/file
 */
router.post('/messages/send-document', authenticateDevice, async (req, res) => {
    try {
        const { to, documentUrl, documentBase64, filename, caption } = req.body;

        if (!to || (!documentUrl && !documentBase64)) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: to, documentUrl or documentBase64'
            });
        }

        const chatId = formatPhoneNumber(to);
        let media;

        if (documentBase64) {
            const mimetype = 'application/octet-stream';
            media = new MessageMedia(mimetype, documentBase64, filename);
        } else {
            media = await MessageMedia.fromUrl(documentUrl);
            if (filename) {
                media.filename = filename;
            }
        }

        const client = whatsappManager.getClient(req.device.id);
        if (!client) throw new Error('WhatsApp client not available');

        // Simulate typing before sending
        await simulateTyping(client, chatId, caption?.length || 0);

        const result = await client.sendMessage(chatId, media, {
            caption,
            sendMediaAsDocument: true
        });

        // Save to message queue for logging
        await ApiMessageQueue.create({
            batch_id: null,
            device_id: req.device.id,
            recipient: to,
            message_type: 'document',
            original_content: filename || '[Document]',
            resolved_content: filename || '[Document]',
            media_url: documentUrl || '[Base64]',
            caption: caption,
            scheduled_at: new Date(),
            status: 'sent',
            whatsapp_message_id: result.id._serialized,
            sent_at: new Date()
        });

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        });
    } catch (error) {
        console.error('Send document error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/v1/messages/send-audio
 * Send an audio message
 */
router.post('/messages/send-audio', authenticateDevice, async (req, res) => {
    try {
        const { to, audioUrl, audioBase64, ptt } = req.body;

        if (!to || (!audioUrl && !audioBase64)) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: to, audioUrl or audioBase64'
            });
        }

        const chatId = formatPhoneNumber(to);
        let media;

        if (audioBase64) {
            media = new MessageMedia('audio/ogg; codecs=opus', audioBase64);
        } else {
            media = await MessageMedia.fromUrl(audioUrl);
        }

        const client = whatsappManager.getClient(req.device.id);
        if (!client) throw new Error('WhatsApp client not available');

        // Simulate typing before sending (recording state for audio)
        await simulateTyping(client, chatId, 0);

        const result = await client.sendMessage(chatId, media, {
            sendAudioAsVoice: ptt === true
        });

        // Save to message queue for logging
        await ApiMessageQueue.create({
            batch_id: null,
            device_id: req.device.id,
            recipient: to,
            message_type: ptt ? 'ptt' : 'audio',
            original_content: '[Audio]',
            resolved_content: '[Audio]',
            media_url: audioUrl || '[Base64]',
            scheduled_at: new Date(),
            status: 'sent',
            whatsapp_message_id: result.id._serialized,
            sent_at: new Date()
        });

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        });
    } catch (error) {
        console.error('Send audio error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/v1/messages/send-video
 * Send a video message
 */
router.post('/messages/send-video', authenticateDevice, async (req, res) => {
    try {
        const { to, videoUrl, videoBase64, caption } = req.body;

        if (!to || (!videoUrl && !videoBase64)) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: to, videoUrl or videoBase64'
            });
        }

        const chatId = formatPhoneNumber(to);
        let media;

        if (videoBase64) {
            media = new MessageMedia('video/mp4', videoBase64);
        } else {
            media = await MessageMedia.fromUrl(videoUrl);
        }

        const client = whatsappManager.getClient(req.device.id);
        if (!client) throw new Error('WhatsApp client not available');

        // Simulate typing before sending
        await simulateTyping(client, chatId, caption?.length || 0);

        const result = await client.sendMessage(chatId, media, { caption });

        // Save to message queue for logging
        await ApiMessageQueue.create({
            batch_id: null,
            device_id: req.device.id,
            recipient: to,
            message_type: 'video',
            original_content: caption || '[Video]',
            resolved_content: caption || '[Video]',
            media_url: videoUrl || '[Base64]',
            caption: caption,
            scheduled_at: new Date(),
            status: 'sent',
            whatsapp_message_id: result.id._serialized,
            sent_at: new Date()
        });

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        });
    } catch (error) {
        console.error('Send video error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/v1/messages/send-location
 * Send a location message
 */
router.post('/messages/send-location', authenticateDevice, async (req, res) => {
    try {
        const { to, latitude, longitude, description } = req.body;

        if (!to || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: to, latitude, longitude'
            });
        }

        const chatId = formatPhoneNumber(to);
        const { Location } = require('whatsapp-web.js');
        const location = new Location(latitude, longitude, description || '');

        const client = whatsappManager.getClient(req.device.id);
        if (!client) throw new Error('WhatsApp client not available');

        // Simulate typing before sending
        await simulateTyping(client, chatId, 0);

        const result = await client.sendMessage(chatId, location);

        // Save to message queue for logging
        await ApiMessageQueue.create({
            batch_id: null,
            device_id: req.device.id,
            recipient: to,
            message_type: 'location',
            original_content: `📍 ${latitude}, ${longitude}`,
            resolved_content: description || `📍 ${latitude}, ${longitude}`,
            scheduled_at: new Date(),
            status: 'sent',
            whatsapp_message_id: result.id._serialized,
            sent_at: new Date()
        });

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        });
    } catch (error) {
        console.error('Send location error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/v1/messages/send-contact
 * Send a contact card
 */
router.post('/messages/send-contact', authenticateDevice, async (req, res) => {
    try {
        const { to, contactName, contactNumber } = req.body;

        if (!to || !contactName || !contactNumber) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: to, contactName, contactNumber'
            });
        }

        const chatId = formatPhoneNumber(to);

        // Create vCard
        const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${contactName}
TEL;TYPE=CELL:${contactNumber}
END:VCARD`;

        const client = whatsappManager.getClient(req.device.id);
        if (!client) throw new Error('WhatsApp client not available');

        // Simulate typing before sending
        await simulateTyping(client, chatId, 0);

        const result = await client.sendMessage(chatId, vcard);

        // Save to message queue for logging
        await ApiMessageQueue.create({
            batch_id: null,
            device_id: req.device.id,
            recipient: to,
            message_type: 'contact',
            original_content: `👤 ${contactName}: ${contactNumber}`,
            resolved_content: `👤 ${contactName}: ${contactNumber}`,
            scheduled_at: new Date(),
            status: 'sent',
            whatsapp_message_id: result.id._serialized,
            sent_at: new Date()
        });

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        });
    } catch (error) {
        console.error('Send contact error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/v1/check-number/:phoneNumber
 * Check if a phone number is registered on WhatsApp
 */
router.get('/check-number/:phoneNumber', authenticateDevice, async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const chatId = formatPhoneNumber(phoneNumber);

        const client = whatsappManager.getClient(req.device.id);
        if (!client) throw new Error('WhatsApp client not available');

        const isRegistered = await client.isRegisteredUser(chatId);

        res.json({
            success: true,
            isRegistered,
            phoneNumber: phoneNumber.replace(/\D/g, '')
        });
    } catch (error) {
        console.error('Check number error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/v1/device/status
 * Get device connection status
 */
router.get('/device/status', authenticateDevice, async (req, res) => {
    try {
        const status = whatsappManager.getStatus(req.device.id);
        res.json({
            success: true,
            status: status.status,
            connected: status.connected,
            info: status.info
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
