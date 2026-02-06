/**
 * Read No-Reply Message Processor
 * Checks for read messages where customer didn't reply and triggers webhooks
 */

const { pool } = require('../config/database');
const ReadNoReplyWebhook = require('../models/ReadNoReplyWebhook');
const whatsappManager = require('../whatsapp-manager');
const fs = require('fs');
const path = require('path');
const ProfileLogger = require('./ProfileLogger');

// Base URL for media files
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

// Dynamic fetch import
let fetch;
(async () => {
    fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
})();

class ReadNoReplyProcessor {
    constructor() {
        this.isRunning = false;
        this.checkInterval = 15000; // Check every 15 seconds (reduced from 60s for faster webhook triggers)
    }

    /**
     * Start the processor
     */
    start() {
        if (this.isRunning) return;

        console.log('📖 Starting Read No-Reply Processor...');
        this.isRunning = true;

        // Run immediately, then every minute
        this.checkReadNoReplyMessages();
        this.intervalId = setInterval(() => this.checkReadNoReplyMessages(), this.checkInterval);
    }

    /**
     * Stop the processor
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.isRunning = false;
            console.log('📖 Read No-Reply Processor stopped');
        }
    }

    /**
     * Main check function
     */
    async checkReadNoReplyMessages() {
        try {
            // Get all active webhooks
            const webhooks = await ReadNoReplyWebhook.getAllActive();

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
            console.error('Error in read no-reply processor:', error.message);
            ProfileLogger.error(null, error.message, { stack: error.stack }, 'read_no_reply_processor');
        }
    }

    /**
     * Process webhooks for a specific client
     */
    async processClientWebhooks(clientId, webhooks) {
        for (const webhook of webhooks) {
            try {
                const timerMinutes = ReadNoReplyWebhook.timerToMinutes(
                    webhook.timer_value,
                    webhook.timer_unit
                );

                console.log(`📖 Checking read-no-reply webhook for client ${clientId}: timer=${timerMinutes} minutes, directMessages=${webhook.include_direct_messages}`);

                // PART 1: Check API message queue (messages sent via API that are read but no customer reply)
                const apiResult = await pool.query(`
                    SELECT id, recipient, whatsapp_message_id, sent_at, read_at, status
                    FROM api_message_queue
                    WHERE device_id = $1
                    AND status = 'read'
                    AND customer_replied = false
                    AND no_reply_notified = false
                    AND read_at IS NOT NULL
                `, [clientId]);

                // PART 2: Check direct WhatsApp messages (if toggle is enabled)
                // Outgoing messages sent directly from WhatsApp that are read but customer didn't reply
                let directMessagesResult = { rows: [] };
                if (webhook.include_direct_messages !== false) {
                    directMessagesResult = await pool.query(`
                        SELECT DISTINCT ON (m.to_number) 
                            m.id, m.to_number as recipient, m.message_id as whatsapp_message_id, 
                            m.timestamp as sent_at, m.timestamp as read_at, m.body, m.type, m.ack
                        FROM messages m
                        WHERE m.client_id = $1
                        AND m.is_from_me = true
                        AND m.ack >= 3
                        AND COALESCE(m.no_reply_notified, false) = false
                        AND m.timestamp IS NOT NULL
                        AND m.to_number NOT LIKE '%@g.us'
                        -- Exclude messages that are in api_message_queue (already handled above)
                        AND NOT EXISTS (
                            SELECT 1 FROM api_message_queue amq 
                            WHERE amq.whatsapp_message_id = m.message_id 
                            AND amq.device_id = m.client_id
                        )
                        -- Check no customer reply: no newer incoming message from the same number
                        AND NOT EXISTS (
                            SELECT 1 FROM messages m2 
                            WHERE m2.client_id = m.client_id 
                            AND m2.is_from_me = false 
                            AND REPLACE(REPLACE(m2.from_number, '@c.us', ''), '@g.us', '') = REPLACE(REPLACE(m.to_number, '@c.us', ''), '@g.us', '')
                            AND m2.timestamp > m.timestamp
                        )
                        ORDER BY m.to_number, m.timestamp DESC
                    `, [clientId]);
                }

                // Filter by timer - API messages
                const now = new Date();
                const eligibleApiMessages = apiResult.rows.filter(msg => {
                    const readAt = new Date(msg.read_at);
                    const elapsedMs = now.getTime() - readAt.getTime();
                    const elapsedMinutes = elapsedMs / 1000 / 60;
                    return elapsedMinutes >= timerMinutes;
                });

                // Filter by timer - Direct messages (use sent_at since ack=3 means already read)
                const eligibleDirectMessages = directMessagesResult.rows.filter(msg => {
                    const readAt = new Date(msg.read_at);
                    const elapsedMs = now.getTime() - readAt.getTime();
                    const elapsedMinutes = elapsedMs / 1000 / 60;
                    return elapsedMinutes >= timerMinutes;
                });

                const totalEligible = eligibleApiMessages.length + eligibleDirectMessages.length;
                console.log(`📖 Query result: ${totalEligible} eligible messages (${eligibleApiMessages.length} API + ${eligibleDirectMessages.length} direct) for client ${clientId}`);

                if (totalEligible === 0) continue;

                console.log(`📖 Found ${totalEligible} read-no-reply messages for webhook (${webhook.timer_value} ${webhook.timer_unit})`);

                // Send API messages to the webhook
                for (const message of eligibleApiMessages) {
                    await this.sendWebhookNotification(webhook, message, timerMinutes, clientId);
                }

                // Send direct WhatsApp messages to the webhook
                for (const message of eligibleDirectMessages) {
                    await this.sendDirectMessageNotification(webhook, message, timerMinutes, clientId);
                }
            } catch (error) {
                console.error(`Error processing read-no-reply webhook ${webhook.id}:`, error.message);
                ProfileLogger.error(clientId, error.message, { webhookId: webhook.id }, 'read_no_reply_webhook');
            }
        }
    }


