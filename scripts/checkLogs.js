// Quick profile logs check
const { pool } = require('../config/database');

async function checkLogs() {
    try {
        const r = await pool.query(`
            SELECT log_type, log_level, message, details, created_at 
            FROM profile_logs 
            WHERE client_id = 58 
            ORDER BY created_at DESC 
            LIMIT 20
        `);
        console.log('=== Last 20 Logs for Profile 58 ===\n');
        r.rows.forEach((log, i) => {
            console.log(`[${i + 1}] ${log.created_at}`);
            console.log(`    Type: ${log.log_type} | Level: ${log.log_level}`);
            console.log(`    Message: ${log.message}`);
            if (log.details) console.log(`    Details: ${JSON.stringify(log.details)}`);
            console.log('---');
        });
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        pool.end();
    }
}

checkLogs();
