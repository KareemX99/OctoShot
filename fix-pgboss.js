/**
 * Script to fix pg-boss schema mismatch
 * Drops the pgboss schema so it can be recreated with correct columns
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT) || 5432,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function fixPgBoss() {
    console.log('🔧 Fixing pg-boss schema...');

    try {
        // Drop the entire pgboss schema with all its tables
        await pool.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
        console.log('✅ Dropped pgboss schema successfully');
        console.log('👉 Restart the server - pg-boss will recreate the schema with correct columns');
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

fixPgBoss();
