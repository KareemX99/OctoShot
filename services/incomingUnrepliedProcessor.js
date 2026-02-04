/**
 * Incoming Unreplied Message Processor (Waiting for Reply)
 * Monitors for incoming messages from customers that haven't been replied to
 * and sends webhook notifications after the configured timer expires
 * 
 * Type: waiting_for_reply
 * Only personal chats (excludes groups)
 */

const { pool } = require('../config/database');
const IncomingUnrepliedWebhook = require('../models/IncomingUnrepliedWebhook');
const ProfileLogger = require('./ProfileLogger');
const fetch = require('node-fetch');

class IncomingUnrepliedProcessor {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
        this.checkIntervalMs = 30000; // Check every 30 seconds
    }

    /**
     * Start the processor
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️ Incoming Unreplied Processor already running');
            return;
        }

        console.log('📨 Starting Incoming Unreplied Processor...');
        this.isRunning = true;

        // Run immediately, then on interval
        this.processAllWebhooks();
        this.intervalId = setInterval(() => {
            this.processAllWebhooks();
        }, this.checkIntervalMs);
    }

    /**
     * Stop the processor
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('⏹️ Incoming Unreplied Processor stopped');
    }

    /**
     * Process all active webhooks
     */
    async processAllWebhooks() {
        try {
            // Get all active incoming unreplied webhooks grouped by client
            const groupedWebhooks = await IncomingUnrepliedWebhook.getActiveGroupedByClient();

            console.log(`🔍 [WaitingForReply] Found ${groupedWebhooks.length} clients with waiting_for_reply webhooks`);

            for (const group of groupedWebhooks) {
                const clientId = group.client_id;
                const webhooks = group.webhooks;

                console.log(`🔍 [WaitingForReply] Client ${clientId}: ${webhooks?.length || 0} webhook(s)`);

                if (webhooks && webhooks.length > 0) {
                    await this.processClientWebhooks(clientId, webhooks);
                }
            }
        } catch (error) {
            console.error('Error in incoming unreplied processor:', error.message);
        }
    }

    /**
     * Process webhooks for a specific client
     */
    async processClientWebhooks(clientId, webhooks) {
        for (const webhook of webhooks) {
            try {
                const timerMinutes = IncomingUnrepliedWebhook.timerToMinutes(
                    webhook.timer_value,
                    webhook.timer_unit
                );

                console.log(`🔍 [WaitingForReply] Checking client ${clientId}: timer=${timerMinutes} min`);

                // Find incoming messages that haven't been replied to
                // is_from_me = false means the customer sent this message
                // Use chat_id to filter: personal chats end with @c.us, groups end with @g.us
                // EXCLUDE system messages (e2e_notification, notification_template, call_log)
                // EXCLUDE empty messages
                const incomingResult = await pool.query(`
                    SELECT DISTINCT ON (from_number) 
                        id, from_number as sender, chat_id, message_id as whatsapp_message_id, 
                        timestamp as received_at, body, type
                    FROM messages
                    WHERE client_id = $1
                    AND is_from_me = false
                    AND COALESCE(incoming_notified, false) = false
                    AND timestamp IS NOT NULL
                    AND chat_id LIKE '%@c.us'
                    AND chat_id NOT LIKE '%@g.us'
                    AND chat_id NOT LIKE '%@lid'
                    AND chat_id NOT LIKE 'status@%'
                    AND type NOT IN ('e2e_notification', 'notification_template', 'call_log', 'ciphertext')
                    AND body IS NOT NULL AND body != ''
                    ORDER BY from_number, timestamp DESC
                `, [clientId]);

                console.log(`🔍 [WaitingForReply] Found ${incomingResult.rows.length} unreplied incoming messages for client ${clientId}`);

                const now = new Date();

                for (const msg of incomingResult.rows) {
                    const receivedAt = new Date(msg.received_at);
                    const elapsedMs = now.getTime() - receivedAt.getTime();
                    const elapsedMinutes = elapsedMs / 1000 / 60;

                    console.log(`🔍 [WaitingForReply] Message ${msg.id} from ${msg.sender}: elapsed=${elapsedMinutes.toFixed(2)} min, timer=${timerMinutes} min, ready=${elapsedMinutes >= timerMinutes}`);


                    if (elapsedMinutes >= timerMinutes) {
                        // Check if we replied after this message
                        const senderNumber = msg.sender?.replace('@c.us', '').replace('@g.us', '').replace('@lid', '');

                        const replyCheck = await pool.query(`
                            SELECT id FROM messages 
                            WHERE client_id = $1 
                            AND (to_number = $2 OR to_number LIKE $3)
                            AND is_from_me = true 
                            AND timestamp > $4
                            LIMIT 1
                        `, [clientId, msg.sender, `%${senderNumber}%`, receivedAt]);

                        if (replyCheck.rows.length === 0) {
                            // No reply sent, send webhook notification
                            await this.sendNotification(webhook, msg, timerMinutes, clientId);
                        } else {
                            // Reply was sent, mark as notified to prevent future checks
                            await pool.query(`
                                UPDATE messages SET incoming_notified = true WHERE id = $1
                            `, [msg.id]);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing incoming unreplied webhook for client ${clientId}:`, error.message);
            }
        }
    }

    /**
     * Format timestamp with Cairo timezone (UTC+2) from Date object or ISO string
     */
    formatLocalTimestampFromDate(dateValue) {
        if (!dateValue) return null;
        const date = new Date(dateValue);
        const cairoOffset = 2 * 60 * 60 * 1000; // UTC+2
        const cairoDate = new Date(date.getTime() + cairoOffset);
        return cairoDate.toISOString().replace('Z', '+02:00');
    }

    /**
     * Send webhook notification
     */
    async sendNotification(webhook, message, timerMinutes, clientId) {
        try {
            // Mark as notified FIRST to prevent duplicates
            await pool.query(`
                UPDATE messages SET incoming_notified = true WHERE id = $1
            `, [message.id]);

            // Fetch chat history
            const chatHistory = await this.fetchChatHistory(clientId, message.sender);

            const senderNumber = message.sender?.replace('@c.us', '').replace('@g.us', '').replace('@lid', '');

            const payload = {
                type: 'waiting_for_reply',
                device_id: clientId,
                customer_phone: senderNumber,
                message_id: message.whatsapp_message_id,
                received_at: this.formatLocalTimestampFromDate(message.received_at),
                unreplied_duration_minutes: timerMinutes,
                timer_setting: `${webhook.timer_value} ${webhook.timer_unit}`,
                message_body: message.body || '',
                message_type: message.type || 'text',
                chat_history: chatHistory,
                triggered_at: this.formatLocalTimestampFromDate(new Date())
            };

            console.log(`📨 Sending waiting_for_reply webhook for message ${message.id} to ${webhook.webhook_url}`);

            const response = await fetch(webhook.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log(`✅ Waiting for reply webhook sent successfully for message ${message.id}`);

                ProfileLogger.log(clientId, ProfileLogger.LOG_TYPES.WEBHOOK_INCOMING, ProfileLogger.LOG_LEVELS.INFO,
                    `Waiting for reply webhook triggered after ${timerMinutes} minutes`,
                    {
                        customerPhone: senderNumber,
                        messageId: message.whatsapp_message_id,
                        webhookUrl: webhook.webhook_url
                    }
                );
            } else {
                console.error(`❌ Waiting for reply webhook failed with status ${response.status}`);
            }
        } catch (error) {
            console.error(`Error sending waiting for reply webhook:`, error.message);
        }
    }

    /**
     * Fetch chat history for context
     */
    async fetchChatHistory(clientId, sender) {
        try {
            const senderNumber = sender?.replace('@c.us', '').replace('@g.us', '').replace('@lid', '');

            const result = await pool.query(`
                SELECT body, is_from_me, timestamp, type
                FROM messages
                WHERE client_id = $1
                AND (from_number = $2 OR from_number LIKE $3 OR to_number = $2 OR to_number LIKE $3)
                AND type NOT IN ('e2e_notification', 'notification_template', 'call_log', 'ciphertext')
                AND body IS NOT NULL AND body != ''
                ORDER BY timestamp ASC
                LIMIT 20
            `, [clientId, sender, `%${senderNumber}%`]);

            return result.rows.map(row => ({
                body: row.body || '',
                from_me: row.is_from_me,
                timestamp: row.timestamp,
                type: row.type || 'text'
            }));
        } catch (error) {
            console.error('Error fetching chat history:', error.message);
            return [];
        }
    }
}

module.exports = new IncomingUnrepliedProcessor();
