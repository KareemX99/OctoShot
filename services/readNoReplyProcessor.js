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

                // Find messages that are read but customer didn't reply
                const result = await pool.query(`
                    SELECT id, recipient, whatsapp_message_id, sent_at, read_at, status
                    FROM api_message_queue
                    WHERE device_id = $1
                    AND status = 'read'
                    AND customer_replied = false
                    AND no_reply_notified = false
                    AND read_at IS NOT NULL
                `, [clientId]);

                // Filter in JavaScript to handle timezone properly
                const now = new Date();
                const eligibleMessages = result.rows.filter(msg => {
                    const readAt = new Date(msg.read_at);
                    const elapsedMs = now.getTime() - readAt.getTime();
                    const elapsedMinutes = elapsedMs / 1000 / 60;

                    return elapsedMinutes >= timerMinutes;
                });

                if (eligibleMessages.length === 0) continue;

                console.log(`📖 Found ${eligibleMessages.length} read-no-reply messages for webhook (${webhook.timer_value} ${webhook.timer_unit})`);

                // Send each message to the webhook
                for (const message of eligibleMessages) {
                    await this.sendWebhookNotification(webhook, message, timerMinutes, clientId);
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

            // Fallback to legacy whatsapp-client
            if (!client) {
                const legacyClient = require('../whatsapp-client');
                const status = legacyClient.getStatus();
                if (status.connected) {
                    client = legacyClient.getClient();
                }
            }

            if (!client) {
                return [];
            }

            const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;
            const chat = await client.getChatById(chatId);

            if (!chat) {
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
            const chatHistory = await this.fetchChatHistory(clientId, message.recipient);

            const payload = {
                type: 'read_no_reply',
                recipient: message.recipient,
                message_id: message.whatsapp_message_id,
                sent_at: this.formatLocalTimestampFromDate(message.sent_at),
                read_at: this.formatLocalTimestampFromDate(message.read_at),
                no_reply_duration_minutes: timerMinutes,
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
}

// Export singleton
module.exports = new ReadNoReplyProcessor();
