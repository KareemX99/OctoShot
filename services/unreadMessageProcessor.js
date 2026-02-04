/**
 * Unread Message Processor
 * Checks for delivered but unread messages and triggers webhooks
 */

const { pool } = require('../config/database');
const UnreadWebhook = require('../models/UnreadWebhook');
const whatsappManager = require('../whatsapp-manager');
const fs = require('fs');
const path = require('path');
const ProfileLogger = require('./ProfileLogger');

// Base URL for media files - update this for production
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

// Dynamic fetch import
let fetch;
(async () => {
    fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
})();

class UnreadMessageProcessor {
    constructor() {
        this.isRunning = false;
        this.checkInterval = 15000; // Check every 15 seconds (reduced from 60s for faster webhook triggers)
    }

    /**
     * Start the processor
     */
    start() {
        if (this.isRunning) return;

        console.log('🔔 Starting Unread Message Processor...');
        this.isRunning = true;

        // Run immediately, then every minute
        this.checkUnreadMessages();
        this.intervalId = setInterval(() => this.checkUnreadMessages(), this.checkInterval);
    }

    /**
     * Stop the processor
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.isRunning = false;
            console.log('🔔 Unread Message Processor stopped');
        }
    }

    /**
     * Main check function
     */
    async checkUnreadMessages() {
        try {
            // Get all active webhooks
            const webhooks = await UnreadWebhook.getAllActive();

            if (webhooks.length === 0) return;

            // Group webhooks by client_id
            const webhooksByClient = {};
            for (const webhook of webhooks) {
                if (!webhooksByClient[webhook.client_id]) {
                    webhooksByClient[webhook.client_id] = [];
                }
                webhooksByClient[webhook.client_id].push(webhook);
            }

            // Process each client's webhooks
            for (const clientId of Object.keys(webhooksByClient)) {
                await this.processClientWebhooks(
                    parseInt(clientId),
                    webhooksByClient[clientId]
                );
            }
        } catch (error) {
            console.error('Error in unread message processor:', error.message);
            ProfileLogger.error(null, error.message, { stack: error.stack }, 'unread_processor');
        }
    }

