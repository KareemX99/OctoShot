/**
 * Incoming Unreplied Webhook Model
 * Handles webhooks for when customers message the profile but don't get a reply
 */

const { pool } = require('../config/database');

class IncomingUnrepliedWebhook {
    /**
     * Convert timer to minutes
     */
    static timerToMinutes(value, unit) {
        switch (unit) {
            case 'minutes': return value;
            case 'hours': return value * 60;
            case 'days': return value * 60 * 24;
            default: return value;
        }
    }

    /**
     * Get all webhooks for a client
     */
    static async getByClientId(clientId) {
        const result = await pool.query(
            'SELECT * FROM incoming_unreplied_webhooks WHERE client_id = $1 ORDER BY created_at DESC',
            [clientId]
        );
        return result.rows;
    }

    /**
     * Get webhook by ID
     */
    static async getById(id) {
        const result = await pool.query(
            'SELECT * FROM incoming_unreplied_webhooks WHERE id = $1',
            [id]
        );
        return result.rows[0];
    }

    /**
     * Create a new webhook
     */
    static async create(clientId, webhookUrl, timerValue, timerUnit) {
        const result = await pool.query(
            `INSERT INTO incoming_unreplied_webhooks (client_id, webhook_url, timer_value, timer_unit, is_active)
             VALUES ($1, $2, $3, $4, true)
             RETURNING *`,
            [clientId, webhookUrl, timerValue, timerUnit]
        );
        return result.rows[0];
    }

    /**
     * Update an existing webhook
     */
    static async update(id, webhookUrl, timerValue, timerUnit, isActive) {
        const result = await pool.query(
            `UPDATE incoming_unreplied_webhooks 
             SET webhook_url = $1, timer_value = $2, timer_unit = $3, is_active = $4
             WHERE id = $5
             RETURNING *`,
            [webhookUrl, timerValue, timerUnit, isActive, id]
        );
        return result.rows[0];
    }

    /**
     * Delete a webhook
     */
    static async delete(id) {
        const result = await pool.query(
            'DELETE FROM incoming_unreplied_webhooks WHERE id = $1 RETURNING *',
            [id]
        );
        return result.rows[0];
    }

    /**
     * Get all active webhooks (for processing)
     */
    static async getAllActive() {
        const result = await pool.query(
            `SELECT iuw.*, c.id as client_id
             FROM incoming_unreplied_webhooks iuw
             JOIN clients c ON c.id = iuw.client_id
             WHERE iuw.is_active = true`
        );
        return result.rows;
    }

    /**
     * Get active webhooks grouped by client
     */
    static async getActiveGroupedByClient() {
        const result = await pool.query(`
            SELECT client_id, array_agg(row_to_json(iuw)) as webhooks
            FROM incoming_unreplied_webhooks iuw
            WHERE is_active = true
            GROUP BY client_id
        `);
        return result.rows;
    }
}

module.exports = IncomingUnrepliedWebhook;
