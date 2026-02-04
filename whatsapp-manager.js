/**
 * WhatsApp Manager - Multi-Client Support
 * Manages multiple WhatsApp client instances with separate sessions
 */

const { Client: WhatsAppClient, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { pool } = require('./config/database');
const ClientModel = require('./models/Client');
const AutoReply = require('./models/AutoReply');
const Message = require('./models/Message');
const ProfileLogger = require('./services/ProfileLogger');
const WebhookLog = require('./models/WebhookLog');
// LocalAuth is now imported from whatsapp-web.js directly

class WhatsAppManager {
    constructor() {
        this.clients = new Map();
        this.io = null;
    }

    setSocketIO(io) {
        this.io = io;
    }

    async autoRestoreSessions() {
        console.log('≡ƒöä Checking for sessions to auto-restore from database...');
        await ProfileLogger.autoRestore(null, 'scan_start');

        try {
            // Query sessions based on strategy
            let savedSessions = [];

            // Check LocalAuth session folders (.wwebjs_auth/session-profile_XX)
            const authFolder = './.wwebjs_auth';
            if (fs.existsSync(authFolder)) {
                const folders = fs.readdirSync(authFolder).filter(f => {
                    const fullPath = path.join(authFolder, f);
                    return fs.statSync(fullPath).isDirectory() && f.startsWith('session-');
                });
                savedSessions = folders.map(f => ({
                    session_id: f.replace('session-', ''),
                    folder: path.join(authFolder, f)
                }));
            }
            console.log(`≡ƒùä∩╕Å [LocalAuth] Found ${savedSessions.length} session(s)`);

            if (savedSessions.length === 0) {
                console.log('≡ƒô¡ No saved sessions in database');
                await ProfileLogger.autoRestore(null, 'no_sessions');
                return;
            }

            console.log(`≡ƒùä∩╕Å Found ${savedSessions.length} session(s) in database`);
            await ProfileLogger.autoRestore(null, 'found_sessions', { count: savedSessions.length });

            // Extract profile IDs from session names (pattern: profile_ID)
            const profilesToRestore = [];
            for (const session of savedSessions) {
                const match = session.session_id.match(/profile_(\d+)/);
                if (match) {
                    const profileId = parseInt(match[1]);
                    const profile = await ClientModel.getById(profileId);
                    if (profile) {
                        profilesToRestore.push(profile);
                    } else {
                        console.log(`ΓÜá∩╕Å Session exists for profile ${profileId} but profile not in database, skipping...`);
                        await ProfileLogger.autoRestore(profileId, 'skipped', { reason: 'profile_not_in_database' });
                    }
                }
            }

            if (profilesToRestore.length === 0) {
                console.log('≡ƒô¡ No valid profiles to restore');
                await ProfileLogger.autoRestore(null, 'no_sessions', { reason: 'no_valid_profiles' });
                return;
            }

            console.log(`≡ƒô▒ Restoring ${profilesToRestore.length} profile(s): ${profilesToRestore.map(p => p.device_name || p.id).join(', ')}`);

            for (const profile of profilesToRestore) {
                // Skip if already connected in this session
                if (this.clients.has(profile.id)) {
                    console.log(`ΓÅ¡∩╕Å Profile ${profile.id} (${profile.device_name}) already has active client, skipping...`);
                    await ProfileLogger.autoRestore(profile.id, 'skipped', { reason: 'already_connected' });
                    continue;
                }

                console.log(`≡ƒöî Auto-restoring profile ${profile.id} (${profile.device_name})...`);
                await ProfileLogger.autoRestore(profile.id, 'restoring', { deviceName: profile.device_name });

                try {
                    // Update status to 'loading' before attempting restore
                    await ClientModel.updateStatus(profile.id, 'loading');

                    await this.createClient(profile.id);
                    await ProfileLogger.autoRestore(profile.id, 'restored', { deviceName: profile.device_name });
                } catch (error) {
                    console.error(`Γ¥î Failed to auto-restore profile ${profile.id}:`, error.message);
                    await ProfileLogger.autoRestore(profile.id, 'failed', { error: error.message, stack: error.stack });
                    await ClientModel.updateStatus(profile.id, 'error');
                }

                // Wait between restores to avoid overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            console.log('Γ£à Auto-restore complete');
            await ProfileLogger.autoRestore(null, 'complete', { restored: profilesToRestore.length });
        } catch (error) {
            console.error('Γ¥î Error during auto-restore:', error.message);
            await ProfileLogger.autoRestore(null, 'failed', { error: error.message, stack: error.stack });
        }
    }

    async createClient(profileId, retryCount = 0) {
        const MAX_RETRIES = 2;

        if (this.clients.has(profileId)) {
            const existing = this.clients.get(profileId);
            if (existing.status === 'error') {
                console.log(`ΓÜá∩╕Å Cleaning up failed client for profile ${profileId}...`);
                await ProfileLogger.clientInit(profileId, 'cleanup_failed', { reason: 'previous_error' });
                try {
                    if (existing.client) {
                        await existing.client.destroy();
                    }
                } catch (e) { /* ignore */ }
                this.clients.delete(profileId);
            } else {
                console.log(`ΓÜá∩╕Å Client already exists for profile ${profileId}`);
                return existing;
            }
        }

        console.log(`≡ƒÜÇ Creating WhatsApp client for profile ${profileId}...${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
        await ProfileLogger.clientInit(profileId, retryCount > 0 ? 'retry' : 'start', { retryCount });

        const clientData = {
            client: null,
            status: 'initializing',
            qrCode: null,
            info: null,
            connected: false
        };

        // Use built-in LocalAuth for session persistence
        const authStrategy = new LocalAuth({
            clientId: `profile_${profileId}`,
            dataPath: './.wwebjs_auth'
        });
        console.log(`≡ƒùä∩╕Å Using LocalAuth for profile ${profileId}`);
        await ProfileLogger.clientInit(profileId, 'creating_store', { storeType: 'LocalAuth' });

        const client = new WhatsAppClient({
            authStrategy: authStrategy,
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-networking'
                ]
            }
        });

        clientData.client = client;
        clientData.authStrategy = authStrategy; // Store for backup triggers
        this.clients.set(profileId, clientData);

        this._setupEventHandlers(profileId, client);

        console.log(`≡ƒÜÇ Launching Puppeteer browser for profile ${profileId}...`);
        await ProfileLogger.clientInit(profileId, 'puppeteer_launch');

        try {
            await client.initialize();
            await ProfileLogger.clientInit(profileId, 'initialized');
        } catch (error) {
            console.error(`Γ¥î Failed to initialize client for profile ${profileId}:`, error.message);
            await ProfileLogger.clientInit(profileId, 'failed', { error: error.message, stack: error.stack, retryCount });

            try {
                await client.destroy();
            } catch (e) { /* ignore */ }

            this.clients.delete(profileId);

            if (retryCount < MAX_RETRIES) {
                console.log(`≡ƒöä Retrying initialization for profile ${profileId}...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.createClient(profileId, retryCount + 1);
            }

            this._updateStatus(profileId, 'error');
            await ClientModel.updateStatus(profileId, 'error');

            throw new Error(`Failed to initialize client after ${MAX_RETRIES + 1} attempts: ${error.message}`);
        }

        return clientData;
    }

    _setupEventHandlers(profileId, client) {
        let qrLogged = false;

        client.on('qr', async (qr) => {
            console.log(`≡ƒô▒ QR Code generated for profile ${profileId}`);

            try {
                const qrDataUrl = await qrcode.toDataURL(qr);
                const clientData = this.clients.get(profileId);
                if (clientData) {
                    clientData.qrCode = qrDataUrl;
                    clientData.status = 'qr';
                }

                if (!qrLogged) {
                    await ProfileLogger.connection(profileId, 'qr_generated', { timestamp: new Date().toISOString() });
                    qrLogged = true;
                }

                this._emitToProfile(profileId, 'qr', { profileId, qrCode: qrDataUrl });
                this._emitToProfile(profileId, 'status', { profileId, status: 'qr' });
            } catch (error) {
                console.error('Error generating QR:', error);
                ProfileLogger.error(profileId, 'Error generating QR code', { error: error.message }, 'qr_generation');
            }
        });

        client.on('authenticated', async () => {
            console.log(`≡ƒöÉ Profile ${profileId} authenticated`);

            // Treat authenticated as connected for UI purposes
            const clientData = this.clients.get(profileId);
            if (clientData) {
                clientData.connected = true;
            }
            this._updateStatus(profileId, 'connected');

            // Update database immediately - don't wait for ready event
            try {
                await ClientModel.updateConnection(profileId, {
                    status: 'connected'
                });
                console.log(`≡ƒôè Database updated: Profile ${profileId} ΓåÆ connected`);
            } catch (dbError) {
                console.error(`Γ¥î DB update error for profile ${profileId}:`, dbError.message);
            }

            // Emit to frontend immediately - close modal without waiting for backup
            this._emitToProfile(profileId, 'authenticated', {
                profileId,
                info: { phoneNumber: '╪¼╪º╪▒┘è ╪º┘ä╪¬╪¡┘à┘è┘ä...' }
            });

            // Also emit status connected explicitly
            this._emitToProfile(profileId, 'status', { profileId, status: 'connected' });

            await ProfileLogger.connection(profileId, 'authenticated');

            // Fallback: Poll for client.info if ready doesn't fire within 10 seconds
            const pollForInfo = async () => {
                for (let i = 0; i < 20; i++) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (client.info?.wid?.user) {
                        console.log(`📱 Phone number fetched via polling for profile ${profileId}: ${client.info.wid.user}`);

                        // IMPORTANT: Set connectedAt here since ready event may not fire
                        const clientData = this.clients.get(profileId);
                        if (clientData && !clientData.connectedAt) {
                            clientData.connectedAt = Date.now();
                            console.log(`⏰ [DEBUG] Set connectedAt for profile ${profileId}: ${clientData.connectedAt}`);
                        }

                        try {
                            await ClientModel.updateConnection(profileId, {
                                phone_number: client.info.wid.user,
                                name: client.info.pushname,
                                push_name: client.info.pushname,
                                platform: client.info.platform,
                                status: 'connected'
                            });
                            // Emit updated info to frontend
                            this._emitToProfile(profileId, 'ready', {
                                profileId,
                                connected: true,
                                info: client.info,
                                phone_number: client.info.wid.user
                            });
                        } catch (err) {
                            console.error(`❌ Error saving polled phone for ${profileId}:`, err.message);
                        }
                        return;
                    }
                }
                console.log(`ΓÅ│ Timeout waiting for client.info for profile ${profileId}`);
            };
            pollForInfo().catch(console.error);
        });

        client.on('ready', async () => {
            console.log(`Γ£à Profile ${profileId} is ready!`);

            const clientData = this.clients.get(profileId);
            if (clientData) {
                clientData.status = 'connected';
                clientData.connected = true;
                clientData.qrCode = null;
                clientData.info = client.info;
                clientData.connectedAt = Date.now(); // Track connection time for message filtering
            }

            try {
                await ClientModel.updateConnection(profileId, {
                    phone_number: client.info?.wid?.user,
                    name: client.info?.pushname,
                    push_name: client.info?.pushname,
                    platform: client.info?.platform,
                    status: 'connected'
                });
            } catch (error) {
                console.error('Error updating client info:', error);
                ProfileLogger.error(profileId, 'Error updating client info', { error: error.message }, 'client_update');
            }

            // LocalAuth handles session persistence automatically

            await ProfileLogger.connection(profileId, 'ready', {
                phoneNumber: client.info?.wid?.user,
                pushName: client.info?.pushname,
                platform: client.info?.platform
            });

            this._emitToProfile(profileId, 'ready', {
                profileId,
                connected: true,
                info: client.info,
                phone_number: client.info?.wid?.user // Include phone for immediate UI update
            });
            this._emitToProfile(profileId, 'status', { profileId, status: 'connected' });
        });

        client.on('disconnected', async (reason) => {
            console.log(`Γ¥î Profile ${profileId} disconnected:`, reason);

            const clientData = this.clients.get(profileId);
            if (clientData) {
                clientData.status = 'disconnected';
                clientData.connected = false;
                clientData.info = null;
            }

            qrLogged = false;

            await ClientModel.updateStatus(profileId, 'disconnected');
            await ProfileLogger.connection(profileId, 'disconnected', { reason });

            const blockIndicators = ['banned', 'spam', 'blocked', 'restricted', 'temporarily'];
            const reasonLower = (reason || '').toLowerCase();
            const isActualBlock = blockIndicators.some(i => reasonLower.includes(i));
            if (isActualBlock) {
                await ProfileLogger.blockDetected(profileId, 'Disconnection with ban indicator', {
                    reason,
                    indicator: blockIndicators.find(i => reasonLower.includes(i))
                });
            }

            this._emitToProfile(profileId, 'disconnected', { profileId, reason });
            this._emitToProfile(profileId, 'status', { profileId, status: 'disconnected' });
        });

        client.on('auth_failure', async (message) => {
            console.error(`Γ¥î Profile ${profileId} auth failure:`, message);
            ProfileLogger.error(profileId, `Auth failure: ${message}`, null, 'auth_failure');
            this._updateStatus(profileId, 'auth_failure');
            await ClientModel.updateStatus(profileId, 'auth_failure');
            await ProfileLogger.connection(profileId, 'auth_failure', { reason: message });
            await ProfileLogger.warning(profileId, 'Authentication failure may indicate account issues', { reason: message });
        });

        // Loading screen event
        client.on('loading_screen', (percent, message) => {
            console.log(`ΓÅ│ Profile ${profileId} loading: ${percent}% - ${message}`);
            this._emitToProfile(profileId, 'loading', { profileId, percent, message });
        });

        // Message acknowledgment (delivered/read status) - CRITICAL for API message tracking
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

                // Debug log for important acks
                if (ack >= 2 && msg.fromMe) {
                    console.log(`≡ƒöì ACK received: ack=${ack}, messageId=${messageId}, profileId=${profileId}`);
                }

                if (ack === 2) {
                    newStatus = 'delivered';
                } else if (ack === 3) {
                    newStatus = 'read';
                } else if (ack === 4) {
                    newStatus = 'read'; // Played counts as read
                }

                if (newStatus && msg.fromMe) {
                    // 1. Update status in api_message_queue table
                    let result;
                    if (newStatus === 'read') {
                        result = await pool.query(`
                            UPDATE api_message_queue 
                            SET status = $1, ack_level = $2, read_at = CURRENT_TIMESTAMP
                            WHERE whatsapp_message_id = $3 AND status != 'read'
                            RETURNING id
                        `, [newStatus, ack, messageId]);
                    } else {
                        result = await pool.query(`
                            UPDATE api_message_queue 
                            SET status = $1, ack_level = $2
                            WHERE whatsapp_message_id = $3 AND status != 'read'
                            RETURNING id
                        `, [newStatus, ack, messageId]);
                    }

                    if (result.rows.length > 0) {
                        console.log(`≡ƒô¼ Message ${result.rows[0].id} status updated to: ${newStatus}`);

                        // Log message status to ProfileLogger
                        if (newStatus === 'delivered') {
                            ProfileLogger.messageDelivered(profileId, 'queue_message', messageId);
                        } else if (newStatus === 'read') {
                            ProfileLogger.messageRead(profileId, 'queue_message', messageId);
                        }

                        // Emit to UI for real-time updates
                        this._emitToProfile(profileId, 'queue_update', {
                            id: result.rows[0].id,
                            status: newStatus,
                            ack_level: ack
                        });

                        // Also emit globally for API logs page
                        if (this.io) {
                            this.io.emit('queue_update', {
                                id: result.rows[0].id,
                                status: newStatus,
                                ack_level: ack
                            });
                        }
                    }

                    // 2. Update messages table (for dashboard)
                    await pool.query(`
                        UPDATE messages 
                        SET ack = $1
                        WHERE message_id = $2 AND ack < $1
                    `, [ack, messageId]);

                    // 2. Update campaign messages too
                    try {
                        const Campaign = require('./models/Campaign');
                        const campaignId = await Campaign.updateMessageAck(messageId, newStatus, ack);

                        if (campaignId) {
                            console.log(`≡ƒôè Campaign message ${messageId} status updated to: ${newStatus}`);

                            // Increment campaign delivered/read count
                            if (newStatus === 'delivered') {
                                await Campaign.incrementDeliveredCount(campaignId);
                            } else if (newStatus === 'read') {
                                await Campaign.incrementReadCount(campaignId);
                            }

                            // Emit campaign update for real-time UI
                            if (this.io) {
                                this.io.emit('campaign:message_ack', {
                                    campaignId,
                                    messageId,
                                    status: newStatus,
                                    ack_level: ack
                                });
                            }
                        }
                    } catch (campaignError) {
                        // Campaign table might not have the message, that's OK
                        console.log(`ΓÜá∩╕Å Campaign ACK check: ${campaignError.message}`);
                    }
                }
            } catch (error) {
                console.error('Error updating message ACK:', error.message);
                ProfileLogger.error(profileId, `Error updating message ACK: ${error.message}`, null, 'message_ack');
            }
        });

        // Message received event - wrapped with extra safety to prevent server crash
        client.on('message', async (msg) => {
            try {
                await this._handleIncomingMessage(profileId, msg, client);
            } catch (error) {
                // Catch any unhandled errors to prevent server crash
                console.error(`Γ¥î Critical error in message handler for profile ${profileId}:`, error.message);
                ProfileLogger.error(profileId, `Critical message handler error: ${error.message}`, {
                    stack: error.stack,
                    from: msg?.from,
                    messageId: msg?.id?._serialized
                }, 'message_handler_critical');
            }
        });

        // Message sent event - track all outgoing messages for dashboard
        client.on('message_create', async (msg) => {
            if (msg.fromMe) {
                // Outgoing message - save to database
                try {
                    await Message.create({
                        client_id: profileId,
                        message_id: msg.id._serialized,
                        chat_id: msg.to,
                        from_number: msg.from?.replace('@c.us', '').replace('@g.us', ''),
                        to_number: msg.to?.replace('@c.us', '').replace('@g.us', ''),
                        body: msg.body || '',
                        type: msg.type || 'chat',
                        is_from_me: true,
                        is_forwarded: msg.isForwarded || false,
                        has_media: msg.hasMedia || false,
                        timestamp: new Date(msg.timestamp * 1000),
                        ack: msg.ack || 0
                    });
                    console.log(`📤 Sent message saved to database for profile ${profileId}`);
                } catch (error) {
                    console.error(`Error saving sent message for profile ${profileId}:`, error.message);
                }

                // ECHO WEBHOOK: Send outgoing messages to webhook if echo mode is enabled
                try {
                    const profile = await ClientModel.getById(profileId);

                    if (profile?.webhook_url && profile?.webhook_echo_enabled) {
                        // Determine if group
                        const isGroup = msg.to?.endsWith('@g.us');

                        // Get recipient info
                        let recipientName = '';
                        try {
                            const contact = await msg.getContact();
                            recipientName = contact?.pushname || contact?.name || '';
                        } catch (e) { }

                        // Handle media if present
                        let mediaUrl = null;
                        let detectedType = msg.type || 'chat';
                        if (msg.hasMedia) {
                            try {
                                const media = await msg.downloadMedia();
                                if (media) {
                                    const uploadsDir = path.join(__dirname, 'uploads');
                                    if (!fs.existsSync(uploadsDir)) {
                                        fs.mkdirSync(uploadsDir, { recursive: true });
                                    }
                                    const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                                    const filename = `echo_${Date.now()}_${msg.id.id}.${ext}`;
                                    const filepath = path.join(uploadsDir, filename);
                                    fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
                                    mediaUrl = `${BASE_URL}/uploads/${filename}`;

                                    if (media.mimetype.startsWith('image/')) detectedType = 'image';
                                    else if (media.mimetype.startsWith('video/')) detectedType = 'video';
                                    else if (media.mimetype.startsWith('audio/')) detectedType = 'audio';
                                    else detectedType = 'document';
                                }
                            } catch (mediaError) {
                                console.log(`⚠️ Could not download echo media: ${mediaError.message}`);
                            }
                        }

                        // Build echo webhook data
                        const echoWebhookData = {
                            deviceId: profile.id,
                            userId: profile.id,
                            from: msg.from?.replace('@c.us', '@s.whatsapp.net').replace('@g.us', '@g.us'),
                            to: msg.to?.replace('@c.us', '@s.whatsapp.net').replace('@g.us', '@g.us'),
                            messageId: msg.id.id,
                            type: detectedType === 'chat' ? 'text' : detectedType,
                            content: msg.body || '',
                            mediaUrl: mediaUrl,
                            timestamp: String(msg.timestamp),
                            recipientName: recipientName,
                            isEcho: true,
                            isGroup: isGroup,
                            profile: {
                                id: profile.id,
                                uuid: profile.uuid,
                                device_name: profile.device_name,
                                phone_number: profile.phone_number
                            },
                            msg: {
                                id: msg.id._serialized,
                                body: msg.body || '',
                                type: msg.type,
                                timestamp: msg.timestamp,
                                fromMe: true,
                                hasMedia: msg.hasMedia,
                                isForwarded: msg.isForwarded || false
                            }
                        };

                        await this._sendToWebhook(profile.webhook_url, echoWebhookData, profileId, 'echo_message');
                        console.log(`📤 Echo webhook sent for profile ${profileId}`);
                    }
                } catch (echoError) {
                    console.error(`Error sending echo webhook for profile ${profileId}:`, echoError.message);
                }
            }
            // Note: Incoming messages are handled by the 'message' event, not here
        });
    }

    async _handleIncomingMessage(profileId, msg, client) {
        const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

        try {
            // FILTER: Skip old messages on reconnect
            // Messages older than 60 seconds before connection are considered cached/old
            const clientData = this.clients.get(profileId);
            if (clientData && clientData.connectedAt) {
                const messageTimestamp = msg.timestamp * 1000; // Convert to ms
                const gracePeriod = 60 * 1000; // 60 seconds grace period
                const oldMessageThreshold = clientData.connectedAt - gracePeriod;

                if (messageTimestamp < oldMessageThreshold) {
                    // Skip this old message silently
                    console.log(`ΓÅ¡∩╕Å Skipping old message from ${msg.from} (received while offline)`);
                    return;
                }
            }

            // Detect if group message
            const isGroup = msg.from.includes('@g.us');
            let groupName = null;
            let authorNumber = null;

            if (isGroup) {
                try {
                    const chat = await msg.getChat();
                    groupName = chat.name || 'Unknown Group';
                    authorNumber = msg.author ? msg.author.replace('@c.us', '') : null;
                } catch (e) {
                    console.log('Could not get group info:', e.message);
                }
            }

            // Get contact/sender info
            let pushName = null;
            let contactName = null;
            try {
                const contact = await msg.getContact();
                pushName = contact.pushname || null;
                contactName = contact.name || null;
            } catch (e) {
                // Contact info not available
            }

            // Get profile picture URL
            let profilePicUrl = null;
            try {
                const contactId = isGroup ? (msg.author || msg.from) : msg.from;
                if (client) {
                    profilePicUrl = await client.getProfilePicUrl(contactId);
                }
            } catch (e) {
                // Profile picture not available
            }

            // Handle media
            let mediaUrl = null;
            let mediaUrlMp3 = null;
            let mediaUrlOgg = null;
            let mimeType = null;
            let mediaFilename = null;
            let detectedType = msg.type;

            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const uploadsDir = path.join(__dirname, 'uploads');
                        if (!fs.existsSync(uploadsDir)) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                        }

                        const baseFilename = `${Date.now()}_${msg.id.id}`;

                        const isAudio = media.mimetype.includes('audio') ||
                            media.mimetype.includes('ogg') ||
                            msg.type === 'ptt' ||
                            msg.type === 'audio';

                        if (isAudio) {
                            detectedType = 'audio';

                            const oggFilename = `${baseFilename}.ogg`;
                            const oggFilepath = path.join(uploadsDir, oggFilename);
                            fs.writeFileSync(oggFilepath, Buffer.from(media.data, 'base64'));
                            mediaUrlOgg = `${BASE_URL}/uploads/${oggFilename}`;
                            console.log(`≡ƒôü Audio saved (ogg): ${oggFilename}`);

                            try {
                                const { execSync } = require('child_process');
                                const mp3Filename = `${baseFilename}.mp3`;
                                const mp3Filepath = path.join(uploadsDir, mp3Filename);

                                execSync(`ffmpeg -i "${oggFilepath}" -acodec libmp3lame -y "${mp3Filepath}"`, {
                                    stdio: 'pipe'
                                });

                                mediaUrlMp3 = `${BASE_URL}/uploads/${mp3Filename}`;
                                console.log(`≡ƒôü Audio converted (mp3): ${mp3Filename}`);
                            } catch (ffmpegError) {
                                console.error('FFmpeg conversion error:', ffmpegError.message);
                                const mp3Filename = `${baseFilename}.mp3`;
                                const mp3Filepath = path.join(uploadsDir, mp3Filename);
                                fs.copyFileSync(oggFilepath, mp3Filepath);
                                mediaUrlMp3 = `${BASE_URL}/uploads/${mp3Filename}`;
                            }

                            mediaUrl = mediaUrlOgg;
                            mimeType = media.mimetype;
                            mediaFilename = oggFilename;
                        } else {
                            const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                            const filename = `${baseFilename}.${ext}`;
                            const filepath = path.join(uploadsDir, filename);

                            fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
                            mediaUrl = `${BASE_URL}/uploads/${filename}`;
                            mimeType = media.mimetype;
                            mediaFilename = filename;
                            console.log(`≡ƒôü Media saved: ${filename}`);
                        }
                    }
                } catch (e) {
                    console.log(`ΓÜá∩╕Å Could not download media: ${e.message}`);
                }
            }

            // Get quoted/reply message info
            let replyInfo = null;
            if (msg.hasQuotedMsg) {
                try {
                    const quotedMsg = await msg.getQuotedMessage();
                    if (quotedMsg) {
                        let quotedMediaUrl = null;
                        let quotedMediaType = null;

                        // Download media from quoted message if it has media
                        if (quotedMsg.hasMedia) {
                            try {
                                const quotedMedia = await quotedMsg.downloadMedia();
                                if (quotedMedia) {
                                    const uploadsDir = path.join(__dirname, 'uploads');
                                    if (!fs.existsSync(uploadsDir)) {
                                        fs.mkdirSync(uploadsDir, { recursive: true });
                                    }

                                    const ext = quotedMedia.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                                    const filename = `quoted_${Date.now()}_${quotedMsg.id.id}.${ext}`;
                                    const filepath = path.join(uploadsDir, filename);

                                    fs.writeFileSync(filepath, Buffer.from(quotedMedia.data, 'base64'));
                                    quotedMediaUrl = `${BASE_URL}/uploads/${filename}`;
                                    quotedMediaType = quotedMedia.mimetype;
                                    console.log(`📎 Quoted media saved: ${filename}`);
                                }
                            } catch (mediaError) {
                                console.log(`⚠️ Could not download quoted media: ${mediaError.message}`);
                            }
                        }

                        replyInfo = {
                            type: quotedMsg.type,
                            messageId: quotedMsg.id._serialized,
                            from: quotedMsg.from,
                            content: quotedMsg.body || '[Unsupported reply content]',
                            hasMedia: quotedMsg.hasMedia,
                            mediaUrl: quotedMediaUrl,
                            mediaType: quotedMediaType
                        };
                    }
                } catch (e) {
                    console.log(`⚠️ Could not get quoted message: ${e.message}`);
                }
            }


            // Get profile info
            const profile = await ClientModel.getById(profileId);

            // Format timestamp with Cairo timezone (UTC+2)
            const msgDate = new Date(msg.timestamp * 1000);
            const cairoOffset = 2 * 60 * 60 * 1000;
            const cairoDate = new Date(msgDate.getTime() + cairoOffset);
            const localTimestamp = cairoDate.toISOString().replace('Z', '+02:00');

            // Prepare message data for database
            const messageData = {
                client_id: profileId,
                message_id: msg.id._serialized,
                chat_id: msg.from,
                from_number: msg.from.replace('@c.us', '').replace('@g.us', ''),
                to_number: msg.to ? msg.to.replace('@c.us', '').replace('@g.us', '') : null,
                from_name: isGroup ? (pushName || authorNumber) : (pushName || contactName),
                body: msg.body || '',
                type: detectedType,
                is_from_me: msg.fromMe,
                is_forwarded: msg.isForwarded || false,
                has_media: msg.hasMedia,
                media_url: mediaUrlMp3 || mediaUrl,
                media_type: mimeType,
                timestamp: localTimestamp,
                ack: msg.ack
            };

            // Save to database
            const savedMessage = await Message.create(messageData);

            // Build comprehensive webhook data
            const webhookData = {
                deviceId: profile?.id || profileId,
                userId: profile?.id || profileId,
                from: msg.from.replace('@c.us', '@s.whatsapp.net').replace('@g.us', '@g.us'),
                to: msg.to ? msg.to.replace('@c.us', '@s.whatsapp.net').replace('@g.us', '@g.us') : null,
                sender: isGroup ? (msg.author || msg.from) : null,
                messageId: msg.id.id,
                type: detectedType === 'chat' ? 'text' : detectedType,
                content: msg.body || '',
                mediaUrl: mediaUrl,
                mediaUrlOgg: mediaUrlOgg,
                mediaUrlMp3: mediaUrlMp3,
                timestamp: String(msg.timestamp),
                pushName: pushName,
                profilePicUrl: profilePicUrl,
                reply: replyInfo,
                source: 'regular',
                isEcho: msg.fromMe,
                isFromAdvertisement: false,
                rawParticipant: isGroup ? (msg.author || '') : '',
                rawRemoteJid: msg.from.replace('@c.us', '@s.whatsapp.net'),
                remoteJidAlt: null,
                advertisementJid: null,
                isGroup: isGroup,
                groupName: groupName,
                profile: profile ? {
                    id: profile.id,
                    uuid: profile.uuid,
                    device_name: profile.device_name,
                    phone_number: profile.phone_number
                } : null,
                msg: {
                    id: msg.id._serialized,
                    body: msg.body || '',
                    type: msg.type,
                    timestamp: msg.timestamp,
                    fromMe: msg.fromMe,
                    hasMedia: msg.hasMedia,
                    isForwarded: msg.isForwarded || false,
                    hasQuotedMsg: msg.hasQuotedMsg || false,
                    vCards: msg.vCards || [],
                    mentionedIds: msg.mentionedIds || [],
                    links: msg.links || []
                },
                local_timestamp: localTimestamp
            };

            // Send to webhook if configured
            // For outgoing messages (fromMe), only send if webhook_echo_enabled is true
            const shouldSendWebhook = profile?.webhook_url && (!msg.fromMe || profile?.webhook_echo_enabled);

            if (shouldSendWebhook) {
                await this._sendToWebhook(profile.webhook_url, webhookData, profileId, msg.fromMe ? 'echo_message' : 'incoming_message');
                console.log(`📤 Webhook sent for profile ${profileId}${msg.fromMe ? ' (echo)' : ''}`);
                // Log webhook with full details
                ProfileLogger.log(profileId, ProfileLogger.LOG_TYPES.WEBHOOK_INCOMING, ProfileLogger.LOG_LEVELS.INFO,
                    `${msg.fromMe ? 'Echo' : 'Incoming'} message ${isGroup ? `from group: ${groupName}` : `from: ${pushName}`}`,
                    {
                        from: msg.from,
                        isGroup: isGroup,
                        groupName: isGroup ? groupName : null,
                        pushName: pushName,
                        profilePicUrl: profilePicUrl,
                        messageType: detectedType,
                        content: msg.body ? msg.body.substring(0, 100) : '',
                        hasMedia: msg.hasMedia,
                        mediaUrl: mediaUrl,
                        webhookUrl: profile.webhook_url,
                        timestamp: localTimestamp,
                        isEcho: msg.fromMe
                    }
                );
            }

            // Log incoming message with full JSON details
            ProfileLogger.log(profileId, ProfileLogger.LOG_TYPES.MESSAGE_RECEIVED, ProfileLogger.LOG_LEVELS.INFO,
                `Message from ${isGroup ? groupName : pushName}`,
                {
                    from: msg.from,
                    isGroup: isGroup,
                    groupName: isGroup ? groupName : null,
                    pushName: pushName,
                    profilePicUrl: profilePicUrl,
                    messageId: msg.id._serialized,
                    messageType: detectedType,
                    content: msg.body ? msg.body.substring(0, 200) : '',
                    hasMedia: msg.hasMedia,
                    mediaUrl: mediaUrl,
                    mediaUrlMp3: mediaUrlMp3,
                    timestamp: msg.timestamp,
                    fromMe: msg.fromMe,
                    hasQuotedMsg: msg.hasQuotedMsg || false,
                    isForwarded: msg.isForwarded || false
                }
            );

            // Mark our messages to this chat as replied (for read-no-reply tracking)
            if (!msg.fromMe) {
                const recipientNumber = msg.from.replace('@c.us', '').replace('@g.us', '');
                try {
                    const updateResult = await pool.query(`
                        UPDATE api_message_queue 
                        SET customer_replied = true
                        WHERE device_id = $1 
                        AND recipient = $2
                        AND customer_replied = false
                    `, [profileId, recipientNumber]);

                    if (updateResult.rowCount > 0) {
                        console.log(`≡ƒô¥ Marked ${updateResult.rowCount} messages as replied by customer`);
                        // Log customer replied
                        ProfileLogger.customerReplied(profileId, recipientNumber, updateResult.rowCount);
                    }
                } catch (e) {
                    console.error('Error marking messages as replied:', e.message);
                    ProfileLogger.error(profileId, e.message, null, 'customer_replied_tracking');
                }
            }

            // Check auto-replies
            if (!msg.fromMe && msg.body) {
                const autoReply = await AutoReply.findMatch(profileId, msg.body);
                if (autoReply) {
                    if (client) {
                        await client.sendMessage(msg.from, autoReply.reply_message);
                        await AutoReply.incrementCount(autoReply.id);
                        console.log(`≡ƒñû Auto-reply sent for profile ${profileId}`);
                        // Log auto-reply
                        ProfileLogger.autoReply(profileId, msg.from, autoReply.keyword, autoReply.reply_message);
                    }
                }
            }

            // Emit to socket
            this._emitToProfile(profileId, 'message', { profileId, message: webhookData });

        } catch (error) {
            console.error('Error handling message:', error);
            ProfileLogger.error(profileId, `Error handling message: ${error.message}`, { stack: error.stack, from: msg?.from }, 'message_handler');
        }
    }

    async _sendToWebhook(webhookUrl, data) {
        try {
            const fetch = (await import('node-fetch')).default;
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            console.log(`≡ƒôñ Webhook sent to ${webhookUrl}`);
            ProfileLogger.webhookSent(data.profile?.id || null, webhookUrl, 'incoming_message', data.msg?.from);
        } catch (error) {
            console.error('Webhook error:', error.message);
            ProfileLogger.error(data.profile?.id || null, `Webhook error: ${error.message}`, { webhookUrl }, 'webhook_send');
        }
    }

    _emitToProfile(profileId, event, data) {
        if (this.io) {
            this.io.emit(event, data);
            this.io.to(`profile_${profileId}`).emit(event, data);
        }
    }

    _updateStatus(profileId, status) {
        const clientData = this.clients.get(profileId);
        if (clientData) {
            clientData.status = status;
            this._emitToProfile(profileId, 'status', { profileId, status });
        }
    }

    getClient(profileId) {
        const clientData = this.clients.get(profileId);
        return clientData?.client || null;
    }

    getStatus(profileId) {
        const clientData = this.clients.get(profileId);
        if (!clientData) {
            return {
                status: 'not_initialized',
                connected: false,
                qrCode: null,
                info: null
            };
        }
        return {
            status: clientData.status,
            connected: clientData.connected,
            qrCode: clientData.qrCode,
            info: clientData.info
        };
    }

    hasClient(profileId) {
        return this.clients.has(profileId);
    }

    async sendMessage(profileId, chatId, message) {
        const client = this.getClient(profileId);
        if (!client) {
            throw new Error('WhatsApp client not initialized');
        }

        if (!chatId.includes('@')) {
            chatId = `${chatId}@c.us`;
        }

        const result = await client.sendMessage(chatId, message);
        console.log(`≡ƒôñ Message sent via profile ${profileId}`);

        return {
            success: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp,
            to: chatId
        };
    }

    async destroyClient(profileId) {
        const clientData = this.clients.get(profileId);
        if (!clientData?.client) {
            return;
        }

        try {
            await clientData.client.logout();
            await clientData.client.destroy();
        } catch (error) {
            console.error(`Error destroying client ${profileId}:`, error.message);
            ProfileLogger.error(profileId, `Error destroying client: ${error.message}`, null, 'client_destroy');
        }

        this.clients.delete(profileId);
        await ClientModel.updateStatus(profileId, 'disconnected');
        console.log(`≡ƒùæ∩╕Å Client ${profileId} destroyed`);
    }

    /**
     * Send data to webhook URL
     * @param {string} webhookUrl - The webhook URL to send data to
     * @param {object} data - The data to send
     * @param {number} profileId - The profile ID for logging
     * @param {string} webhookType - Type of webhook: 'incoming_message', 'unread_message', 'read_no_reply'
     */
    async _sendToWebhook(webhookUrl, data, profileId = null, webhookType = 'incoming_message') {
        let responseCode = null;
        let responseBody = null;
        let status = 'pending';
        let errorMessage = null;

        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'OctoSHOT-WhatsApp/1.0'
                },
                body: JSON.stringify(data),
                timeout: 10000 // 10 second timeout
            });

            responseCode = response.status;
            responseBody = await response.text();

            if (response.ok) {
                console.log(`✅ Webhook delivered successfully to ${webhookUrl}`);
                console.log(`📥 Webhook response: ${responseBody.substring(0, 200)}`);
                status = 'success';
            } else {
                console.error(`❌ Webhook failed: ${response.status} ${response.statusText}`);
                status = 'failed';
                errorMessage = response.statusText;
            }
        } catch (error) {
            console.error(`❌ Webhook error for ${webhookUrl}:`, error.message);
            status = 'failed';
            errorMessage = error.message;
        }

        // Log webhook to database
        try {
            await WebhookLog.create({
                profile_id: profileId,
                webhook_type: webhookType,
                webhook_url: webhookUrl,
                payload: data,
                status: status,
                response_code: responseCode,
                response_body: responseBody,
                error_message: errorMessage
            });

            // Emit to socket for live updates
            if (this.io) {
                this.io.emit('webhook_log', {
                    profile_id: profileId,
                    webhook_type: webhookType,
                    status: status
                });
            }
        } catch (logError) {
            console.error('Error logging webhook:', logError.message);
        }

        return { success: status === 'success', status: responseCode, error: errorMessage };
    }

    getAllStatus() {
        const statuses = {};
        for (const [profileId, clientData] of this.clients) {
            statuses[profileId] = {
                status: clientData.status,
                connected: clientData.connected,
                info: clientData.info
            };
        }
        return statuses;
    }
}

module.exports = new WhatsAppManager();
