const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const Message = require('./models/Message');
const Contact = require('./models/Contact');
const AutoReply = require('./models/AutoReply');
const ClientModel = require('./models/Client');
const { pool } = require('./config/database');
const ProfileLogger = require('./services/ProfileLogger');

let client = null;
let io = null;
let connectionStatus = 'disconnected';
let qrCode = null;
let currentClientId = 1;

/**
 * Update trust level based on connection duration
 */
async function updateTrustLevel(clientId) {
    try {
        // Set first_connected_at if not set
        await pool.query(`
            UPDATE clients 
            SET first_connected_at = COALESCE(first_connected_at, NOW())
            WHERE id = $1
        `, [clientId]);

        // Calculate trust level based on days connected
        const result = await pool.query(`
            UPDATE clients 
            SET trust_level = CASE
                WHEN first_connected_at IS NULL THEN 1
                WHEN NOW() - first_connected_at < INTERVAL '3 days' THEN 1
                WHEN NOW() - first_connected_at < INTERVAL '7 days' THEN 2
                WHEN NOW() - first_connected_at < INTERVAL '14 days' THEN 3
                ELSE 4
            END
            WHERE id = $1
            RETURNING trust_level
        `, [clientId]);

        if (result.rows[0]) {
            const level = result.rows[0].trust_level;
            const emoji = level === 1 ? '⚠️' : level === 4 ? '🌟' : '🟢';
            console.log(`${emoji} Client ${clientId} trust level: ${level}`);
        }
    } catch (error) {
        console.error('Error updating trust level:', error.message);
    }
}

/**
 * Reset trust level on disconnect
 */
async function resetTrustLevel(clientId) {
    try {
        await pool.query(`
            UPDATE clients 
            SET trust_level = 1,
                first_connected_at = NULL
            WHERE id = $1
        `, [clientId]);
    } catch (error) {
        console.error('Error resetting trust level:', error.message);
    }
}

/**
 * Create auth strategy - uses LocalAuth for file storage
 */
function createAuthStrategy() {
    console.log('📁 Using LocalAuth with file storage');
    return new LocalAuth({
        dataPath: './.wwebjs_auth'
    });
}

/**
 * Initialize WhatsApp Client
 * @param {Object} socketIO - Socket.IO instance
 */
