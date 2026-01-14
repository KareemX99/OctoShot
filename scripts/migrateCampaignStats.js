/**
 * Migration: Add delivered_count and read_count to campaigns table
 * Also add ack_level, delivered_at, read_at to campaign_message_log
 * 
 * Run with: node scripts/migrateCampaignStats.js
 */

const { pool } = require('../config/database');

async function migrate() {
    console.log('🔄 Starting campaign stats migration...');

    try {
        // 1. Add delivered_count and read_count to campaigns table
        console.log('📊 Adding delivered_count, read_count to campaigns table...');
        await pool.query(`
            ALTER TABLE campaigns 
            ADD COLUMN IF NOT EXISTS delivered_count INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS read_count INTEGER DEFAULT 0
        `);
        console.log('✅ Added delivered_count, read_count to campaigns');

        // 2. Add ack_level, delivered_at, read_at to campaign_message_log
        console.log('📊 Adding ack tracking columns to campaign_message_log...');
        await pool.query(`
            ALTER TABLE campaign_message_log
            ADD COLUMN IF NOT EXISTS ack_level INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS read_at TIMESTAMP
        `);
        console.log('✅ Added ack_level, delivered_at, read_at to campaign_message_log');

        // 3. Create index for faster whatsapp_message_id lookups
        console.log('📊 Creating index for whatsapp_message_id...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_campaign_message_log_wa_msg_id 
            ON campaign_message_log(whatsapp_message_id)
        `);
        console.log('✅ Created index for whatsapp_message_id');

        console.log('\n✅ Migration completed successfully!');
    } catch (error) {
        console.error('❌ Migration error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

migrate().catch(console.error);
