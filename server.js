require('dotenv').config();

// Global error handlers to prevent server crash from unhandled errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason?.message || reason);
    // Don't exit - log and continue
});

process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error?.message || error);
    // Only exit for truly fatal errors, not Puppeteer context errors
    if (error?.message?.includes('Execution context was destroyed')) {
        console.log('↪️ Puppeteer navigation error - continuing...');
        return; // Don't crash
    }
    // For other critical errors, still crash to prevent zombie state
    // process.exit(1);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');

// Database
const { testConnection } = require('./config/database');

// WhatsApp Client
const whatsappClient = require('./whatsapp-client');
const whatsappManager = require('./whatsapp-manager');

// Routes
const messagesRoutes = require('./routes/messages');
const contactsRoutes = require('./routes/contacts');
const autoReplyRoutes = require('./routes/autoReply');
const dashboardRoutes = require('./routes/dashboard');
const profilesRoutes = require('./routes/profiles');
const spintaxRoutes = require('./routes/spintax');
const adminLogsRoutes = require('./routes/admin-logs.routes');
const campaignsRoutes = require('./routes/campaigns');

// Services
const ProfileLogger = require('./services/ProfileLogger');
const CampaignQueue = require('./services/campaignQueue');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB limit
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/messages', messagesRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/auto-replies', autoReplyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/profiles', profilesRoutes);

// External API (v1) - Authenticated with UUID/Token
const externalApiRoutes = require('./routes/externalApi');
app.use('/api/v1', externalApiRoutes);

// API Logs Routes
const apiLogsRoutes = require('./routes/apiLogs');
app.use('/api/logs', apiLogsRoutes);

// Spintax Routes
app.use('/api/spintax', spintaxRoutes);

// Spintax Page
app.get('/spintax', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'spintax.html'));
});

// Admin Logs Routes
app.use('/api/admin', adminLogsRoutes);

// Campaigns Routes
app.use('/api/campaigns', campaignsRoutes);

// Initialize WhatsApp Manager with Socket.IO (already imported at top)
whatsappManager.setSocketIO(io);

// Initialize Message Queue Processor
const messageQueueProcessor = require('./services/messageQueueProcessor');
messageQueueProcessor.setSocketIO(io);
messageQueueProcessor.start(5000); // Check queue every 5 seconds

// Initialize Unread Message Processor (for webhook notifications)
const unreadMessageProcessor = require('./services/unreadMessageProcessor');
unreadMessageProcessor.start();

// Initialize Read No-Reply Processor (for webhook notifications when customer reads but doesn't reply)
const readNoReplyProcessor = require('./services/readNoReplyProcessor');
readNoReplyProcessor.start();

// NOTE: Legacy WhatsApp Client auto-initialization REMOVED
// WhatsApp clients now only start when user explicitly clicks "Connect" on profiles page
// This prevents background QR code generation and saves resources
// Old code was: whatsappClient.initializeClient(io);

// Initialize ProfileLogger with Socket.IO
ProfileLogger.setSocketIO(io);

// NOTE: CampaignQueue is initialized AFTER database connection in startServer()

// Initialize WhatsApp Manager with Socket.IO
whatsappManager.setSocketIO(io);

// Auto-restore previously connected sessions after a short delay
// (allows server to fully initialize first)
setTimeout(() => {
    whatsappManager.autoRestoreSessions().catch(err => {
        console.error('Auto-restore error:', err.message);
    });
}, 3000);