    /**
     * Fetch last 10 messages from chat
     */
    async fetchChatHistory(clientId, recipient) {
        try {
            // Try whatsappManager first
            let client = whatsappManager.getClient(clientId);
            console.log(`📖 WhatsApp client for ${clientId}: ${client ? 'found' : 'not found'}`);

            // Fallback to legacy whatsapp-client
            if (!client) {
                const legacyClient = require('../whatsapp-client');
                const status = legacyClient.getStatus();
                console.log(`📖 Legacy client status: ${status.connected ? 'connected' : 'disconnected'}`);
                if (status.connected) {
                    client = legacyClient.getClient();
                }
            }

            if (!client) {
                console.log(`⚠️ No WhatsApp client available for chat history (client ${clientId})`);
                return [];
            }

            const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;
            console.log(`📖 Fetching chat by ID: ${chatId}`);
            const chat = await client.getChatById(chatId);

            if (!chat) {
                console.log(`⚠️ Chat not found for ${chatId}`);
                return [];
            }

            console.log(`📖 Fetching last 10 messages from chat...`);
            const messages = await chat.fetchMessages({ limit: 10 });
            console.log(`📖 Found ${messages.length} messages in chat`);
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
     * Format a single message
     */
    async formatMessage(msg) {
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
                console.log(`📥 Downloading ${msg.type} media...`);
                const media = await msg.downloadMedia();
                if (media) {
                    const ext = media.mimetype.split('/')[1].split(';')[0] || 'bin';
                    const filename = `webhook_${Date.now()}_${msg.id._serialized.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
                    const uploadsDir = path.join(__dirname, '..', 'uploads');
                    const filePath = path.join(uploadsDir, filename);

                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }

                    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
                    console.log(`✅ Media saved: ${filename}`);

                    formatted.media_url = `${BASE_URL}/uploads/${filename}`;
                    formatted.mimetype = media.mimetype;
                    formatted.filename = media.filename || filename;
                } else {
                    console.log(`⚠️ Media download returned null for ${msg.type}`);
                }
            } catch (e) {
                console.error(`❌ Media download error for ${msg.type}:`, e.message);
            }
        }

        // Check for reply
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

                    if (quotedMsg.hasMedia) {
                        formatted.quoted_message.has_media = true;
                        formatted.quoted_message.media_type = quotedMsg.type;
                    }
                }
            } catch (e) {
                // Silently skip quote errors
            }
        }

        return formatted;
    }

    /**
     * Format timestamp with Cairo timezone (from Unix timestamp)
     */
    formatLocalTimestamp(unixTimestamp) {
        const date = new Date(unixTimestamp * 1000);
        const cairoOffset = 2 * 60 * 60 * 1000;
        const cairoDate = new Date(date.getTime() + cairoOffset);
        return cairoDate.toISOString().replace('Z', '+02:00');
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
            console.log(`📖 Fetching chat history for ${message.recipient} (client ${clientId})...`);
            const chatHistory = await this.fetchChatHistory(clientId, message.recipient);
            console.log(`📖 Chat history fetched: ${chatHistory.length} messages`);

            const payload = {
                type: 'read_no_reply',
                recipient: message.recipient,
                message_id: message.whatsapp_message_id,
                sent_at: this.formatLocalTimestampFromDate(message.sent_at),
                local_sent_at: this.formatLocalTimestampFromDate(message.sent_at),
                read_at: this.formatLocalTimestampFromDate(message.read_at),
                local_read_at: this.formatLocalTimestampFromDate(message.read_at),
                no_reply_duration_minutes: timerMinutes,
                timer_setting: `${webhook.timer_value} ${webhook.timer_unit}`,
                device_id: webhook.client_id,
                triggered_at: this.formatLocalTimestampFromDate(new Date()),
                chat_history: chatHistory
            };

            console.log(`📤 Sending read-no-reply webhook to ${webhook.webhook_url}`);

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
                    SET no_reply_notified = true, 
                        no_reply_notified_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                `, [message.id]);

                console.log(`✅ Read no-reply webhook sent for ${message.recipient} with ${chatHistory.length} chat messages`);
            } else {
                console.error(`❌ Read no-reply webhook failed: ${response.status}`);
            }
        } catch (error) {
            console.error(`Error sending read no-reply webhook:`, error.message);
        }
    }