    /**
     * Process webhooks for a specific client
     */
    async processClientWebhooks(clientId, webhooks) {
        for (const webhook of webhooks) {
            try {
                const timerMinutes = UnreadWebhook.timerToMinutes(
                    webhook.timer_value,
                    webhook.timer_unit
                );

                console.log(`🔍 Checking webhook for client ${clientId}: timer=${timerMinutes} minutes, directMessages=${webhook.include_direct_messages}`);

                // PART 1: Check API message queue (outgoing messages delivered but not read)
                const apiResult = await pool.query(`
                    SELECT id, recipient, whatsapp_message_id, sent_at, status
                    FROM api_message_queue
                    WHERE device_id = $1
                    AND status = 'delivered'
                    AND unread_notified = false
                    AND sent_at IS NOT NULL
                `, [clientId]);

                // PART 2: Check incoming messages that haven't been replied to
                // Find incoming messages where the last message in the chat is from them (not replied)
                const incomingResult = await pool.query(`
                    SELECT DISTINCT ON (from_number) 
                        id, from_number as recipient, message_id as whatsapp_message_id, 
                        timestamp as sent_at, body, type
                    FROM messages
                    WHERE client_id = $1
                    AND is_from_me = false
                    AND COALESCE(unread_notified, false) = false
                    AND timestamp IS NOT NULL
                    ORDER BY from_number, timestamp DESC
                `, [clientId]);

                // PART 3: Check direct WhatsApp messages (if toggle is enabled)
                // Outgoing messages sent directly from WhatsApp that are delivered but not read
                let directMessagesResult = { rows: [] };
                if (webhook.include_direct_messages) {
                    directMessagesResult = await pool.query(`
                        SELECT DISTINCT ON (to_number) 
                            id, to_number as recipient, message_id as whatsapp_message_id, 
                            timestamp as sent_at, body, type, ack
                        FROM messages
                        WHERE client_id = $1
                        AND is_from_me = true
                        AND ack >= 2
                        AND ack < 3
                        AND COALESCE(unread_notified, false) = false
                        AND timestamp IS NOT NULL
                        ORDER BY to_number, timestamp DESC
                    `, [clientId]);
                }

                // Combine and filter by timer
                const now = new Date();

                // Filter API messages
                const eligibleApiMessages = apiResult.rows.filter(msg => {
                    const sentAt = new Date(msg.sent_at);
                    const elapsedMs = now.getTime() - sentAt.getTime();
                    const elapsedMinutes = elapsedMs / 1000 / 60;
                    return elapsedMinutes >= timerMinutes;
                });

                // Filter incoming messages - check if no reply was sent after
                const eligibleIncomingMessages = [];
                for (const msg of incomingResult.rows) {
                    const sentAt = new Date(msg.sent_at);
                    const elapsedMs = now.getTime() - sentAt.getTime();
                    const elapsedMinutes = elapsedMs / 1000 / 60;

                    if (elapsedMinutes >= timerMinutes) {
                        // Check if we replied after this message
                        const replyCheck = await pool.query(`
                            SELECT id FROM messages 
                            WHERE client_id = $1 
                            AND to_number = $2 
                            AND is_from_me = true 
                            AND timestamp > $3
                            LIMIT 1
                        `, [clientId, msg.recipient?.replace('@c.us', '').replace('@g.us', ''), sentAt]);

                        if (replyCheck.rows.length === 0) {
                            // No reply sent, include this message
                            eligibleIncomingMessages.push(msg);
                        }
                    }
                }

                // Filter direct messages by timer
                const eligibleDirectMessages = directMessagesResult.rows.filter(msg => {
                    const sentAt = new Date(msg.sent_at);
                    const elapsedMs = now.getTime() - sentAt.getTime();
                    const elapsedMinutes = elapsedMs / 1000 / 60;
                    return elapsedMinutes >= timerMinutes;
                });

                const totalEligible = eligibleApiMessages.length + eligibleIncomingMessages.length + eligibleDirectMessages.length;
                console.log(`🔍 Query result: ${totalEligible} eligible messages (${eligibleApiMessages.length} API + ${eligibleIncomingMessages.length} incoming + ${eligibleDirectMessages.length} direct) for client ${clientId}`);

                if (totalEligible === 0) continue;

                console.log(`📢 Found ${totalEligible} unread/unreplied messages for webhook (${webhook.timer_value} ${webhook.timer_unit})`);

                // Send API messages to the webhook
                for (const message of eligibleApiMessages) {
                    await this.sendWebhookNotification(webhook, message, timerMinutes, clientId);
                }

                // Send incoming messages to the webhook
                for (const message of eligibleIncomingMessages) {
                    await this.sendIncomingUnrepliedNotification(webhook, message, timerMinutes, clientId);
                }

                // Send direct WhatsApp messages to the webhook
                for (const message of eligibleDirectMessages) {
                    await this.sendDirectMessageNotification(webhook, message, timerMinutes, clientId);
                }
            } catch (error) {
                console.error(`Error processing webhook ${webhook.id}:`, error.message);
                ProfileLogger.error(clientId, error.message, { webhookId: webhook.id }, 'unread_webhook');
            }
        }
    }

    /**
     * Send notification for incoming unreplied message
     */
    async sendIncomingUnrepliedNotification(webhook, message, timerMinutes, clientId) {
        try {
            // Mark as notified FIRST to prevent duplicate sends
            await pool.query(`
                UPDATE messages SET unread_notified = true WHERE id = $1
            `, [message.id]);

            const payload = {
                type: 'incoming_unreplied',
                clientId: clientId,
                timerMinutes: timerMinutes,
                message: {
                    id: message.id,
                    from: message.recipient,
                    messageId: message.whatsapp_message_id,
                    receivedAt: message.sent_at,
                    body: message.body || '',
                    type: message.type || 'text'
                },
                triggeredAt: new Date().toISOString()
            };

            console.log(`📤 Sending incoming unreplied webhook for message ${message.id} to ${webhook.webhook_url}`);

            const response = await fetch(webhook.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log(`✅ Incoming unreplied webhook sent successfully for message ${message.id}`);
            } else {
                console.error(`❌ Webhook failed with status ${response.status}`);
            }
        } catch (error) {
            console.error(`Error sending incoming unreplied webhook:`, error.message);
        }
    }

