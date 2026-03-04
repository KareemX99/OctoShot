// WebhookLog Model - Stores all webhook call history
const { pool } = require('../config/database');

class WebhookLog {
    // Create the webhook_logs table if it doesn't exist
    static async initTable() {
        const query = `
            CREATE TABLE IF NOT EXISTS webhook_logs (
                id SERIAL PRIMARY KEY,
                profile_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
                webhook_type VARCHAR(50) NOT NULL,
                webhook_url TEXT NOT NULL,
                payload JSONB,
                status VARCHAR(20) DEFAULT 'pending',
                response_code INTEGER,
                response_body TEXT,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_webhook_logs_profile_id ON webhook_logs(profile_id);
            CREATE INDEX IF NOT EXISTS idx_webhook_logs_type ON webhook_logs(webhook_type);
            CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
        `;

        try {
            await pool.query(query);
            console.log('✅ webhook_logs table initialized');
        } catch (error) {
            console.error('❌ Error initializing webhook_logs table:', error.message);
        }
    }

    // Log a webhook call
    static async create(data) {
        const query = `
            INSERT INTO webhook_logs (profile_id, webhook_type, webhook_url, payload, status, response_code, response_body, error_message)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

        const values = [
            data.profile_id,
            data.webhook_type,
            data.webhook_url,
            JSON.stringify(data.payload),
            data.status || 'pending',
            data.response_code,
            data.response_body?.substring(0, 500), // Truncate response
            data.error_message
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error logging webhook:', error.message);
            return null;
        }
    }

    // Get webhook logs with filters (last 48 hours only)
    static async getAll(options = {}) {
        const { profile_id, webhook_type, limit = 100, offset = 0 } = options;

        let query = `
            SELECT 
                wl.*,
                c.device_name as profile_name,
                c.phone_number
            FROM webhook_logs wl
            LEFT JOIN clients c ON wl.profile_id = c.id
            WHERE wl.created_at >= NOW() - INTERVAL '48 hours'
        `;

        const values = [];
        let paramIndex = 1;

        if (profile_id) {
            query += ` AND wl.profile_id = $${paramIndex}`;
            values.push(profile_id);
            paramIndex++;
        }

        if (webhook_type) {
            query += ` AND wl.webhook_type = $${paramIndex}`;
            values.push(webhook_type);
            paramIndex++;
        }

        query += ` ORDER BY wl.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        try {
            const result = await pool.query(query, values);
            return result.rows;
        } catch (error) {
            console.error('Error fetching webhook logs:', error.message);
            return [];
        }
    }

    // Get stats by profile (last 48 hours)
    static async getStatsByProfile() {
        const query = `
            SELECT 
                wl.profile_id,
                c.device_name as profile_name,
                c.phone_number,
                c.profile_picture_url,
                COUNT(*) as total_webhooks,
                SUM(CASE WHEN wl.status = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN wl.status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN wl.webhook_type = 'incoming_message' THEN 1 ELSE 0 END) as incoming_count,
                SUM(CASE WHEN wl.webhook_type = 'unread_message' THEN 1 ELSE 0 END) as unread_count,
                SUM(CASE WHEN wl.webhook_type = 'read_no_reply' THEN 1 ELSE 0 END) as read_no_reply_count
            FROM webhook_logs wl
            LEFT JOIN clients c ON wl.profile_id = c.id
            WHERE wl.created_at >= NOW() - INTERVAL '48 hours'
            GROUP BY wl.profile_id, c.device_name, c.phone_number, c.profile_picture_url
            ORDER BY total_webhooks DESC
        `;

        try {
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error fetching webhook stats:', error.message);
            return [];
        }
    }

    // Get single webhook log by ID
    static async getById(id) {
        const query = `
            SELECT 
                wl.*,
                c.device_name as profile_name,
                c.phone_number
            FROM webhook_logs wl
            LEFT JOIN clients c ON wl.profile_id = c.id
            WHERE wl.id = $1
        `;

        try {
            const result = await pool.query(query, [id]);
            return result.rows[0];
        } catch (error) {
            console.error('Error fetching webhook log:', error.message);
            return null;
        }
    }

    // Clean up old logs (older than 48 hours)
    static async cleanupOld() {
        const query = `DELETE FROM webhook_logs WHERE created_at < NOW() - INTERVAL '48 hours'`;

        try {
            const result = await pool.query(query);
            return result.rowCount;
        } catch (error) {
            console.error('Error cleaning up old webhook logs:', error.message);
            return 0;
        }
    }
}

module.exports = WebhookLog;
