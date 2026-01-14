/**
 * Migration: Add timezone column to clients table
 * Run: node scripts/migrateTimezone.js
 */

require('dotenv').config();
const { pool, testConnection } = require('../config/database');

const migrationSQL = `
-- Add timezone column to clients table
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Africa/Cairo';

-- Update existing rows
UPDATE clients SET timezone = 'Africa/Cairo' WHERE timezone IS NULL;
`;

async function runMigration() {
    console.log('🚀 Running Timezone migration...\\n');

    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
    }

    try {
        console.log('📦 Adding timezone column to clients table...');
        await pool.query(migrationSQL);
        console.log('✅ Column added successfully!');

        // Show updated table
        const result = await pool.query(`
            SELECT id, device_name, phone_number, timezone 
            FROM clients
        `);

        console.log('\\n📋 Clients with timezone:');
        result.rows.forEach(row => {
            console.log(`   ${row.id}. ${row.device_name || 'Unknown'} (${row.phone_number}) - ${row.timezone}`);
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