    /**
     * Send notification for direct WhatsApp message that remains unread
     */
    async sendDirectMessageNotification(webhook, message, timerMinutes, clientId) {
        try {
            // Mark as notified FIRST to prevent duplicate sends
            await pool.query(`
                UPDATE messages SET unread_notified = true WHERE id = $1
            `, [message.id]);

            // Fetch chat history
            const chatHistory = await this.fetchChatHistory(clientId, message.recipient);

            const payload = {
                type: 'direct_message_unread',
                recipient: message.recipient?.replace('@c.us', '').replace('@g.us', ''),
                message_id: message.whatsapp_message_id,
                sent_at: message.sent_at,
                unread_duration_minutes: timerMinutes,
                timer_setting: `${webhook.timer_value} ${webhook.timer_unit}`,
                device_id: clientId,
                message_body: message.body || '',
                message_type: message.type || 'text',
                chat_history: chatHistory
            };

            console.log(`📤 Sending direct message unread webhook for message ${message.id} to ${webhook.webhook_url}`);

            const response = await fetch(webhook.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log(`✅ Direct message unread webhook sent successfully for message ${message.id}`);

                ProfileLogger.log(clientId, ProfileLogger.LOG_TYPES.WEBHOOK_UNREAD, ProfileLogger.LOG_LEVELS.INFO,
                    `Direct message unread webhook triggered after ${timerMinutes} minutes`,
                    {
                        recipient: message.recipient,
                        messageId: message.whatsapp_message_id,
                        webhookUrl: webhook.webhook_url,
                        messageType: 'direct_whatsapp'
                    }
                );
            } else {
                console.error(`❌ Direct message unread webhook failed with status ${response.status}`);
            }
        } catch (error) {
            console.error(`Error sending direct message unread webhook:`, error.message);
        }
    }

    /**
     * Fetch last 10 messages from chat
     */
    async fetchChatHistory(clientId, recipient) {
        try {
            // Try whatsappManager first
            let client = whatsappManager.getClient(clientId);

            // Fallback to legacy whatsapp-client if manager client not available
            if (!client) {
                const legacyClient = require('../whatsapp-client');
                const status = legacyClient.getStatus();
                if (status.connected) {
                    client = legacyClient.getClient();
                    console.log(`📱 Using legacy whatsapp-client for chat history`);
                }
            }

            if (!client) {
                console.log(`⚠️ WhatsApp client not available for fetching chat history`);
                return [];
            }

            const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;
            const chat = await client.getChatById(chatId);

            if (!chat) {
                console.log(`⚠️ Chat not found for ${chatId}`);
                return [];
            }

            const messages = await chat.fetchMessages({ limit: 10 });
            const formattedMessages = [];

            for (const msg of messages) {
                const formattedMsg = await this.formatMessage(msg);
                formattedMessages.push(formattedMsg);
            }

            return formattedMessages;
        } catch (error) {
            console.error(`Error fetching chat history:`, error.message);
            return [];
        }
    }

