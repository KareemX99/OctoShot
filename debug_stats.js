const { query } = require('./config/database');

async function checkStats() {
    try {
        console.log('Checking Contact Statistics...');

        // 1. Total Count
        const countRes = await query('SELECT COUNT(*) as total FROM contacts');
        console.log('Total Contacts:', countRes.rows[0].total);

        // 2. Count by Client ID
        const byClientRes = await query('SELECT client_id, COUNT(*) as count FROM contacts GROUP BY client_id');
        console.log('Contacts by Client:', byClientRes.rows);

        // 3. Count by Source
        const bySourceRes = await query('SELECT source, COUNT(*) as count FROM contacts GROUP BY source');
        console.log('Contacts by Source:', bySourceRes.rows);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkStats();
