/**
 * Campaign System Database Migration
 * Creates the campaign tables for the Bulk Messages Campaign feature
 */

const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    console.log('🚀 Starting Campaign System migration...\n');

    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'migrate_campaigns.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Execute the migration
        await pool.query(sql);

        console.log('✅ Campaign tables created successfully!\n');

        // Verify tables exist
        const tables = ['campaigns', 'campaign_steps', 'campaign_enrollments', 'campaign_message_log'];

        for (const table of tables) {
            const result = await pool.query(`
                SELECT COUNT(*) FROM information_schema.tables 
                WHERE table_name = $1
            `, [table]);

            if (parseInt(result.rows[0].count) > 0) {
                console.log(`   ✓ Table '${table}' exists`);
            } else {
                console.log(`   ✗ Table '${table}' NOT found`);
            }
        }

        console.log('\n✅ Migration completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
