const { pool } = require('../config/database');

async function createTable() {
    try {
        // Drop and recreate with correct column name
        await pool.query('DROP TABLE IF EXISTS client_chats_blocked');

        await pool.query(`
            CREATE TABLE client_chats_blocked (
                id SERIAL PRIMARY KEY,
                client_id INTEGER NOT NULL,
                phone_number VARCHAR(50) NOT NULL,
                blocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reason TEXT,
                UNIQUE(client_id, phone_number)
            )
        `);
        console.log('✅ Table client_chats_blocked created with correct column names!');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

createTable();
