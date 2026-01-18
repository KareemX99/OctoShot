// Backend Health Check Script
require('dotenv').config();
const { testConnection, pool } = require('./config/database');

async function checkBackendHealth() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           OctoSHOT Backend Health Check                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // 1. Test Database Connection
    console.log('🔄 1. Testing Database Connection...');
    try {
        const dbResult = await testConnection();
        if (dbResult) {
            console.log('   ✅ Database: CONNECTED');

            // List tables
            const tablesResult = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                ORDER BY table_name
            `);
            console.log(`   📊 Tables found: ${tablesResult.rows.length}`);
            tablesResult.rows.forEach(row => console.log(`      - ${row.table_name}`));
        } else {
            console.log('   ❌ Database: FAILED');
        }
    } catch (error) {
        console.log('   ❌ Database Error:', error.message);
    }

    // 2. Check Environment Variables
    console.log('\n🔄 2. Checking Environment Variables...');
    const requiredVars = [
        'DATABASE_HOST',
        'DATABASE_PORT',
        'DATABASE_NAME',
        'DATABASE_USER',
        'DATABASE_PASSWORD',
        'PORT',
        'OPENAI_API_KEY'
    ];

    requiredVars.forEach(varName => {
        const value = process.env[varName];
        if (value) {
            // Mask sensitive values
            if (varName.includes('PASSWORD') || varName.includes('API_KEY')) {
                console.log(`   ✅ ${varName}: ****${value.slice(-4)}`);
            } else {
                console.log(`   ✅ ${varName}: ${value}`);
            }
        } else {
            console.log(`   ❌ ${varName}: NOT SET`);
        }
    });

    // 3. Check Models
    console.log('\n🔄 3. Testing Models...');
    try {
        const Client = require('./models/Client');
        const Campaign = require('./models/Campaign');
        const Contact = require('./models/Contact');
        const AutoReply = require('./models/AutoReply');
        const Message = require('./models/Message');

        // Test Client model
        const profiles = await Client.findAll();
        console.log(`   ✅ Client (Profiles): ${profiles.length} found`);

        // Test Campaign model
        const campaigns = await Campaign.findAll();
        console.log(`   ✅ Campaign: ${campaigns.length} found`);

        // Test Contact model
        const contacts = await Contact.count();
        console.log(`   ✅ Contact: ${contacts} total`);

        // Test AutoReply model
        const autoReplies = await AutoReply.findAll();
        console.log(`   ✅ AutoReply: ${autoReplies.length} rules found`);

    } catch (error) {
        console.log('   ❌ Models Error:', error.message);
    }

    // 4. Check Services
    console.log('\n🔄 4. Testing Services...');
    try {
        const ProfileLogger = require('./services/ProfileLogger');
        console.log('   ✅ ProfileLogger: Loaded');
    } catch (error) {
        console.log('   ❌ ProfileLogger:', error.message);
    }

    try {
        const CampaignQueue = require('./services/campaignQueue');
        console.log('   ✅ CampaignQueue: Loaded');
    } catch (error) {
        console.log('   ❌ CampaignQueue:', error.message);
    }

    try {
        const messageQueueProcessor = require('./services/messageQueueProcessor');
        console.log('   ✅ messageQueueProcessor: Loaded');
    } catch (error) {
        console.log('   ❌ messageQueueProcessor:', error.message);
    }

    try {
        const unreadMessageProcessor = require('./services/unreadMessageProcessor');
        console.log('   ✅ unreadMessageProcessor: Loaded');
    } catch (error) {
        console.log('   ❌ unreadMessageProcessor:', error.message);
    }

    try {
        const readNoReplyProcessor = require('./services/readNoReplyProcessor');
        console.log('   ✅ readNoReplyProcessor: Loaded');
    } catch (error) {
        console.log('   ❌ readNoReplyProcessor:', error.message);
    }

    // 5. Check Routes
    console.log('\n🔄 5. Testing Routes...');
    const routes = [
        { name: 'messages', path: './routes/messages' },
        { name: 'contacts', path: './routes/contacts' },
        { name: 'autoReply', path: './routes/autoReply' },
        { name: 'dashboard', path: './routes/dashboard' },
        { name: 'profiles', path: './routes/profiles' },
        { name: 'spintax', path: './routes/spintax' },
        { name: 'campaigns', path: './routes/campaigns' },
        { name: 'externalApi', path: './routes/externalApi' },
        { name: 'apiLogs', path: './routes/apiLogs' },
        { name: 'admin-logs', path: './routes/admin-logs.routes' }
    ];

    for (const route of routes) {
        try {
            require(route.path);
            console.log(`   ✅ ${route.name}: Loaded`);
        } catch (error) {
            console.log(`   ❌ ${route.name}: ${error.message}`);
        }
    }

    // 6. Check WhatsApp Manager
    console.log('\n🔄 6. Testing WhatsApp Components...');
    try {
        const whatsappManager = require('./whatsapp-manager');
        console.log('   ✅ whatsapp-manager: Loaded');

        const allStatus = whatsappManager.getAllStatus();
        console.log(`   📱 Active sessions: ${Object.keys(allStatus).length}`);
        for (const [id, status] of Object.entries(allStatus)) {
            console.log(`      - Profile ${id}: ${status.connected ? 'CONNECTED' : 'DISCONNECTED'} (${status.status})`);
        }
    } catch (error) {
        console.log('   ❌ whatsapp-manager:', error.message);
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    Health Check Complete                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    await pool.end();
    process.exit(0);
}

checkBackendHealth().catch(err => {
    console.error('Health check error:', err);
    process.exit(1);
});