function initializeClient(socketIO) {
    io = socketIO;

    client = new Client({
        authStrategy: createAuthStrategy(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    // Track if we've already logged QR for this session
    let qrLogged = false;

    // QR Code event
    client.on('qr', (qr) => {
        console.log('📱 QR Code received');
        qrCode = qr;
        connectionStatus = 'qr';
        io.emit('qr', qr);
        io.emit('status', { status: 'qr', message: 'Scan QR Code with WhatsApp' });

        // Log QR generation only ONCE per connection attempt (not on every refresh)
        if (!qrLogged) {
            ProfileLogger.connection(currentClientId, 'qr_generated', { timestamp: new Date().toISOString() });
            qrLogged = true;
        }
    });

    // Ready event
    client.on('ready', async () => {
        console.log('✅ WhatsApp Client is ready!');
        connectionStatus = 'connected';
        qrCode = null;

        // Save/update client in database
        try {
            const clientData = await ClientModel.upsert({
                phone_number: client.info?.wid?.user || 'unknown',
                name: client.info?.pushname || 'WhatsApp User',
                push_name: client.info?.pushname,
                platform: client.info?.platform,
                status: 'connected'
            });
            currentClientId = clientData.id;
            console.log(`📱 Client registered with ID: ${currentClientId}`);

            // Track trust level
            await updateTrustLevel(currentClientId);

            // Log successful connection
            await ProfileLogger.connection(currentClientId, 'ready', {
                phoneNumber: client.info?.wid?.user,
                pushName: client.info?.pushname,
                platform: client.info?.platform
            });
        } catch (error) {
            console.error('Error saving client:', error.message);
        }

        io.emit('status', { status: 'connected', message: 'Connected to WhatsApp' });
        io.emit('ready', {
            connected: true,
            info: client.info
        });
    });

    // Authenticated event
    client.on('authenticated', () => {
        console.log('🔐 Authenticated successfully');
        connectionStatus = 'authenticated';
        io.emit('status', { status: 'authenticated', message: 'Authenticated successfully' });

        // Log authentication
        ProfileLogger.connection(currentClientId, 'authenticated');
    });

    // Authentication failure
    client.on('auth_failure', async (msg) => {
        console.error('❌ Authentication failed:', msg);
        connectionStatus = 'auth_failure';
        io.emit('status', { status: 'auth_failure', message: 'Authentication failed' });

        // Log auth failure - potential block indicator
        await ProfileLogger.connection(currentClientId, 'auth_failure', { reason: msg });
        await ProfileLogger.warning(currentClientId, 'Authentication failure may indicate account issues', { reason: msg });
    });

    // Disconnected event
    client.on('disconnected', async (reason) => {
        console.log('🔌 Disconnected:', reason);
        connectionStatus = 'disconnected';

        // Update client status in database and reset trust level
        try {
            await ClientModel.updateStatus(currentClientId, 'disconnected');

            // Reset trust level to 1 on disconnect
            await resetTrustLevel(currentClientId);
            console.log(`⚠️ Trust level reset for client ${currentClientId}`);

            // Log disconnection
            await ProfileLogger.connection(currentClientId, 'disconnected', { reason });

            // Check if this might be a block - ONLY for actual ban indicators
            // LOGOUT is a normal user action, NOT a block
            const blockIndicators = ['banned', 'spam', 'blocked', 'restricted', 'temporarily'];
            const reasonLower = (reason || '').toLowerCase();
            const isActualBlock = blockIndicators.some(indicator => reasonLower.includes(indicator));

            if (isActualBlock) {
                await ProfileLogger.blockDetected(currentClientId, 'Disconnection with ban indicator', {
                    reason,
                    indicator: blockIndicators.find(i => reasonLower.includes(i))
                });
            }
        } catch (error) {
            console.error('Error updating client status:', error.message);
        }

        // Reset QR log flag for next connection attempt
        qrLogged = false;

        io.emit('status', { status: 'disconnected', message: 'Disconnected from WhatsApp' });
    });

    // Loading screen
    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ Loading: ${percent}% - ${message}`);
        io.emit('loading', { percent, message });
    });

    // Message acknowledgment (delivered/read status)
    client.on('message_ack', async (msg, ack) => {
        /*
            ACK VALUES:
            ACK_ERROR: -1
            ACK_PENDING: 0
            ACK_SERVER: 1
            ACK_DEVICE: 2 (Delivered to device)
            ACK_READ: 3 (Read by recipient)
            ACK_PLAYED: 4 (Played - for audio/video)
        */

        try {
            const messageId = msg.id._serialized;
            let newStatus = null;

            // Debug log
            if (ack >= 2 && msg.fromMe) {
                console.log(`🔍 ACK received: ack=${ack}, messageId=${messageId}, fromMe=${msg.fromMe}`);
            }

            if (ack === 2) {
                newStatus = 'delivered';
            } else if (ack === 3) {
                newStatus = 'read';
            } else if (ack === 4) {
                newStatus = 'read'; // Played counts as read
            }

            if (newStatus && msg.fromMe) {
                // Update status in api_message_queue table
                // Allow: sent -> delivered, delivered -> read, sent -> read
                // Also set read_at when status becomes 'read'
                let result;
                if (newStatus === 'read') {
                    result = await pool.query(`
                        UPDATE api_message_queue 
                        SET status = $1, 
                            ack_level = $2,
                            read_at = CURRENT_TIMESTAMP
                        WHERE whatsapp_message_id = $3
                        AND status != 'read'
                        RETURNING id
                    `, [newStatus, ack, messageId]);
                } else {
                    result = await pool.query(`
                        UPDATE api_message_queue 
                        SET status = $1, 
                            ack_level = $2
                        WHERE whatsapp_message_id = $3
                        AND status != 'read'
                        RETURNING id
                    `, [newStatus, ack, messageId]);
                }

                if (result.rows.length > 0) {
                    console.log(`📬 Message ${result.rows[0].id} status updated to: ${newStatus}`);

                    // Emit to UI
                    io.emit('queue_update', {
                        id: result.rows[0].id,
                        status: newStatus,
                        ack_level: ack
                    });
                } else {
                    console.log(`⚠️ No message found with whatsapp_message_id: ${messageId}`);
                }
            }
        } catch (error) {
            console.error('Error updating message ACK:', error.message);
        }
    });

    // Message received
    client.on('message', async (msg) => {
        console.log(`📩 Message received from ${msg.from}: ${msg.body.substring(0, 50)}...`);

        // Get contact info (with fallback)
        let contactName = 'Unknown';
        try {
            const contact = await msg.getContact();
            contactName = contact?.pushname || contact?.name || 'Unknown';
        } catch (e) {
            // Contact lookup failed, use number as name
            contactName = msg.from.replace('@c.us', '').replace('@g.us', '');
        }

        // Save message to database
        try {
            await Message.create({
                client_id: currentClientId,
                message_id: msg.id._serialized,
                chat_id: msg.from,
                from_number: msg.from.replace('@c.us', '').replace('@g.us', ''),
                to_number: msg.to?.replace('@c.us', '').replace('@g.us', ''),
                from_name: contactName,
                body: msg.body,
                type: msg.type,
                is_from_me: msg.fromMe,
                is_forwarded: msg.isForwarded,
                has_media: msg.hasMedia,
                timestamp: new Date(msg.timestamp * 1000)
            });
            console.log(`💾 Message saved to database`);

            // Mark our messages to this chat as replied (for read-no-reply tracking)
            if (!msg.fromMe) {
                const recipientNumber = msg.from.replace('@c.us', '').replace('@g.us', '');
                const updateResult = await pool.query(`
                    UPDATE api_message_queue 
                    SET customer_replied = true
                    WHERE device_id = $1 
                    AND recipient = $2
                    AND customer_replied = false
                `, [currentClientId, recipientNumber]);

                if (updateResult.rowCount > 0) {
                    console.log(`📝 Marked ${updateResult.rowCount} messages as replied by customer`);
                }
            }

            // Emit to frontend
            io.emit('message', {
                id: msg.id._serialized,
                from: msg.from,
                body: msg.body,
                timestamp: msg.timestamp,
                fromName: contactName
            });
        } catch (error) {
            console.error('Error saving message:', error.message);
        }

        // Send to webhook if profile has one configured
        try {
            const profile = await ClientModel.getById(currentClientId);
            if (profile?.webhook_url) {
                // Get chat info for group detection
                let isGroup = msg.from.includes('@g.us');
                let groupName = null;
                let authorName = contactName;
                let authorNumber = msg.from.replace('@c.us', '').replace('@g.us', '');
                let pushName = contactName;

                if (isGroup) {
                    try {
                        const chat = await msg.getChat();
                        groupName = chat.name;
                        // Get actual sender in group
                        if (msg.author) {
                            authorNumber = msg.author.replace('@c.us', '');
                            try {
                                const authorContact = await client.getContactById(msg.author);
                                authorName = authorContact?.pushname || authorContact?.name || authorNumber;
                                pushName = authorContact?.pushname || authorNumber;
                            } catch (e) {
                                authorName = authorNumber;
                                pushName = authorNumber;
                            }
                        }
                    } catch (e) {
                        console.error('Error getting chat info:', e.message);
                    }
                } else {
                    try {
                        const senderContact = await msg.getContact();
                        pushName = senderContact?.pushname || authorNumber;
                    } catch (e) {
                        pushName = authorNumber;
                    }
                }

                // Get sender profile picture
                let profilePicUrl = null;
                try {
                    const contactId = isGroup ? (msg.author || msg.from) : msg.from;
                    profilePicUrl = await client.getProfilePicUrl(contactId);
                } catch (e) {
                    // Profile picture not available
                    console.log('Profile picture not available for:', msg.from);
                }

                // Handle media - download and save if present
                let mediaUrl = null;
                let mediaUrlMp3 = null;
                let mediaUrlOgg = null;
                let detectedType = msg.type;

                if (msg.hasMedia) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            const fs = require('fs');
                            const path = require('path');
                            const baseUrl = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3002);

                            // Generate base filename
                            const baseFilename = `${Date.now()}_${msg.id.id}`;

                            // Detect if audio
                            const isAudio = media.mimetype.includes('audio') ||
                                media.mimetype.includes('ogg') ||
                                msg.type === 'ptt' ||
                                msg.type === 'audio';

                            if (isAudio) {
                                detectedType = 'audio';

                                // Save as OGG
                                const oggFilename = `${baseFilename}.ogg`;
                                const oggFilepath = path.join(__dirname, 'uploads', oggFilename);
                                fs.writeFileSync(oggFilepath, Buffer.from(media.data, 'base64'));
                                mediaUrlOgg = `${baseUrl}/uploads/${oggFilename}`;
                                console.log(`📁 Audio saved (ogg): ${oggFilename}`);

                                // Convert to MP3 using ffmpeg
                                try {
                                    const { execSync } = require('child_process');
                                    const mp3Filename = `${baseFilename}.mp3`;
                                    const mp3Filepath = path.join(__dirname, 'uploads', mp3Filename);

                                    execSync(`ffmpeg -i "${oggFilepath}" -acodec libmp3lame -y "${mp3Filepath}"`, {
                                        stdio: 'pipe'
                                    });

                                    mediaUrlMp3 = `${baseUrl}/uploads/${mp3Filename}`;
                                    console.log(`📁 Audio converted (mp3): ${mp3Filename}`);
                                } catch (ffmpegError) {
                                    console.error('FFmpeg conversion error:', ffmpegError.message);
                                    // Fallback: just copy as mp3 (may not play correctly without ffmpeg)
                                    const mp3Filename = `${baseFilename}.mp3`;
                                    const mp3Filepath = path.join(__dirname, 'uploads', mp3Filename);
                                    fs.copyFileSync(oggFilepath, mp3Filepath);
                                    mediaUrlMp3 = `${baseUrl}/uploads/${mp3Filename}`;
                                }

                                mediaUrl = mediaUrlOgg; // Primary URL is ogg
                            } else {
                                // Non-audio media
                                const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                                const filename = `${baseFilename}.${ext}`;
                                const filepath = path.join(__dirname, 'uploads', filename);

                                fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
                                mediaUrl = `${baseUrl}/uploads/${filename}`;
                                console.log(`📁 Media saved: ${filename}`);
                            }
                        }
                    } catch (mediaError) {
                        console.error('Error downloading media:', mediaError.message);
                    }
                }

                // Get quoted/reply message info
                let replyInfo = null;
                if (msg.hasQuotedMsg) {
                    try {
                        const quotedMsg = await msg.getQuotedMessage();
                        if (quotedMsg) {
                            replyInfo = {
                                type: quotedMsg.type,
                                messageId: quotedMsg.id._serialized,
                                from: quotedMsg.from,
                                content: quotedMsg.body || '[Unsupported reply content]'
                            };
                        }
                    } catch (e) {
                        console.error('Error getting quoted message:', e.message);
                    }
                }

                // Build comprehensive webhook data
                const webhookData = {
                    deviceId: profile.id,
                    userId: profile.id,
                    from: msg.from.replace('@c.us', '@s.whatsapp.net').replace('@g.us', '@g.us'),
                    sender: isGroup ? (msg.author || msg.from) : null,
                    messageId: msg.id.id,
                    type: detectedType === 'chat' ? 'text' : detectedType,
                    content: msg.body,
                    mediaUrl: mediaUrl,
                    mediaUrlOgg: mediaUrlOgg,
                    mediaUrlMp3: mediaUrlMp3,
                    timestamp: String(msg.timestamp),
                    pushName: pushName,
                    profilePicUrl: profilePicUrl,
                    reply: replyInfo,
                    source: 'regular',
                    isFromAdvertisement: false,
                    rawParticipant: isGroup ? (msg.author || '') : '',
                    rawRemoteJid: msg.from.replace('@c.us', '@s.whatsapp.net'),
                    remoteJidAlt: null,
                    advertisementJid: null,
                    // Extended info
                    isGroup: isGroup,
                    groupName: groupName,
                    profile: {
                        id: profile.id,
                        uuid: profile.uuid,
                        device_name: profile.device_name,
                        phone_number: profile.phone_number
                    },
                    msg: {
                        id: msg.id._serialized,
                        body: msg.body,
                        type: msg.type,
                        timestamp: msg.timestamp,
                        fromMe: msg.fromMe,
                        hasMedia: msg.hasMedia,
                        isForwarded: msg.isForwarded || false,
                        hasQuotedMsg: msg.hasQuotedMsg || false,
                        vCards: msg.vCards || [],
                        mentionedIds: msg.mentionedIds || [],
                        links: msg.links || []
                    }
                };

                // Send webhook asynchronously
                sendToWebhook(profile.webhook_url, webhookData);
            }
        } catch (webhookError) {
            console.error('Error sending to webhook:', webhookError.message);
        }

        // Check for auto-reply
        if (!msg.fromMe) {
            try {
                const rule = await AutoReply.findMatch(currentClientId, msg.body);
                if (rule) {
                    console.log(`🤖 Auto-reply triggered: "${rule.trigger_word}"`);
                    await msg.reply(rule.reply_message);
                    await AutoReply.incrementReplyCount(rule.id);

                    // Save auto-reply message
                    await Message.create({
                        client_id: currentClientId,
                        message_id: `auto_${Date.now()}`,
                        chat_id: msg.from,
                        from_number: client.info?.wid?.user,
                        to_number: msg.from.replace('@c.us', ''),
                        body: rule.reply_message,
                        type: 'text',
                        is_from_me: true,
                        timestamp: new Date()
                    });
                }
            } catch (error) {
                console.error('Error processing auto-reply:', error.message);
            }
        }
    });

    // Message sent by me
    client.on('message_create', async (msg) => {
        if (msg.fromMe) {
            try {
                await Message.create({
                    client_id: currentClientId,
                    message_id: msg.id._serialized,
                    chat_id: msg.to,
                    from_number: msg.from?.replace('@c.us', ''),
                    to_number: msg.to?.replace('@c.us', ''),
                    body: msg.body,
                    type: msg.type,
                    is_from_me: true,
                    has_media: msg.hasMedia,
                    timestamp: new Date(msg.timestamp * 1000)
                });
            } catch (error) {
                console.error('Error saving sent message:', error.message);
            }
        }
    });

    // Initialize the client
    console.log('🚀 Initializing WhatsApp Client...');
    client.initialize();
}

/**
 * Send a text message
 */
async function sendMessage(phoneNumber, message) {
    if (!client || connectionStatus !== 'connected') {
        throw new Error('WhatsApp is not connected');
    }

    let chatId;

    // Check if it's already a chat ID (contains @)
    if (phoneNumber.includes('@')) {
        chatId = phoneNumber;
    } else {
        // Format as regular phone number
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        chatId = `${formattedNumber}@c.us`;
    }

    try {
        // For individual chats, check if registered
        if (chatId.includes('@c.us')) {
            const isRegistered = await client.isRegisteredUser(chatId);
            if (!isRegistered) {
                throw new Error('This number is not registered on WhatsApp');
            }
        }

        const result = await client.sendMessage(chatId, message);
        console.log(`📤 Message sent to ${chatId}`);

        return {
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        };
    } catch (error) {
        console.error('❌ Failed to send message:', error.message);
        throw error;
    }
}

/**
 * Send media message
 */
async function sendMedia(phoneNumber, filePath, caption = '') {
    if (!client || connectionStatus !== 'connected') {
        throw new Error('WhatsApp is not connected');
    }

    let chatId;

    // Check if it's already a chat ID (contains @)
    if (phoneNumber.includes('@')) {
        chatId = phoneNumber;
    } else {
        // Format as regular phone number
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        chatId = `${formattedNumber}@c.us`;
    }

    try {
        const media = MessageMedia.fromFilePath(filePath);
        const result = await client.sendMessage(chatId, media, { caption });
        console.log(`📤 Media sent to ${chatId}`);

        return {
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        };
    } catch (error) {
        console.error('❌ Failed to send media:', error.message);
        throw error;
    }
}

/**
 * Get current connection status
 */
function getStatus() {
    return {
        status: connectionStatus,
        connected: connectionStatus === 'connected',
        qrCode: qrCode,
        info: client?.info || null
    };
}

/**
 * Logout and destroy the client
 */
async function logout() {
    if (client) {
        await client.logout();
        await client.destroy();
        connectionStatus = 'disconnected';
        qrCode = null;
        console.log('👋 Logged out successfully');
    }
}

/**
 * Get the WhatsApp client instance
 */
function getClient() {
    return client;
}

/**
 * Get current client ID
 */
function getCurrentClientId() {
    return currentClientId;
}

/**
 * Send data to رابط Webhook
 */
async function sendToWebhook(webhookUrl, data) {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'OctoSHOTWhatsApp/1.0'
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            console.log(`📤 Webhook sent successfully to ${webhookUrl}`);
        } else {
            console.error(`❌ Webhook failed: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ Webhook error:', error.message);
    }
}

module.exports = {
    initializeClient,
    sendMessage,
    sendMedia,
    getStatus,
    logout,
    getClient,
    getCurrentClientId
};
