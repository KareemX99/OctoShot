const { pool } = require('../config/database');

async function check() {
    const res = await pool.query(`
        SELECT id, name, state, data, created_on 
        FROM pgboss.job 
        WHERE name = 'whatsapp-send'
        ORDER BY created_on DESC 
        LIMIT 5
    `);
    console.log('WhatsApp Send Jobs:');
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
}

check();
