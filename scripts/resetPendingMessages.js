/**
 * Reset pending messages to send now
 * Run: node scripts/resetPendingMessages.js
 */

require('dotenv').config();
const { pool, testConnection } = require('../config/database');

async function resetPending() {
    console.log('🚀 Resetting pending messages...\\n');

    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
    }

    try {
        // Check current pending messages
        const pending = await pool.query(`
            SELECT id, recipient, status, retry_count, scheduled_at 
            FROM api_message_queue 
            WHERE status IN ('pending', 'queued')
            ORDER BY id
        `);

        console.log('📋 Current pending/queued messages:');
        pending.rows.forEach(row => {
            console.log(`   #${row.id} -> ${row.recipient} | ${row.status} | retries: ${row.retry_count} | scheduled: ${row.scheduled_at}`);
        });

        // Reset to queued and schedule for NOW
        const result = await pool.query(`
            UPDATE api_message_queue 
            SET status = 'queued', 
                scheduled_at = (NOW() AT TIME ZONE 'Africa/Cairo'),
                retry_count = 0
            WHERE status = 'pending'
            RETURNING id
        `);

        console.log(`\\n✅ Reset ${result.rows.length} messages to queued for immediate sending!`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

resetPending();