// Setup admin logs Socket.IO authentication
adminLogsRoutes.setupSocketAuth(io);

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    // Get status of first active profile (if any)
    const allStatus = whatsappManager.getAllStatus();
    const activeProfileId = Object.keys(allStatus).find(id => allStatus[id].connected);
    const status = activeProfileId ? whatsappManager.getStatus(activeProfileId) : { status: 'disconnected', qrCode: null, connected: false };

    socket.emit('status', {
        status: status.status,
        message: getStatusMessage(status.status)
    });

    // If QR code is available, send it
    if (status.qrCode) {
        socket.emit('qr', status.qrCode);
    }

    // If connected, send ready event
    if (status.connected) {
        socket.emit('ready', { connected: true, info: status.info });
    }

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// Helper function to get status message
function getStatusMessage(status) {
    const messages = {
        'disconnected': 'Disconnected from WhatsApp',
        'qr': 'Scan QR Code with WhatsApp',
        'authenticated': 'Authenticated successfully',
        'connected': 'Connected to WhatsApp',
        'auth_failure': 'Authentication failed'
    };
    return messages[status] || 'Unknown status';
}

// ============================================
// API Endpoints
// ============================================

// Get status (legacy - uses first active profile)
app.get('/api/status', (req, res) => {
    const allStatus = whatsappManager.getAllStatus();
    const activeProfileId = Object.keys(allStatus).find(id => allStatus[id].connected);
    const status = activeProfileId ? whatsappManager.getStatus(activeProfileId) : { status: 'disconnected', connected: false };
    res.json(status);
});

// Send text message
app.post('/api/send-message', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and message are required'
            });
        }

        // Get first active profile for legacy endpoint
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(id => allStatus[id].connected);

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'No active WhatsApp profile' });
        }

        const result = await whatsappManager.sendMessage(parseInt(activeProfileId), phoneNumber, message);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Send media message
app.post('/api/send-media', upload.single('media'), async (req, res) => {
    try {
        const { phoneNumber, caption } = req.body;
        const file = req.file;

        if (!phoneNumber || !file) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and media file are required'
            });
        }

        // Get first active profile for legacy endpoint
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(id => allStatus[id].connected);

        if (!activeProfileId) {
            return res.status(400).json({ success: false, error: 'No active WhatsApp profile' });
        }

        // Get client and send media
        const client = whatsappManager.getClient(parseInt(activeProfileId));
        const { MessageMedia } = require('whatsapp-web.js');
        const media = MessageMedia.fromFilePath(file.path);
        const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
        const result = await client.sendMessage(chatId, media, { caption });

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Logout (legacy - logs out all active profiles)
app.post('/api/logout', async (req, res) => {
    try {
        const allStatus = whatsappManager.getAllStatus();
        for (const profileId of Object.keys(allStatus)) {
            if (allStatus[profileId].connected) {
                await whatsappManager.destroyClient(parseInt(profileId));
            }
        }
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get WhatsApp chats directly from client with profile pictures (legacy)
app.get('/api/whatsapp/chats', async (req, res) => {
    try {
        const allStatus = whatsappManager.getAllStatus();
        const activeProfileId = Object.keys(allStatus).find(id => allStatus[id].connected);

        if (!activeProfileId) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp is not connected'
            });
        }

        const client = whatsappManager.getClient(parseInt(activeProfileId));
        if (!client) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp client not available'
            });
        }

        const limit = parseInt(req.query.limit) || 100;

        // Get chats from WhatsApp
        const chats = await client.getChats();

        // Format and limit chats with profile pictures
        const formattedChats = await Promise.all(
            chats.slice(0, limit).map(async (chat) => {
                let profilePicUrl = null;
                try {
                    profilePicUrl = await chat.getProfilePicUrl();
                } catch (e) {
                    // Profile picture not available
                }

                return {
                    id: chat.id._serialized,
                    name: chat.name || chat.id.user,
                    isGroup: chat.isGroup,
                    unreadCount: chat.unreadCount || 0,
                    timestamp: chat.timestamp,
                    profilePicUrl: profilePicUrl,
                    lastMessage: chat.lastMessage ? {
                        body: chat.lastMessage.body?.substring(0, 100),
                        timestamp: chat.lastMessage.timestamp,
                        fromMe: chat.lastMessage.fromMe
                    } : null
                };
            })
        );

        res.json({ success: true, data: formattedChats, count: formattedChats.length });
    } catch (error) {
        console.error('Error fetching WhatsApp chats:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get messages from a specific chat (legacy)
app.get('/api/whatsapp/chat/:chatId/messages', async (req, res) => {
    try {
        const { chatId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const deviceId = req.query.deviceId ? parseInt(req.query.deviceId) : null;

        let client;

        // If deviceId is provided, use that specific device
        if (deviceId) {
            const deviceStatus = whatsappManager.getStatus(deviceId);
            if (!deviceStatus || !deviceStatus.connected) {
                return res.status(400).json({
                    success: false,
                    error: `Device ${deviceId} is not connected`
                });
            }
            client = whatsappManager.getClient(deviceId);
        } else {
            // Legacy: use first connected profile
            const allStatus = whatsappManager.getAllStatus();
            const activeProfileId = Object.keys(allStatus).find(id => allStatus[id].connected);

            if (!activeProfileId) {
                return res.status(400).json({
                    success: false,
                    error: 'WhatsApp is not connected'
                });
            }
            client = whatsappManager.getClient(parseInt(activeProfileId));
        }

        if (!client) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp client not available'
            });
        }

        // Get the chat
        const chat = await client.getChatById(chatId);
        if (!chat) {
            return res.status(404).json({
                success: false,
                error: 'Chat not found'
            });
        }

        // Fetch messages
        const messages = await chat.fetchMessages({ limit });

        // Format messages
        const formattedMessages = messages.map(msg => ({
            id: msg.id._serialized,
            body: msg.body,
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            type: msg.type,
            hasMedia: msg.hasMedia,
            from: msg.from,
            to: msg.to,
            author: msg.author || msg.from // Add author for group messages
        }));

        res.json({
            success: true,
            data: formattedMessages,
            chatName: chat.name || chat.id.user,
            isGroup: chat.isGroup,
            count: formattedMessages.length
        });
    } catch (error) {
        console.error('Error fetching chat messages:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/chats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chats.html'));
});

