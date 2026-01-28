require('dotenv').config();
const { pool } = require('../config/database');

async function migrate() {
    console.log('🚀 Starting migration: Add source/tags to contacts...');

    try {
        // Add source column
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='source') THEN 
                    ALTER TABLE contacts ADD COLUMN source VARCHAR(255) DEFAULT 'unknown'; 
                    RAISE NOTICE 'Added source column';
                END IF;
            END $$;
        `);

        // Add tags column
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='contacts' AND column_name='tags') THEN 
                    ALTER TABLE contacts ADD COLUMN tags TEXT DEFAULT '[]'; 
                    RAISE NOTICE 'Added tags column';
                END IF;
            END $$;
        `);

        console.log('✅ Migration successful!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();
