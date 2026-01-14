const { pool } = require('../config/database');

async function check() {
    const res = await pool.query('SELECT id, name, status, phone_number FROM clients');
    console.table(res.rows);
    process.exit(0);
}

check();