app.get('/contacts', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contacts.html'));
});

app.get('/auto-reply', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'auto-reply.html'));
});

app.get('/profiles', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profiles.html'));
});

app.get('/api-docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'api-docs.html'));
});

app.get('/api-logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'api-logs.html'));
});

app.get('/admin-logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-logs.html'));
});

app.get('/campaigns', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'campaigns.html'));
});

app.get('/campaign-create', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'campaign-create.html'));
});

app.get('/campaign-detail', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'campaign-detail.html'));
});

// Start server
async function startServer() {
    // Test database connection
    console.log('🔄 Testing database connection...');
    const dbConnected = await testConnection();

    if (!dbConnected) {
        console.warn('⚠️ Database connection failed, continuing without database...');
    }

    server.listen(PORT, async () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🐙 OctoSHOT WhatsApp Platform                           ║
║                                                           ║
║   Server running on: http://localhost:${PORT}              ║
║   Database: ${dbConnected ? '✅ Connected' : '❌ Not connected'}                           ║
║                                                           ║
║   Pages:                                                  ║
║   • Home:       http://localhost:${PORT}                   ║
║   • Dashboard:  http://localhost:${PORT}/dashboard         ║
║   • Chats:      http://localhost:${PORT}/chats             ║
║   • Contacts:   http://localhost:${PORT}/contacts          ║
║   • Auto-Reply: http://localhost:${PORT}/auto-reply        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
        `);

        // Start Campaign Queue (pg-boss) - Only initialize once here
        if (dbConnected) {
            try {
                // Use the same pattern as routes - wait for full initialization
                console.log('🔄 Initializing Campaign Queue (pg-boss)...');
                await CampaignQueue.start(io);
                console.log('📬 Campaign Queue started successfully');

                // Auto-fix any stuck campaigns from previous runs
                await CampaignQueue.fixStuckCampaigns();
            } catch (error) {
                console.error('⚠️ Failed to start Campaign Queue:', error.message);
            }
        } else {
            console.log('⚠️ Skipping Campaign Queue initialization - no database connection');
        }
    });
}

// Create uploads directory if it doesn't exist
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

startServer();
