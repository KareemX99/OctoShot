/**
 * API Message Queue Model
 * Handles database operations for message queue
 */

const { pool } = require('../config/database');
const ProfileLogger = require('../services/ProfileLogger');

class ApiMessageQueue {
    /**
     * Create a single message in queue
     */
    static async create(data) {
        const query = `
            INSERT INTO api_message_queue 
            (batch_id, device_id, recipient, message_type, original_content, resolved_content, media_url, caption, status, scheduled_at, whatsapp_message_id, sent_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `;

        const values = [
            data.batch_id,
            data.device_id,
            data.recipient,
            data.message_type || 'text',
            data.original_content,
            data.resolved_content,
            data.media_url || null,
            data.caption || null,
            data.status || 'queued',
            data.scheduled_at || new Date(),
            data.whatsapp_message_id || null,
            data.sent_at || null
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Create smart batches with trust-based sizing
     * - Level 1: max 300 total, 50/batch, 12h between batches
     * - Level 2: 55/batch (+10%), 10h between batches
     * - Level 3: 60/batch (+10%), 8h between batches  
     * - Level 4: dynamic +10%, 6h between batches
     * - Within batch: 4 messages/minute (15s delay)
     */
    static async createSmartBatches(campaignId, deviceId, recipients, messageType, originalContent, resolvedContents, mediaUrl, caption, trustLevel = 1, timezone = 'Africa/Cairo') {
        const messages = [];

        // Trust level configurations
        const config = {
            1: { maxTotal: 300, batchSize: 50, intervalHours: 12 },
            2: { maxTotal: Infinity, batchSize: 100, intervalHours: 4 },
            3: { maxTotal: Infinity, batchSize: 200, intervalHours: 2 },
            4: { maxTotal: Infinity, batchSize: 300, intervalHours: 1 }
        };

        const settings = config[trustLevel] || config[1];

        // Enforce max recipients for Level 1
        let actualRecipients = recipients;
        if (trustLevel === 1 && recipients.length > settings.maxTotal) {
            actualRecipients = recipients.slice(0, settings.maxTotal);
            console.log(`⚠️ Level 1: Limited to ${settings.maxTotal} recipients`);
        }

        // Split into batches
        const batches = [];
        for (let i = 0; i < actualRecipients.length; i += settings.batchSize) {
            batches.push(actualRecipients.slice(i, i + settings.batchSize));
        }

        console.log(`📦 Creating ${batches.length} batches for trust level ${trustLevel} (timezone: ${timezone})`);

        // Use current time - PostgreSQL handles timezone correctly
        // Messages will start immediately (no timezone offset delay)
        const baseTime = new Date();

        for (let batchNum = 0; batchNum < batches.length; batchNum++) {
            const batch = batches[batchNum];
            const batchStartTime = new Date(baseTime.getTime() + (batchNum * settings.intervalHours * 60 * 60 * 1000));

            for (let i = 0; i < batch.length; i++) {
                // 4 messages per minute = 15 seconds between each
                const msgDelay = i * 15 * 1000;
                const scheduledAt = new Date(batchStartTime.getTime() + msgDelay);

                const recipientIndex = batchNum * settings.batchSize + i;

                const msg = await this.create({
                    batch_id: campaignId,
                    device_id: deviceId,
                    recipient: batch[i],
                    message_type: messageType,
                    original_content: originalContent,
                    resolved_content: resolvedContents[recipientIndex] || originalContent,
                    media_url: mediaUrl,
                    caption: caption,
                    scheduled_at: scheduledAt,
                    batch_number: batchNum + 1,
                    campaign_id: campaignId
                });

                messages.push(msg);
            }

            // Log batch creation
            await ProfileLogger.batchCreated(deviceId, campaignId, batch.length, batchStartTime);
        }

        return {
            messages,
            batchCount: batches.length,
            recipientCount: actualRecipients.length,
            intervalHours: settings.intervalHours,
            messagesPerBatch: settings.batchSize
        };
    }

    /**
     * Legacy createBatch for backwards compatibility
     */
    static async createBatch(batchId, deviceId, recipients, messageType, originalContent, resolvedContents, mediaUrl, caption) {
        return this.createSmartBatches(batchId, deviceId, recipients, messageType, originalContent, resolvedContents, mediaUrl, caption, 1);
    }

    /**
     * Get messages by batch ID
     */
    static async getByBatchId(batchId) {
        const result = await pool.query(
            'SELECT * FROM api_message_queue WHERE batch_id = $1 ORDER BY created_at',
            [batchId]
        );
        return result.rows;
    }

    /**
     * Get next queued message ready to send (using Cairo timezone)
     * Includes both 'queued' (new) and 'pending' (retry) messages
     */
    static async getNextToSend(deviceId = null) {
        // Use Africa/Cairo timezone for scheduling comparison
        let query = `
            SELECT * FROM api_message_queue 
            WHERE status IN ('queued', 'pending') 
            AND scheduled_at <= (NOW() AT TIME ZONE 'Africa/Cairo')
        `;

        if (deviceId) {
            query += ` AND device_id = $1`;
        }

        query += ` ORDER BY scheduled_at ASC LIMIT 1`;

        const result = await pool.query(query, deviceId ? [deviceId] : []);
        return result.rows[0];
    }

    /**
     * Update message status
     */
    static async updateStatus(id, status, extras = {}) {
        const updates = ['status = $2'];
        const values = [id, status];
        let paramIndex = 3;

        if (status === 'sent' || status === 'sending') {
            updates.push(`sent_at = NOW()`);
        }
        if (status === 'delivered') {
            updates.push(`delivered_at = NOW()`);
        }
        if (status === 'read') {
            updates.push(`read_at = NOW()`);
        }

        if (extras.whatsapp_message_id) {
            updates.push(`whatsapp_message_id = $${paramIndex++}`);
            values.push(extras.whatsapp_message_id);
        }

        if (extras.ack_level !== undefined) {
            updates.push(`ack_level = $${paramIndex++}`);
            values.push(extras.ack_level);
        }

        if (extras.error_message) {
            updates.push(`error_message = $${paramIndex++}`);
            values.push(extras.error_message);
        }

        const query = `
            UPDATE api_message_queue 
            SET ${updates.join(', ')} 
            WHERE id = $1 
            RETURNING *
        `;

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Update by WhatsApp message ID (for ack events)
     */
    static async updateByWhatsAppId(whatsappMessageId, status, ackLevel) {
        const statusMap = {
            '-1': 'failed',
            '0': 'pending',
            '1': 'sent',
            '2': 'delivered',
            '3': 'read'
        };

        const newStatus = statusMap[String(ackLevel)] || status;

        const query = `
            UPDATE api_message_queue 
            SET status = $1, ack_level = $2,
                delivered_at = CASE WHEN $2 >= 2 THEN NOW() ELSE delivered_at END,
                read_at = CASE WHEN $2 = 3 THEN NOW() ELSE read_at END
            WHERE whatsapp_message_id = $3
            RETURNING *
        `;

        const result = await pool.query(query, [newStatus, ackLevel, whatsappMessageId]);
        return result.rows[0];
    }

    /**
     * Get recent messages for logs page
     */
    static async getRecent(limit = 100, offset = 0, filters = {}) {
        const values = [];
        let paramIndex = 1;

        // Base filter conditions
        let apiWhere = '1=1';
        let campWhere = '1=1';

        if (filters.device_id) {
            apiWhere += ` AND device_id = $${paramIndex}`;
            campWhere += ` AND c.device_id = $${paramIndex}`;
            values.push(filters.device_id);
            paramIndex++;
        }

        if (filters.status) {
            apiWhere += ` AND status = $${paramIndex}`;
            // Map status for campaign if needed, or just simplistic match
            if (filters.status === 'queued') {
                campWhere += ` AND (ce.status = 'pending' OR ce.status = 'active')`;
            } else {
                campWhere += ` AND ce.status = $${paramIndex}`; // rough approx
            }
            values.push(filters.status);
            paramIndex++;
        }

        if (filters.batch_id) {
            apiWhere += ` AND batch_id = $${paramIndex}`;
            campWhere += ` AND ce.campaign_id = $${paramIndex}`;
            values.push(filters.batch_id);
            paramIndex++;
        }

        // Limit and Offset at the end
        const limitVal = limit;
        const offsetVal = offset;

        const query = `
            (
                SELECT 
                    id, 
                    batch_id::text, 
                    device_id, 
                    recipient, 
                    message_type, 
                    status, 
                    created_at, 
                    scheduled_at, 
                    sent_at, 
                    ack_level,
                    'api' as source
                FROM api_message_queue 
                WHERE ${apiWhere}
            )
            UNION ALL
            (
                SELECT 
                    ce.id, 
                    ce.campaign_id::text as batch_id, 
                    c.device_id, 
                    ce.recipient, 
                    'campaign' as message_type, 
                    CASE 
                        WHEN m.ack >= 3 THEN 'read'
                        WHEN m.ack = 2 THEN 'delivered'
                        WHEN m.ack >= 1 OR cml.status = 'sent' THEN 'sent'
                        WHEN cml.status = 'failed' THEN 'failed'
                        WHEN ce.status = 'active' THEN 'sending'
                        WHEN ce.status = 'completed' THEN 'sent'
                        ELSE 'queued'
                    END as status,
                    ce.created_at, 
                    c.scheduled_at,
                    COALESCE(cml.sent_at, ce.created_at) as sent_at,
                    COALESCE(m.ack, 0) as ack_level,
                    'campaign' as source
                FROM campaign_enrollments ce
                JOIN campaigns c ON ce.campaign_id = c.id
                LEFT JOIN campaign_message_log cml ON cml.enrollment_id = ce.id
                LEFT JOIN messages m ON m.message_id = cml.whatsapp_message_id
                WHERE ${campWhere}
            )
            ORDER BY created_at DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex}
        `;

        values.push(limitVal, offsetVal);

        const result = await pool.query(query, values);
        return result.rows;
    }

    /**
     * Get queue statistics
     */
    static async getStats(deviceId = null) {
        let query = `
            WITH combined_stats AS (
                SELECT status FROM api_message_queue 
                WHERE ($1::int IS NULL OR device_id = $1::int)
                
                UNION ALL
                
                SELECT 
                    CASE 
                        WHEN m.ack >= 3 THEN 'read'
                        WHEN m.ack = 2 THEN 'delivered'
                        WHEN m.ack >= 1 OR cml.status = 'sent' THEN 'sent'
                        WHEN cml.status = 'failed' THEN 'failed'
                        WHEN ce.status = 'active' THEN 'sending'
                        WHEN ce.status = 'completed' THEN 'sent'
                        ELSE 'queued'
                    END as status
                FROM campaign_enrollments ce
                JOIN campaigns c ON ce.campaign_id = c.id
                LEFT JOIN campaign_message_log cml ON cml.enrollment_id = ce.id
                LEFT JOIN messages m ON m.message_id = cml.whatsapp_message_id
                WHERE ($1::int IS NULL OR c.device_id = $1::int)
            )
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'queued') as queued,
                COUNT(*) FILTER (WHERE status = 'sending') as sending,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
                COUNT(*) FILTER (WHERE status = 'read') as read,
                COUNT(*) FILTER (WHERE status = 'failed') as failed
            FROM combined_stats
        `;

        const result = await pool.query(query, [deviceId]);
        return result.rows[0];
    }

    /**
     * Get statistics for a specific batch
     */
    static async getBatchStats(batchId) {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                COUNT(CASE WHEN status IN ('queued', 'pending') THEN 1 END) as remaining
            FROM api_message_queue 
            WHERE batch_id = $1
        `, [batchId]);

        return {
            total: parseInt(result.rows[0].total || 0),
            sent: parseInt(result.rows[0].sent || 0),
            failed: parseInt(result.rows[0].failed || 0),
            remaining: parseInt(result.rows[0].remaining || 0)
        };
    }

    /**
     * Get count of pending messages
     */
    static async getPendingCount(deviceId = null) {
        let query = `SELECT COUNT(*) FROM api_message_queue WHERE status = 'queued'`;
        if (deviceId) {
            query += ` AND device_id = $1`;
        }
        const result = await pool.query(query, deviceId ? [deviceId] : []);
        return parseInt(result.rows[0].count);
    }
}

module.exports = ApiMessageQueue;
