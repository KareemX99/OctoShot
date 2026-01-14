const { Pool } = require('pg');
require('dotenv').config();

// Create connection pool
const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Test connection
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ Database connected successfully');
        client.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

// Query helper
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log(`📊 Query executed in ${duration}ms`);
        return result;
    } catch (error) {
        console.error('❌ Query error:', error.message);
        throw error;
    }
}

// Get client from pool
async function getClient() {
    return await pool.connect();
}

module.exports = {
    pool,
    query,
    getClient,
    testConnection
};
