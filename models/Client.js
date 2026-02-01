/**
 * Client Model - Extended for Profile Management
 * Handles database operations for WhatsApp clients/profiles
 */

const { query } = require('../config/database');
const crypto = require('crypto');

class Client {
    /**
     * Generate a random API key
     */
    static generateAPIKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Create a new profile
     */
    static async create(data) {
        const apiKey = this.generateAPIKey();

        const sql = `
            INSERT INTO clients (
                device_name, webhook_url, api_key, status
            ) VALUES ($1, $2, $3, $4)
            RETURNING *
        `;

        const values = [
            data.device_name || 'New Device',
            data.webhook_url || null,
            apiKey,
            'disconnected'
        ];

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Create or update a client (legacy support)
     */
    static async upsert(data) {
        const sql = `
            INSERT INTO clients (
                phone_number, name, push_name, platform, status
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (phone_number) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, clients.name),
                push_name = COALESCE(EXCLUDED.push_name, clients.push_name),
                platform = COALESCE(EXCLUDED.platform, clients.platform),
                status = EXCLUDED.status,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;

        const values = [
            data.phone_number,
            data.name,
            data.push_name,
            data.platform,
            data.status || 'disconnected'
        ];

        const result = await query(sql, values);
        return result.rows[0];
    }

    /**
     * Get client by UUID
     */
    static async getByUUID(uuid) {
        const sql = `SELECT * FROM clients WHERE uuid = $1`;
        const result = await query(sql, [uuid]);
        return result.rows[0];
    }

    /**
     * Get client by API key
     */
    static async getByAPIKey(apiKey) {
        const sql = `SELECT * FROM clients WHERE api_key = $1`;
        const result = await query(sql, [apiKey]);
        return result.rows[0];
    }

    /**
     * Get client by phone number
     */
    static async getByPhoneNumber(phoneNumber) {
        const sql = `SELECT * FROM clients WHERE phone_number = $1`;
        const result = await query(sql, [phoneNumber]);
        return result.rows[0];
    }

    /**
     * Get all clients by status (for auto-restore)
     */
    static async getByStatus(status) {
        const sql = `SELECT * FROM clients WHERE status = $1 ORDER BY id`;
        const result = await query(sql, [status]);
        return result.rows;
    }

    /**
     * Get client by ID
     */
    static async getById(id) {
        const sql = `SELECT * FROM clients WHERE id = $1`;
        const result = await query(sql, [id]);
        return result.rows[0];
    }

    /**
     * Update client profile
     */
    static async update(id, data) {
        const sql = `
            UPDATE clients 
            SET 
                device_name = COALESCE($1, device_name),
                webhook_url = COALESCE($2, webhook_url),
                timezone = COALESCE($3, timezone),
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = $4
            RETURNING *
        `;
        const result = await query(sql, [data.device_name, data.webhook_url, data.timezone, id]);
        return result.rows[0];
    }

    /**
     * Update client status and phone info
     */
    static async updateConnection(id, data) {
        // If phone_number is provided, clear it from any other profile first
        // This allows same phone to be moved between profiles
        if (data.phone_number) {
            await query(`
                UPDATE clients 
                SET phone_number = NULL 
                WHERE phone_number = $1 AND id != $2
            `, [data.phone_number, id]);
        }

        const sql = `
            UPDATE clients 
            SET 
                phone_number = COALESCE($1, phone_number),
                name = COALESCE($2, name),
                push_name = COALESCE($3, push_name),
                platform = COALESCE($4, platform),
                status = $5,
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = $6
            RETURNING *
        `;
        const result = await query(sql, [
            data.phone_number,
            data.name,
            data.push_name,
            data.platform,
            data.status,
            id
        ]);
        return result.rows[0];
    }

    /**
     * Update client status
     */
    static async updateStatus(id, status) {
        const sql = `
            UPDATE clients 
            SET status = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(sql, [status, id]);
        return result.rows[0];
    }

    /**
     * Regenerate API key
     */
    static async regenerateAPIKey(id) {
        const newApiKey = this.generateAPIKey();
        const sql = `
            UPDATE clients 
            SET api_key = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2
            RETURNING *
        `;
        const result = await query(sql, [newApiKey, id]);
        return result.rows[0];
    }

    /**
     * Delete a client
     */
    static async delete(id) {
        // First, clear any campaign enrollment references to this device
        await query(`
            UPDATE campaign_enrollments 
            SET assigned_device_id = NULL 
            WHERE assigned_device_id = $1
        `, [id]);

        const sql = `DELETE FROM clients WHERE id = $1 RETURNING *`;
        const result = await query(sql, [id]);
        return result.rows[0];
    }

    /**
     * Get all clients
     */
    static async getAll() {
        const sql = `SELECT * FROM clients ORDER BY created_at DESC`;
        const result = await query(sql);
        return result.rows;
    }

    /**
     * Search clients by device name or phone number
     */
    static async search(searchQuery) {
        const sql = `
            SELECT * FROM clients 
            WHERE device_name ILIKE $1 
               OR phone_number ILIKE $1 
               OR uuid::text ILIKE $1
            ORDER BY created_at DESC
        `;
        const result = await query(sql, [`%${searchQuery}%`]);
        return result.rows;
    }

    /**
     * Get count of all clients
     */
    static async getCount() {
        const sql = `SELECT COUNT(*) as count FROM clients`;
        const result = await query(sql);
        return parseInt(result.rows[0].count);
    }

    /**
     * Get or create default client (legacy support)
     */
    static async getOrCreateDefault() {
        const existing = await query(`SELECT * FROM clients LIMIT 1`);
        if (existing.rows.length > 0) {
            return existing.rows[0];
        }

        const sql = `
            INSERT INTO clients (device_name, status, api_key)
            VALUES ('Default Device', 'disconnected', $1)
            RETURNING *
        `;
        const result = await query(sql, [this.generateAPIKey()]);
        return result.rows[0];
    }
}

module.exports = Client;
