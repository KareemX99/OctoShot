// Check specific chat messages for Kiko (201070212481)
const { pool } = require('./config/database');

(async () => {
    try {
        const chatId = '201070212481';
        console.log(`=== Messages for chat containing ${chatId} ===\n`);

        const result = await pool.query(`
            SELECT message_id, chat_id, body, timestamp, is_from_me 
            FROM messages 
            WHERE chat_id LIKE $1 
            ORDER BY timestamp DESC
            LIMIT 20
        `, [`%${chatId}%`]);

        if (result.rows.length === 0) {
            console.log('❌ No messages found for this chat!');
        } else {
            console.log(`Found ${result.rows.length} messages:\n`);
            result.rows.forEach((r, i) => {
                const direction = r.is_from_me ? '➡️ SENT' : '⬅️ RECV';
                console.log(`${i + 1}. ${direction} | ${r.body?.substring(0, 50)}`);
                console.log(`   Time: ${r.timestamp}`);
                console.log(`   Chat ID: ${r.chat_id}\n`);
            });
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();
