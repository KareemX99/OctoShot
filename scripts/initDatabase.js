/**
 * Database Initialization Script
 * Run: npm run db:init
 */

require('dotenv').config();
const { pool, testConnection } = require('../config/database');

const createTablesSQL = `
-- Clients table (WhatsApp accounts)
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) UNIQUE,
    name VARCHAR(255),
    push_name VARCHAR(255),
    platform VARCHAR(50),
    status VARCHAR(20) DEFAULT 'disconnected',
    session_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    message_id VARCHAR(255) UNIQUE,
    chat_id VARCHAR(100) NOT NULL,
    from_number VARCHAR(50),
    to_number VARCHAR(50),
    from_name VARCHAR(255),
    body TEXT,
    type VARCHAR(30) DEFAULT 'text',
    is_from_me BOOLEAN DEFAULT false,
    is_forwarded BOOLEAN DEFAULT false,
    has_media BOOLEAN DEFAULT false,
    media_url TEXT,
    media_type VARCHAR(50),
    timestamp TIMESTAMP,
    ack INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    contact_id VARCHAR(100) UNIQUE,
    phone_number VARCHAR(50),
    name VARCHAR(255),
    push_name VARCHAR(255),
    short_name VARCHAR(100),
    is_business BOOLEAN DEFAULT false,
    is_blocked BOOLEAN DEFAULT false,
    is_my_contact BOOLEAN DEFAULT false,
    profile_pic_url TEXT,
    about TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chats table
CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    chat_id VARCHAR(100) UNIQUE,
    name VARCHAR(255),
    is_group BOOLEAN DEFAULT false,
    is_muted BOOLEAN DEFAULT false,
    is_archived BOOLEAN DEFAULT false,
    is_pinned BOOLEAN DEFAULT false,
    unread_count INTEGER DEFAULT 0,
    last_message_id VARCHAR(255),
    last_message_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auto-replies table
CREATE TABLE IF NOT EXISTS auto_replies (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    trigger_word VARCHAR(255) NOT NULL,
    reply_message TEXT NOT NULL,
    match_type VARCHAR(20) DEFAULT 'contains',
    is_active BOOLEAN DEFAULT true,
    reply_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Groups table
CREATE TABLE IF NOT EXISTS groups_info (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    group_id VARCHAR(100) UNIQUE,
    name VARCHAR(255),
    description TEXT,
    owner_id VARCHAR(100),
    participant_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_client_id ON contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_chats_client_id ON chats(client_id);
CREATE INDEX IF NOT EXISTS idx_auto_replies_client_id ON auto_replies(client_id);
`;

async function initDatabase() {
    console.log('🚀 Initializing database...\n');

    // Test connection first
    const connected = await testConnection();
    if (!connected) {
        console.error('❌ Cannot proceed without database connection');
        process.exit(1);
    }

    try {
        // Create tables
        console.log('📦 Creating tables...');
        await pool.query(createTablesSQL);
        console.log('✅ All tables created successfully!\n');

        // Show created tables
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);

        console.log('📋 Tables in database:');
        result.rows.forEach((row, i) => {
            console.log(`   ${i + 1}. ${row.table_name}`);
        });

        console.log('\n✅ Database initialization complete!');

    } catch (error) {
        console.error('❌ Error initializing database:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run initialization
initDatabase();
