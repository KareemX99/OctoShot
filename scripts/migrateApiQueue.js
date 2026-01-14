/**
 * Database Migration: Create API Message Queue and Blacklist tables
 * Run: node scripts/migrateApiQueue.js
 */

require('dotenv').config();
const { pool, testConnection } = require('../config/database');

const migrationSQL = `
-- Enable uuid-ossp extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- API Message Queue Table
CREATE TABLE IF NOT EXISTS api_message_queue (
    id SERIAL PRIMARY KEY,
    batch_id UUID DEFAULT uuid_generate_v4(),
    device_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    recipient VARCHAR(50) NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    original_content TEXT,
    resolved_content TEXT,
    media_url TEXT,
    caption TEXT,
    status VARCHAR(20) DEFAULT 'queued',
    whatsapp_message_id VARCHAR(100),
    ack_level INTEGER DEFAULT 0,
    error_message TEXT,
    scheduled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP
);

-- Blacklist Table (for STOP opt-outs)
CREATE TABLE IF NOT EXISTS blacklist (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    reason VARCHAR(50) DEFAULT 'stop_keyword',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(device_id, phone_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_queue_batch_id ON api_message_queue(batch_id);
CREATE INDEX IF NOT EXISTS idx_queue_device_id ON api_message_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_queue_status ON api_message_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_created_at ON api_message_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_queue_whatsapp_id ON api_message_queue(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_phone ON blacklist(device_id, phone_number);
`;

async function runMigration() {
    console.log('🚀 Running API Queue migration...\\n');

    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
    }

    try {
        console.log('📦 Creating api_message_queue and blacklist tables...');
        await pool.query(migrationSQL);
        console.log('✅ Tables created successfully!');

        // Show table info
        const queueCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'api_message_queue'
            ORDER BY ordinal_position
        `);

        console.log('\\n📋 api_message_queue columns:');
        queueCols.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. ${row.column_name} (${row.data_type})`);
        });

        const blacklistCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'blacklist'
            ORDER BY ordinal_position
        `);

        console.log('\\n📋 blacklist columns:');
        blacklistCols.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. ${row.column_name} (${row.data_type})`);
        });

        console.log('\\n✅ Migration completed successfully!');

    } catch (error) {
        console.error('❌ Migration error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
