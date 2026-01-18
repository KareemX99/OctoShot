const { query } = require('./config/database');

async function run() {
    try {
        const result = await query(`
            SELECT message_id, from_name, from_number, chat_id, body, is_from_me 
            FROM messages 
            WHERE chat_id LIKE '%@g.us%' 
            ORDER BY timestamp DESC 
            LIMIT 5
        `);
        console.log('Group messages from database:');
        console.log(JSON.stringify(result.rows, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }
    process.exit();
}

run();
