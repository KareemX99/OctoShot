/**
 * Blacklist Model
 * Handles opt-out phone numbers
 */

const { pool } = require('../config/database');

class Blacklist {
    /**
     * Add phone number to blacklist
     */
    static async add(deviceId, phoneNumber, reason = 'stop_keyword') {
        // Clean phone number
        const cleanPhone = phoneNumber.replace('@c.us', '').replace('@s.whatsapp.net', '');

        const query = `
            INSERT INTO blacklist (device_id, phone_number, reason)
            VALUES ($1, $2, $3)
            ON CONFLICT (device_id, phone_number) DO UPDATE SET reason = $3
            RETURNING *
        `;

        const result = await pool.query(query, [deviceId, cleanPhone, reason]);
        return result.rows[0];
    }

    /**
     * Check if phone number is blacklisted
     */
    static async isBlacklisted(deviceId, phoneNumber) {
        const cleanPhone = phoneNumber.replace('@c.us', '').replace('@s.whatsapp.net', '');

        const result = await pool.query(
            'SELECT id FROM blacklist WHERE device_id = $1 AND phone_number = $2',
            [deviceId, cleanPhone]
        );

        return result.rows.length > 0;
    }

    /**
     * Remove from blacklist
     */
    static async remove(deviceId, phoneNumber) {
        const cleanPhone = phoneNumber.replace('@c.us', '').replace('@s.whatsapp.net', '');

        const result = await pool.query(
            'DELETE FROM blacklist WHERE device_id = $1 AND phone_number = $2 RETURNING *',
            [deviceId, cleanPhone]
        );

        return result.rows[0];
    }

    /**
     * Get all blacklisted numbers for device
     */
    static async getByDevice(deviceId) {
        const result = await pool.query(
            'SELECT * FROM blacklist WHERE device_id = $1 ORDER BY created_at DESC',
            [deviceId]
        );
        return result.rows;
    }

    /**
     * Filter out blacklisted numbers from list
     */
    static async filterBlacklisted(deviceId, phoneNumbers) {
        if (!phoneNumbers || phoneNumbers.length === 0) return phoneNumbers;

        const cleanNumbers = phoneNumbers.map(p =>
            p.replace('@c.us', '').replace('@s.whatsapp.net', '')
        );

        const result = await pool.query(
            'SELECT phone_number FROM blacklist WHERE device_id = $1 AND phone_number = ANY($2)',
            [deviceId, cleanNumbers]
        );

        const blacklisted = new Set(result.rows.map(r => r.phone_number));

        return cleanNumbers.filter(p => !blacklisted.has(p));
    }
}

module.exports = Blacklist;
