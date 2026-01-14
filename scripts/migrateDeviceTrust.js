/**
 * Migration: Add device trust columns
 * Run: node scripts/migrateDeviceTrust.js
 */

require('dotenv').config();
const { pool, testConnection } = require('../config/database');

const migrationSQL = `
-- Add trust columns to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_connected_at TIMESTAMP;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS total_sent_count INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS trust_level INTEGER DEFAULT 1;

-- Add batch_number to api_message_queue
ALTER TABLE api_message_queue ADD COLUMN IF NOT EXISTS batch_number INTEGER DEFAULT 1;
ALTER TABLE api_message_queue ADD COLUMN IF NOT EXISTS campaign_id UUID;

-- Create index for campaign queries
CREATE INDEX IF NOT EXISTS idx_queue_campaign_id ON api_message_queue(campaign_id);
`;

async function runMigration() {
    console.log('🚀 Running Device Trust migration...\\n');

    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
    }

    try {
        await pool.query(migrationSQL);
        console.log('✅ Trust columns added to clients table!');
        console.log('✅ Batch columns added to api_message_queue!');

        // Set first_connected_at for already connected devices
        await pool.query(`
            UPDATE clients 
            SET first_connected_at = NOW() 
            WHERE status = 'connected' AND first_connected_at IS NULL
        `);
        console.log('✅ Updated first_connected_at for connected devices!');

        // Show current trust levels
        const result = await pool.query(`
            SELECT id, device_name, phone_number, trust_level, first_connected_at 
            FROM clients
        `);

        console.log('\\n📋 Clients with trust levels:');
        result.rows.forEach(row => {
            const emoji = row.trust_level === 1 ? '⚠️' : row.trust_level === 4 ? '🌟' : '🟢';
            console.log(`   ${emoji} ${row.id}. ${row.device_name || 'Unknown'} - Level ${row.trust_level}`);
        });

    } catch (error) {
        console.error('❌ Migration error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
