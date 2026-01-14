/**
 * Add Unread Webhooks Table Migration
 * Run: node scripts/addUnreadWebhooksTable.js
 */

require('dotenv').config();
const { pool } = require('../config/database');

const migration = async () => {
    console.log('🔄 Running migration: Add unread_webhooks table...');

    try {
        // Create unread_webhooks table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS unread_webhooks (
                id SERIAL PRIMARY KEY,
                client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
                webhook_url TEXT NOT NULL,
                timer_value INTEGER NOT NULL DEFAULT 5,
                timer_unit VARCHAR(10) NOT NULL DEFAULT 'minutes',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Created unread_webhooks table');

        // Create index on client_id
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_unread_webhooks_client_id 
            ON unread_webhooks(client_id);
        `);
        console.log('✅ Created index on client_id');

        // Add unread_notified column to api_message_queue if not exists
        await pool.query(`
            ALTER TABLE api_message_queue 
            ADD COLUMN IF NOT EXISTS unread_notified BOOLEAN DEFAULT false;
        `);
        console.log('✅ Added unread_notified column to api_message_queue');

        // Add unread_notified_at column
        await pool.query(`
            ALTER TABLE api_message_queue 
            ADD COLUMN IF NOT EXISTS unread_notified_at TIMESTAMP;
        `);
        console.log('✅ Added unread_notified_at column to api_message_queue');

        console.log('\n✅ Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
};

migration();
