// Quick diagnostic script to check database messages
const { pool } = require('./config/database');

(async () => {
    try {
        console.log('=== Recent Messages in Database ===\n');

        const result = await pool.query(`
            SELECT chat_id, body, timestamp, is_from_me 
            FROM messages 
            ORDER BY timestamp DESC 
            LIMIT 15
        `);

        if (result.rows.length === 0) {
            console.log('❌ No messages found in database!');
        } else {
            result.rows.forEach((r, i) => {
                const direction = r.is_from_me ? '➡️ SENT' : '⬅️ RECV';
                const body = (r.body || '').substring(0, 40);
                console.log(`${i + 1}. ${direction} | ${r.chat_id}`);
                console.log(`   Body: ${body}`);
                console.log(`   Time: ${r.timestamp}\n`);
            });
        }

        // Check count per chat
        const countResult = await pool.query(`
            SELECT chat_id, COUNT(*) as cnt 
            FROM messages 
            GROUP BY chat_id 
            ORDER BY cnt DESC 
            LIMIT 10
        `);

        console.log('\n=== Message Count per Chat ===');
        countResult.rows.forEach(r => {
            console.log(`  ${r.chat_id}: ${r.cnt} messages`);
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();
