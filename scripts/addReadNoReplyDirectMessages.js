/**
 * Migration: Add direct messages support for read-no-reply webhooks
 * 
 * Adds:
 * 1. include_direct_messages column to read_no_reply_webhooks table
 * 2. no_reply_notified column to messages table
 * 3. no_reply_notified_at column to messages table
 */

require('dotenv').config();
const { pool } = require('../config/database');

async function migrate() {
    console.log('🔧 Running migration: Add direct messages support for read-no-reply webhooks...\n');

    try {
        // 1. Add include_direct_messages to read_no_reply_webhooks
        console.log('Adding include_direct_messages to read_no_reply_webhooks...');
        await pool.query(`
            ALTER TABLE read_no_reply_webhooks 
            ADD COLUMN IF NOT EXISTS include_direct_messages BOOLEAN DEFAULT true
        `);
        console.log('✅ Added include_direct_messages column');

        // 2. Add no_reply_notified to messages table
        console.log('Adding no_reply_notified to messages...');
        await pool.query(`
            ALTER TABLE messages 
            ADD COLUMN IF NOT EXISTS no_reply_notified BOOLEAN DEFAULT false
        `);
        console.log('✅ Added no_reply_notified column');

        // 3. Add no_reply_notified_at to messages table
        console.log('Adding no_reply_notified_at to messages...');
        await pool.query(`
            ALTER TABLE messages 
            ADD COLUMN IF NOT EXISTS no_reply_notified_at TIMESTAMP
        `);
        console.log('✅ Added no_reply_notified_at column');

        // 4. Create index for faster queries
        console.log('Creating index for no_reply_notified...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_no_reply_notified 
            ON messages(client_id, is_from_me, ack, no_reply_notified)
            WHERE is_from_me = true AND ack >= 3 AND no_reply_notified = false
        `);
        console.log('✅ Created index');

        console.log('\n✅ Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

migrate();
