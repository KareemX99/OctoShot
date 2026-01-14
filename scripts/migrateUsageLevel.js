/**
 * Migration Script: Usage Level System
 * 
 * Adds columns for:
 * - Usage Level classification (0-5)
 * - Daily message limits
 * - Campaign tracking hours
 * - Questionnaire data
 * - Ban/warning history
 */

const { pool } = require('../config/database');

async function migrate() {
    console.log('🔄 Running Usage Level migration...');

    try {
        // Add Usage Level columns to clients table
        await pool.query(`
            ALTER TABLE clients 
            ADD COLUMN IF NOT EXISTS usage_level INTEGER DEFAULT 1,
            ADD COLUMN IF NOT EXISTS daily_limit INTEGER DEFAULT 50,
            ADD COLUMN IF NOT EXISTS campaign_active_hours DECIMAL(10,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS current_level_hours DECIMAL(10,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS usage_questionnaire JSONB,
            ADD COLUMN IF NOT EXISTS last_warning_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS warning_count INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS questionnaire_completed BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS current_level_started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `);

        console.log('✅ Added usage_level columns to clients');

        // Create usage level history table for tracking progression
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usage_level_history (
                id SERIAL PRIMARY KEY,
                profile_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
                old_level INTEGER,
                new_level INTEGER,
                old_daily_limit INTEGER,
                new_daily_limit INTEGER,
                reason VARCHAR(255),
                trigger_type VARCHAR(50), -- 'promotion', 'demotion', 'questionnaire', 'manual'
                campaign_hours_at_change DECIMAL(10,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Created usage_level_history table');

        // Create index for faster lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_usage_level_history_profile 
            ON usage_level_history(profile_id, created_at DESC)
        `);

        console.log('✅ Created indexes');

        // Update existing clients with default values based on current trust_level
        // This is a one-time migration to set initial usage levels
        await pool.query(`
            UPDATE clients 
            SET 
                usage_level = CASE 
                    WHEN trust_level >= 4 THEN 3
                    WHEN trust_level >= 3 THEN 2
                    ELSE 1
                END,
                daily_limit = CASE 
                    WHEN trust_level >= 4 THEN 100
                    WHEN trust_level >= 3 THEN 70
                    ELSE 50
                END
            WHERE usage_level IS NULL OR usage_level = 1
        `);

        console.log('✅ Migrated existing clients with initial usage levels');

        console.log('🎉 Usage Level migration completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

migrate();
