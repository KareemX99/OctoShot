/**
 * AutoReply Model
 * Handles database operations for auto-reply rules
 */

const { query } = require('../config/database');

class AutoReply {
    /**
     * Create a new auto-reply rule
     */
    static async create(data) {
        const sql = `
            INSERT INTO auto_replies (
                client_id, trigger_word, reply_message, match_type, is_active
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;

        const values = [
            data.client_id,
            data.trigger_word,
            data.reply_message,
            data.match_type || 'contains',
            data.is_active !== false
        ];

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Get all auto-reply rules for a client
     */
    static async getAll(clientId) {
        const sql = `
            SELECT * FROM auto_replies 
            WHERE client_id = $1 
            ORDER BY created_at DESC
        `;
        const result = await query(sql, [clientId]);
        return result.rows;
    }

    /**
     * Get active rules only
     */
    static async getActive(clientId) {
        const sql = `
            SELECT * FROM auto_replies 
            WHERE client_id = $1 AND is_active = true
            ORDER BY created_at DESC
        `;
        const result = await query(sql, [clientId]);
        return result.rows;
    }

    /**
     * Get rule by ID
     */
    static async getById(id) {
        const sql = `SELECT * FROM auto_replies WHERE id = $1`;
        const result = await query(sql, [id]);
        return result.rows[0];
    }

    /**
     * Update a rule
     */
    static async update(id, data) {
        const sql = `
            UPDATE auto_replies 
            SET 
                trigger_word = COALESCE($1, trigger_word),
                reply_message = COALESCE($2, reply_message),
                match_type = COALESCE($3, match_type),
                is_active = COALESCE($4, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `;

        const values = [
            data.trigger_word,
            data.reply_message,
            data.match_type,
            data.is_active,
            id
        ];

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Delete a rule
     */
    static async delete(id) {
        const sql = `DELETE FROM auto_replies WHERE id = $1 RETURNING *`;
        const result = await query(sql, [id]);
        return result.rows[0];
    }

    /**
     * Toggle active status
     */
    static async toggle(id) {
        const sql = `
            UPDATE auto_replies 
            SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `;
        const result = await query(sql, [id]);
        return result.rows[0];
    }

    /**
     * Increment reply count
     */
    static async incrementReplyCount(id) {
        const sql = `
            UPDATE auto_replies 
            SET reply_count = reply_count + 1
            WHERE id = $1
        `;
        await query(sql, [id]);
    }

    /**
     * Find matching rule for a message
     */
    static async findMatch(clientId, messageText) {
        const rules = await this.getActive(clientId);

        for (const rule of rules) {
            const trigger = rule.trigger_word.toLowerCase();
            const text = messageText.toLowerCase();

            let matches = false;

            switch (rule.match_type) {
                case 'exact':
                    matches = text === trigger;
                    break;
                case 'starts':
                    matches = text.startsWith(trigger);
                    break;
                case 'ends':
                    matches = text.endsWith(trigger);
                    break;
                case 'contains':
                default:
                    matches = text.includes(trigger);
                    break;
            }

            if (matches) {
                return rule;
            }
        }

        return null;
    }
}

module.exports = AutoReply;
