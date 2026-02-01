/**
 * Fix pg-boss schema - Add missing maintained_on column
 * Run with: node scripts/fix_pgboss_schema.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function fixPgBossSchema() {
    const client = await pool.connect();

    try {
        console.log('🔄 Starting pg-boss schema fix...');

        // Check if pgboss schema exists
        const schemaCheck = await client.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name = 'pgboss'
        `);

        if (schemaCheck.rows.length === 0) {
            console.log('⚠️ pgboss schema does not exist. pg-boss will create it on first run.');
            return;
        }

        // Check if job table exists
        const tableCheck = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'pgboss' AND table_name = 'job'
        `);

        if (tableCheck.rows.length === 0) {
            console.log('⚠️ pgboss.job table does not exist. pg-boss will create it on first run.');
            return;
        }

        // Check if maintained_on column exists
        const columnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'pgboss' 
            AND table_name = 'job' 
            AND column_name = 'maintained_on'
        `);

        if (columnCheck.rows.length === 0) {
            console.log('📝 Adding maintained_on column to pgboss.job...');
            await client.query(`
                ALTER TABLE pgboss.job 
                ADD COLUMN maintained_on timestamp with time zone
            `);
            console.log('✅ maintained_on column added successfully!');
        } else {
            console.log('✅ maintained_on column already exists.');
        }

        // Create index if not exists
        console.log('📝 Ensuring index on maintained_on...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS job_maintained_on_idx 
            ON pgboss.job (maintained_on)
        `);
        console.log('✅ Index ensured.');

        // Check version table
        const versionCheck = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'pgboss' AND table_name = 'version'
        `);

        if (versionCheck.rows.length === 0) {
            console.log('📝 Creating pgboss.version table...');
            await client.query(`
                CREATE TABLE pgboss.version (
                    version text NOT NULL
                )
            `);
            await client.query(`INSERT INTO pgboss.version (version) VALUES ('21')`);
            console.log('✅ Version table created with version 21.');
        } else {
            const currentVersion = await client.query(`SELECT version FROM pgboss.version`);
            console.log(`✅ Version table exists. Current version: ${currentVersion.rows[0]?.version || 'unknown'}`);
        }

        console.log('');
        console.log('🎉 pg-boss schema fix complete!');
        console.log('👉 Please restart the server to apply changes.');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

fixPgBossSchema().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