    /**
     * Format a single message with proper type and media info
     */
    async formatMessage(msg) {
        // Map message types
        const typeMap = {
            'chat': 'text',
            'ptt': 'voice',
            'image': 'image',
            'video': 'video',
            'audio': 'audio',
            'document': 'document',
            'sticker': 'sticker',
            'location': 'location',
            'vcard': 'contact'
        };

        const formatted = {
            body: msg.body || '',
            from_me: msg.fromMe,
            timestamp: new Date(msg.timestamp * 1000).toISOString(),
            local_timestamp: this.formatLocalTimestamp(msg.timestamp),
            type: typeMap[msg.type] || msg.type
        };

        // Add media URL for media messages
        if (msg.hasMedia && ['ptt', 'image', 'video', 'audio', 'document', 'sticker'].includes(msg.type)) {
            try {
                const media = await msg.downloadMedia();
                if (media) {
                    // Generate filename based on message ID and mimetype
                    const ext = media.mimetype.split('/')[1].split(';')[0] || 'bin';
                    const filename = `webhook_${Date.now()}_${msg.id._serialized.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
                    const uploadsDir = path.join(__dirname, '..', 'uploads');
                    const filePath = path.join(uploadsDir, filename);

                    // Ensure uploads directory exists
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }

                    // Save media file
                    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

                    // Return full URL path
                    formatted.media_url = `${BASE_URL}/uploads/${filename}`;
                    formatted.mimetype = media.mimetype;
                    formatted.filename = media.filename || filename;
                }
            } catch (e) {
                console.log(`⚠️ Could not download media: ${e.message}`);
            }
        }

        // Check if this is a reply to another message
        if (msg.hasQuotedMsg) {
            try {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg) {
                    formatted.is_reply = true;
                    formatted.quoted_message = {
                        body: quotedMsg.body || '',
                        from_me: quotedMsg.fromMe,
                        type: typeMap[quotedMsg.type] || quotedMsg.type
                    };

                    // Add media info for quoted message if it has media
                    if (quotedMsg.hasMedia) {
                        formatted.quoted_message.has_media = true;
                        formatted.quoted_message.media_type = quotedMsg.type;
                    }
                }
            } catch (e) {
                console.log(`⚠️ Could not get quoted message: ${e.message}`);
            }
        }

        return formatted;
    }

    /**
     * Format timestamp with Cairo timezone (UTC+2) - from unix timestamp
     */
    formatLocalTimestamp(unixTimestamp) {
        const date = new Date(unixTimestamp * 1000);
        // Cairo is UTC+2
        const cairoOffset = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
        const cairoDate = new Date(date.getTime() + cairoOffset);

        // Format as ISO string with +02:00 offset
        const isoString = cairoDate.toISOString().replace('Z', '+02:00');
        return isoString;
    }

    /**
     * Format timestamp with Cairo timezone (from Date object or ISO string)
     */
    formatLocalTimestampFromDate(dateValue) {
        if (!dateValue) return null;
        const date = new Date(dateValue);
        const cairoOffset = 2 * 60 * 60 * 1000;
        const cairoDate = new Date(date.getTime() + cairoOffset);
        return cairoDate.toISOString().replace('Z', '+02:00');
    }

    /**
     * Send notification to webhook
     */
    async sendWebhookNotification(webhook, message, timerMinutes, clientId) {
        try {
            // Fetch last 10 messages from the chat
            const chatHistory = await this.fetchChatHistory(clientId, message.recipient);

            const payload = {
                type: 'unread_message',
                recipient: message.recipient,
                message_id: message.whatsapp_message_id,
                sent_at: this.formatLocalTimestampFromDate(message.sent_at),
                unread_duration_minutes: timerMinutes,
                timer_setting: `${webhook.timer_value} ${webhook.timer_unit}`,
                device_id: webhook.client_id,
                chat_history: chatHistory
            };

            const response = await fetch(webhook.webhook_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                // Mark message as notified
                await pool.query(`
                    UPDATE api_message_queue 
                    SET unread_notified = true, 
                        unread_notified_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                `, [message.id]);

                console.log(`✅ Unread webhook sent for ${message.recipient} with ${chatHistory.length} chat messages`);

                // Log webhook to ProfileLogger with full details
                ProfileLogger.log(webhook.client_id, ProfileLogger.LOG_TYPES.WEBHOOK_SENT, ProfileLogger.LOG_LEVELS.INFO,
                    `Unread webhook sent to ${message.recipient}`,
                    {
                        webhookType: 'unread_message',
                        webhookUrl: webhook.webhook_url,
                        recipient: message.recipient,
                        messageId: message.id,
                        timerSetting: `${webhook.timer_value} ${webhook.timer_unit}`,
                        chatHistoryCount: chatHistory.length,
                        sentAt: message.sent_at,
                        deliveredAt: message.delivered_at,
                        payload: payload
                    }
                );
            } else {
                console.error(`❌ Webhook failed: ${response.status}`);
                ProfileLogger.error(webhook.client_id, `Unread webhook failed: ${response.status}`, { webhookUrl: webhook.webhook_url }, 'unread_processor');
            }
        } catch (error) {
            console.error(`Error sending webhook:`, error.message);
        }
    }
}

// Export singleton
module.exports = new UnreadMessageProcessor();
