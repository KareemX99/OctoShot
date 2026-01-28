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
                profile_pic_url, about, source, tags
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (contact_id) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, contacts.name),
                push_name = COALESCE(EXCLUDED.push_name, contacts.push_name),
                is_blocked = EXCLUDED.is_blocked,
                profile_pic_url = COALESCE(EXCLUDED.profile_pic_url, contacts.profile_pic_url),
                about = COALESCE(EXCLUDED.about, contacts.about),
                source = COALESCE(contacts.source, EXCLUDED.source), 
                tags = COALESCE(contacts.tags, EXCLUDED.tags),
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
            data.about,
            data.source || 'unknown',
            data.tags || '[]'
        ];

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Get all contacts for a client with optional filtering
     * filterType: 'all', 'groups', 'history'
     */
    static async getAll(clientId, limit = 100, offset = 0, filterType = 'all') {
        let filterClause = '';
        if (filterType === 'groups') {
            filterClause = `AND (source LIKE 'Group:%' OR source LIKE 'Example Group%' OR tags LIKE '%"group"%')`;
        } else if (filterType === 'history') {
            filterClause = `AND (source NOT LIKE 'Group:%' AND source NOT LIKE 'Example Group%' AND (tags IS NULL OR tags NOT LIKE '%"group"%'))`;
        }

        const sql = `
            SELECT *, source, tags FROM contacts 
            WHERE client_id = $1 ${filterClause}
            ORDER BY created_at DESC
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
            SELECT *, source, tags FROM contacts 
            WHERE client_id = $1 
            AND (
                phone_number ILIKE $2 OR 
                name ILIKE $2 OR 
                push_name ILIKE $2 OR
                source ILIKE $2
            )
            LIMIT 50
        `;
        const result = await query(sql, [clientId, `%${searchTerm}%`]);
        return result.rows;
    }

    /**
     * Set contact blocked status
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
     * Get contact count with optional filtering
     */
    static async getCount(clientId, filterType = 'all') {
        let filterClause = '';
        if (filterType === 'groups') {
            filterClause = `AND (source LIKE 'Group:%' OR source LIKE 'Example Group%' OR tags LIKE '%"group"%')`;
        } else if (filterType === 'history') {
            filterClause = `AND (source NOT LIKE 'Group:%' AND source NOT LIKE 'Example Group%' AND (tags IS NULL OR tags NOT LIKE '%"group"%'))`;
        }

        const sql = `
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_blocked = true) as blocked,
                COUNT(*) FILTER (WHERE is_business = true) as business
            FROM contacts
            WHERE client_id = $1 ${filterClause}
        `;
        const result = await query(sql, [clientId]);
        return result.rows[0];
    }
}

module.exports = Contact;
