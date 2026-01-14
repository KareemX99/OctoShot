/**
 * Migration: Add Read No-Reply Webhooks Table
 * 
 * This creates the read_no_reply_webhooks table and adds
 * necessary columns to api_message_queue for tracking
 * read status and customer replies.
 */

const { pool } = require('../config/database');

async function migrate() {
    console.log('🔄 Starting Read No-Reply Webhooks migration...');

    try {
        // Create read_no_reply_webhooks table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS read_no_reply_webhooks (
                id SERIAL PRIMARY KEY,
                client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
                webhook_url TEXT NOT NULL,
                timer_value INTEGER NOT NULL DEFAULT 5,
                timer_unit VARCHAR(10) NOT NULL DEFAULT 'minutes',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Created read_no_reply_webhooks table');

        // Add read_at column to api_message_queue
        await pool.query(`
            ALTER TABLE api_message_queue 
            ADD COLUMN IF NOT EXISTS read_at TIMESTAMP
        `);
        console.log('✅ Added read_at column');

        // Add customer_replied column
        await pool.query(`
            ALTER TABLE api_message_queue 
            ADD COLUMN IF NOT EXISTS customer_replied BOOLEAN DEFAULT false
        `);
        console.log('✅ Added customer_replied column');

        // Add no_reply_notified column
        await pool.query(`
            ALTER TABLE api_message_queue 
            ADD COLUMN IF NOT EXISTS no_reply_notified BOOLEAN DEFAULT false
        `);
        console.log('✅ Added no_reply_notified column');

        // Add no_reply_notified_at column
        await pool.query(`
            ALTER TABLE api_message_queue 
            ADD COLUMN IF NOT EXISTS no_reply_notified_at TIMESTAMP
        `);
        console.log('✅ Added no_reply_notified_at column');

        console.log('🎉 Read No-Reply Webhooks migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

migrate();
