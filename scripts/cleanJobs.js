const pool = require('../config/database');

async function cleanJobs() {
    // Delete failed jobs
    const deleteResult = await pool.query("DELETE FROM pgboss.job WHERE state = 'failed'");
    console.log(`Deleted ${deleteResult.rowCount} failed jobs`);

    // Show remaining jobs
    const remaining = await pool.query("SELECT name, state, COUNT(*) as cnt FROM pgboss.job GROUP BY name, state");
    console.log('Remaining jobs:', JSON.stringify(remaining.rows, null, 2));

    process.exit(0);
}

cleanJobs();
