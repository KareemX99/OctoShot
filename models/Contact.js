/**
 * Contact Model
 * Handles database operations for contacts
 */

const { query } = require('../config/database');

class Contact {
    /**
     * Create or update a contact
     */
    static async upsert(data) {
        const sql = `
            INSERT INTO contacts (
                client_id, contact_id, phone_number, name, push_name,
                short_name, is_business, is_blocked, is_my_contact,
                profile_pic_url, about
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (contact_id) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, contacts.name),
                push_name = COALESCE(EXCLUDED.push_name, contacts.push_name),
                is_blocked = EXCLUDED.is_blocked,
                profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, contacts.profile_pic_url),
                about = COALESCE(EXCLUDED.about, contacts.about),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;

        const values = [
            data.client_id,
            data.contact_id,
            data.phone_number,
            data.name,
            data.push_name,
            data.short_name,
            data.is_business || false,
            data.is_blocked || false,
            data.is_my_contact || false,
            data.profile_pic_url,
            data.about
        ];

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Get all contacts for a client
     */
    static async getAll(clientId, limit = 100, offset = 0) {
        const sql = `
            SELECT * FROM contacts 
            WHERE client_id = $1 
            ORDER BY name ASC, push_name ASC
            LIMIT $2 OFFSET $3
        `;
        const result = await query(sql, [clientId, limit, offset]);
        return result.rows;
    }

    /**
     * Get contact by ID
     */
    static async getById(contactId) {
        const sql = `SELECT * FROM contacts WHERE contact_id = $1`;
        const result = await query(sql, [contactId]);
        return result.rows[0];
    }

    /**
     * Search contacts
     */
    static async search(clientId, searchTerm) {
        const sql = `
            SELECT * FROM contacts 
            WHERE client_id = $1 
            AND (name ILIKE $2 OR push_name ILIKE $2 OR phone_number ILIKE $2)
            ORDER BY name ASC
            LIMIT 50
        `;
        const result = await query(sql, [clientId, `%${searchTerm}%`]);
        return result.rows;
    }

    /**
     * Update block status
     */
    static async setBlocked(contactId, isBlocked) {
        const sql = `
            UPDATE contacts 
            SET is_blocked = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE contact_id = $2
            RETURNING *
        `;
        const result = await query(sql, [isBlocked, contactId]);
        return result.rows[0];
    }

    /**
     * Get blocked contacts
     */
    static async getBlocked(clientId) {
        const sql = `
            SELECT * FROM contacts 
            WHERE client_id = $1 AND is_blocked = true
            ORDER BY name ASC
        `;
        const result = await query(sql, [clientId]);
        return result.rows;
    }

    /**
     * Get contact count
     */
    static async getCount(clientId) {
        const sql = `
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_blocked = true) as blocked,
                COUNT(*) FILTER (WHERE is_business = true) as business
            FROM contacts
            WHERE client_id = $1
        `;
        const result = await query(sql, [clientId]);
        return result.rows[0];
    }
}

module.exports = Contact;
