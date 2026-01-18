// Check database schema for media fields
const { pool } = require('./config/database');

(async () => {
    try {
        // Check schema
        console.log('=== Messages Table Schema ===\n');
        const schema = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'messages' 
            ORDER BY ordinal_position
        `);
        schema.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

        // Check sample messages with media
        console.log('\n=== Sample Messages with Media ===\n');
        const media = await pool.query(`
            SELECT message_id, chat_id, body, type, has_media, media_url, media_type, timestamp
            FROM messages 
            WHERE has_media = true 
            ORDER BY timestamp DESC 
            LIMIT 5
        `);

        if (media.rows.length === 0) {
            console.log('No messages with media found');
        } else {
            media.rows.forEach((r, i) => {
                console.log(`${i + 1}. Type: ${r.type}`);
                console.log(`   Body: ${r.body?.substring(0, 50) || ''}`);
                console.log(`   Media URL: ${r.media_url}`);
                console.log(`   Media Type: ${r.media_type}`);
                console.log(`   Time: ${r.timestamp}\n`);
            });
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();
