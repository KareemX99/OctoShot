/**
 * Unread Webhook Model
 * Manages webhooks for unread message notifications
 */

const { pool } = require('../config/database');

class UnreadWebhook {
    /**
     * Get all webhooks for a client
     */
    static async getByClientId(clientId) {
        const result = await pool.query(
            `SELECT * FROM unread_webhooks 
             WHERE client_id = $1 
             ORDER BY created_at ASC`,
            [clientId]
        );
        return result.rows;
    }

    /**
     * Get a single webhook by ID
     */
    static async getById(id) {
        const result = await pool.query(
            'SELECT * FROM unread_webhooks WHERE id = $1',
            [id]
        );
        return result.rows[0];
    }

    /**
     * Create a new webhook (max 5 per client)
     */
    static async create(clientId, webhookUrl, timerValue, timerUnit, includeDirectMessages = false) {
        // Check current count
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM unread_webhooks WHERE client_id = $1',
            [clientId]
        );

        if (parseInt(countResult.rows[0].count) >= 5) {
            throw new Error('Maximum 5 webhooks allowed per profile');
        }

        // Validate timer unit
        const validUnits = ['minutes', 'hours', 'days'];
        if (!validUnits.includes(timerUnit)) {
            throw new Error('Invalid timer unit. Use: minutes, hours, or days');
        }

        const result = await pool.query(
            `INSERT INTO unread_webhooks (client_id, webhook_url, timer_value, timer_unit, is_active, include_direct_messages)
             VALUES ($1, $2, $3, $4, true, $5)
             RETURNING *`,
            [clientId, webhookUrl, timerValue, timerUnit, includeDirectMessages]
        );
        return result.rows[0];
    }

    /**
     * Update a webhook
     */
    static async update(id, webhookUrl, timerValue, timerUnit, isActive, includeDirectMessages) {
        const validUnits = ['minutes', 'hours', 'days'];
        if (!validUnits.includes(timerUnit)) {
            throw new Error('Invalid timer unit. Use: minutes, hours, or days');
        }

        const result = await pool.query(
            `UPDATE unread_webhooks 
             SET webhook_url = $1, timer_value = $2, timer_unit = $3, is_active = $4, include_direct_messages = COALESCE($5, include_direct_messages)
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
        const result = await pool.query(
            'DELETE FROM unread_webhooks WHERE id = $1 RETURNING *',
            [id]
        );
        return result.rows[0];
    }

    /**
     * Get all active webhooks (for background processor)
     */
    static async getAllActive() {
        const result = await pool.query(
            `SELECT uw.*, c.phone_number as device_phone
             FROM unread_webhooks uw
             JOIN clients c ON uw.client_id = c.id
             WHERE uw.is_active = true`
        );
        return result.rows;
    }

    /**
     * Convert timer to minutes for comparison
     */
    static timerToMinutes(timerValue, timerUnit) {
        switch (timerUnit) {
            case 'minutes':
                return timerValue;
            case 'hours':
                return timerValue * 60;
            case 'days':
                return timerValue * 60 * 24;
            default:
                return timerValue;
        }
    }
}

module.exports = UnreadWebhook;