    /**
     * Send notification for direct WhatsApp message that was read but customer didn't reply
     */
    async sendDirectMessageNotification(webhook, message, timerMinutes, clientId) {
        try {
            // Mark as notified FIRST to prevent duplicate sends
            await pool.query(`
                UPDATE messages SET no_reply_notified = true, no_reply_notified_at = CURRENT_TIMESTAMP WHERE id = $1
            `, [message.id]);

            // Fetch chat history
            const chatHistory = await this.fetchChatHistory(clientId, message.recipient);

            const payload = {
                type: 'direct_message_read_no_reply',
                recipient: message.recipient?.replace('@c.us', '').replace('@g.us', ''),
                message_id: message.whatsapp_message_id,
                sent_at: this.formatLocalTimestampFromDate(message.sent_at),
                local_sent_at: this.formatLocalTimestampFromDate(message.sent_at),
                read_at: this.formatLocalTimestampFromDate(message.read_at),
                local_read_at: this.formatLocalTimestampFromDate(message.read_at),
                no_reply_duration_minutes: timerMinutes,
                timer_setting: `${webhook.timer_value} ${webhook.timer_unit}`,
                device_id: clientId,
                triggered_at: this.formatLocalTimestampFromDate(new Date()),
                message_body: message.body || '',
                message_type: message.type || 'text',
                chat_history: chatHistory
            };

            console.log(`📤 Sending direct message read-no-reply webhook for message ${message.id} to ${webhook.webhook_url}`);

            const response = await fetch(webhook.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log(`✅ Direct message read-no-reply webhook sent successfully for message ${message.id}`);

                ProfileLogger.log(clientId, ProfileLogger.LOG_TYPES.WEBHOOK_SENT || 'webhook_sent', ProfileLogger.LOG_LEVELS.INFO || 'info',
                    `Direct message read-no-reply webhook triggered after ${timerMinutes} minutes`,
                    {
                        recipient: message.recipient,
                        messageId: message.whatsapp_message_id,
                        webhookUrl: webhook.webhook_url,
                        messageType: 'direct_whatsapp'
                    }
                );
            } else {
                console.error(`❌ Direct message read-no-reply webhook failed with status ${response.status}`);
            }
        } catch (error) {
            console.error(`Error sending direct message read-no-reply webhook:`, error.message);
        }
    }
}

// Export singleton
module.exports = new ReadNoReplyProcessor();
