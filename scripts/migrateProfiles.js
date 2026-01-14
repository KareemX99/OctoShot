/**
 * Database Migration: Add profile columns to clients table
 * Run: node scripts/migrateProfiles.js
 */

require('dotenv').config();
const { pool, testConnection } = require('../config/database');

const crypto = require('crypto');

const migrationSQL = `
-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Add UUID column with default
ALTER TABLE clients ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT uuid_generate_v4();

-- Add API key column
ALTER TABLE clients ADD COLUMN IF NOT EXISTS api_key VARCHAR(64);

-- Add device name column
ALTER TABLE clients ADD COLUMN IF NOT EXISTS device_name VARCHAR(255);

-- Add رابط Webhook column
ALTER TABLE clients ADD COLUMN IF NOT EXISTS webhook_url TEXT;

-- Create unique index on uuid
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_uuid ON clients(uuid);

-- Create index on api_key for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_api_key ON clients(api_key);

-- Update existing rows to have UUID
UPDATE clients 
SET uuid = uuid_generate_v4() 
WHERE uuid IS NULL;
`;

async function runMigration() {
    console.log('🚀 Running profiles migration...\n');

    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
    }

    try {
        console.log('📦 Adding new columns to clients table...');
        await pool.query(migrationSQL);
        console.log('✅ Columns added successfully!');

        // Generate API keys for rows without one
        console.log('🔑 Generating API keys for existing rows...');
        const rowsWithoutKey = await pool.query('SELECT id FROM clients WHERE api_key IS NULL');

        for (const row of rowsWithoutKey.rows) {
            const apiKey = crypto.randomBytes(32).toString('hex');
            await pool.query('UPDATE clients SET api_key = $1 WHERE id = $2', [apiKey, row.id]);
        }
        console.log(`✅ Generated ${rowsWithoutKey.rows.length} API keys`);

        // Show updated table structure
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'clients'
            ORDER BY ordinal_position
        `);

        console.log('\n📋 Clients table columns:');
        result.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. ${row.column_name} (${row.data_type})`);
        });

        console.log('\n✅ Migration completed successfully!');

    } catch (error) {
        console.error('❌ Migration error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
