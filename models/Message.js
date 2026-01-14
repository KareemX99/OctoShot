/**
 * Message Model
 * Handles database operations for messages
 */

const { query } = require('../config/database');

class Message {
    /**
     * Save a new message
     */
    static async create(data) {
        const sql = `
            INSERT INTO messages (
                client_id, message_id, chat_id, from_number, to_number,
                from_name, body, type, is_from_me, is_forwarded,
                has_media, media_url, media_type, timestamp, ack
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (message_id) DO UPDATE SET
                ack = EXCLUDED.ack,
                body = EXCLUDED.body
            RETURNING *
        `;

        const values = [
            data.client_id,
            data.message_id,
            data.chat_id,
            data.from_number,
            data.to_number,
            data.from_name,
            data.body,
            data.type || 'text',
            data.is_from_me || false,
            data.is_forwarded || false,
            data.has_media || false,
            data.media_url,
            data.media_type,
            data.timestamp || new Date(),
            data.ack || 0
        ];

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Get messages for a specific chat
     */
    static async getByChatId(chatId, limit = 50, offset = 0) {
        const sql = `
            SELECT * FROM messages 
            WHERE chat_id = $1 
            ORDER BY timestamp DESC 
            LIMIT $2 OFFSET $3
        `;
        const result = await query(sql, [chatId, limit, offset]);
        return result.rows;
    }

    /**
     * Get all chats with last message
     */
    static async getChatsWithLastMessage(clientId) {
        const sql = `
            SELECT DISTINCT ON (chat_id) 
                chat_id,
                from_number,
                to_number,
                from_name,
                body,
                type,
                is_from_me,
                timestamp,
                has_media
            FROM messages 
            WHERE client_id = $1
            ORDER BY chat_id, timestamp DESC
        `;
        const result = await query(sql, [clientId]);
        return result.rows;
    }

    /**
     * Get message statistics
     */
    static async getStats(clientId) {
        const sql = `
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_from_me = true) as sent,
                COUNT(*) FILTER (WHERE is_from_me = false) as received,
                COUNT(*) FILTER (WHERE DATE(timestamp) = CURRENT_DATE) as today,
                COUNT(*) FILTER (WHERE has_media = true) as with_media
            FROM messages
            WHERE client_id = $1
        `;
        const result = await query(sql, [clientId]);
        return result.rows[0];
    }

    /**
     * Get recent messages
     */
    static async getRecent(clientId, limit = 10) {
        const sql = `
            SELECT * FROM messages 
            WHERE client_id = $1 
            ORDER BY timestamp DESC 
            LIMIT $2
        `;
        const result = await query(sql, [clientId, limit]);
        return result.rows;
    }

    /**
     * Search messages
     */
    static async search(clientId, searchTerm, limit = 50) {
        const sql = `
            SELECT * FROM messages 
            WHERE client_id = $1 AND body ILIKE $2
            ORDER BY timestamp DESC 
            LIMIT $3
        `;
        const result = await query(sql, [clientId, `%${searchTerm}%`, limit]);
        return result.rows;
    }
}

module.exports = Message;
