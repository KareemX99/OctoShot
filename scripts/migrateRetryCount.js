/**
 * Migration: Add retry_count column to api_message_queue
 * Run: node scripts/migrateRetryCount.js
 */

require('dotenv').config();
const { pool, testConnection } = require('../config/database');

const migrationSQL = `
-- Add retry_count column
ALTER TABLE api_message_queue 
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Update existing failed to pending for retry
UPDATE api_message_queue 
SET status = 'pending', retry_count = 0 
WHERE status = 'failed';
`;

async function runMigration() {
    console.log('🚀 Running retry_count migration...\\n');

    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
    }

    try {
        await pool.query(migrationSQL);
        console.log('✅ retry_count column added successfully!');
        console.log('✅ Failed messages reset to pending!');
    } catch (error) {
        console.error('❌ Migration error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
