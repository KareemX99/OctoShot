/**
 * Migration: Add profile_picture_url column to clients table
 * This stores the WhatsApp profile picture URL for each device
 */

require('dotenv').config();
const { pool } = require('../config/database');

(async () => {
    try {
        console.log('🔧 Adding profile_picture_url column to clients table...');

        // Check if column already exists
        const check = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'clients' AND column_name = 'profile_picture_url'
        `);

        if (check.rows.length > 0) {
            console.log('✅ Column profile_picture_url already exists, skipping.');
        } else {
            await pool.query(`
                ALTER TABLE clients 
                ADD COLUMN profile_picture_url TEXT
            `);
            console.log('✅ Column profile_picture_url added successfully!');
        }
    } catch (error) {
        console.error('❌ Migration error:', error.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
})();
