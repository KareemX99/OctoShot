/**
 * Read No-Reply Webhook Model
 * Manages webhooks that trigger when customer reads but doesn't reply
 */

const { pool } = require('../config/database');

class ReadNoReplyWebhook {
    /**
     * Get all webhooks for a client
     */
    static async getByClientId(clientId) {
        const result = await pool.query(
            'SELECT * FROM read_no_reply_webhooks WHERE client_id = $1 ORDER BY created_at DESC',
            [clientId]
        );
        return result.rows;
    }

    /**
     * Get webhook by ID
     */
    static async getById(id) {
        const result = await pool.query(
            'SELECT * FROM read_no_reply_webhooks WHERE id = $1',
            [id]
        );
        return result.rows[0];
    }

    /**
     * Create a new webhook (max 5 per client)
     */
    static async create(clientId, webhookUrl, timerValue = 5, timerUnit = 'minutes', includeDirectMessages = true) {
        // Check current count
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM read_no_reply_webhooks WHERE client_id = $1',
            [clientId]
        );

        if (parseInt(countResult.rows[0].count) >= 5) {
            throw new Error('Maximum of 5 read-no-reply webhooks allowed per profile');
        }

        const result = await pool.query(
            `INSERT INTO read_no_reply_webhooks (client_id, webhook_url, timer_value, timer_unit, include_direct_messages)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [clientId, webhookUrl, timerValue, timerUnit, includeDirectMessages]
        );
        return result.rows[0];
    }


    /**
     * Update a webhook
     */
    static async update(id, webhookUrl, timerValue, timerUnit, isActive, includeDirectMessages = true) {
        const result = await pool.query(
            `UPDATE read_no_reply_webhooks 
             SET webhook_url = $1, timer_value = $2, timer_unit = $3, is_active = $4, include_direct_messages = $5
             WHERE id = $6
             RETURNING *`,
            [webhookUrl, timerValue, timerUnit, isActive, includeDirectMessages, id]
        );
        return result.rows[0];
    }


    /**
     * Delete a webhook
     */
    static async delete(id) {
        await pool.query('DELETE FROM read_no_reply_webhooks WHERE id = $1', [id]);
        return true;
    }

    /**
     * Get all active webhooks (for processor)
     */
    static async getAllActive() {
        const result = await pool.query(
            'SELECT * FROM read_no_reply_webhooks WHERE is_active = true'
        );
        return result.rows;
    }

    /**
     * Convert timer to minutes
     */
    static timerToMinutes(value, unit) {
        switch (unit) {
            case 'hours':
                return value * 60;
            case 'days':
                return value * 60 * 24;
            case 'minutes':
            default:
                return value;
        }
    }
}

module.exports = ReadNoReplyWebhook;
