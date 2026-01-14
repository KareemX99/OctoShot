/**
 * Database Migration: Create profile_logs table
 * Run this script to create the logging table
 */

const { pool } = require('../config/database');

async function createProfileLogsTable() {
    console.log('🔧 Creating profile_logs table...');

    try {
        // Create the profile_logs table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS profile_logs (
                id SERIAL PRIMARY KEY,
                client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
                log_type VARCHAR(50) NOT NULL,
                log_level VARCHAR(20) DEFAULT 'info',
                message TEXT NOT NULL,
                details JSONB,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ profile_logs table created');

        // Create indexes for performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_client ON profile_logs(client_id);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_type ON profile_logs(log_type);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_level ON profile_logs(log_level);
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_created ON profile_logs(created_at DESC);
        `);
        console.log('✅ Indexes created');

        // Create a composite index for common query pattern
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_logs_client_type_created 
            ON profile_logs(client_id, log_type, created_at DESC);
        `);
        console.log('✅ Composite index created');

        console.log('🎉 Migration complete!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

createProfileLogsTable();
