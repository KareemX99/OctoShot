require('dotenv').config();
const { pool } = require('./config/database');

(async () => {
    try {
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'campaign_enrollments' 
            ORDER BY ordinal_position
        `);
        console.log('campaign_enrollments table columns:');
        result.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
})();
