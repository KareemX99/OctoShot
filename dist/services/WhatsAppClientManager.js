"use strict";
/**
 * WhatsAppClientManager
 * Main class managing all WhatsApp client instances with full TypeScript support
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClientManager = void 0;
const whatsapp_web_js_1 = require("whatsapp-web.js");
const qrcode = __importStar(require("qrcode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const types_1 = require("../types");
const WebhookService_1 = require("./WebhookService");
const logger_1 = require("../utils/logger");
const validators_1 = require("../utils/validators");
// Import database pool and models
const { pool } = require('../../config/database');
const ClientModel = require('../../models/Client');
const ProfileLogger = require('../../services/ProfileLogger');
class WhatsAppClientManager {
    constructor() {
        this.clients = new Map();
        this.io = null;
        this.BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
        this.SESSION_PATH = './.wwebjs_auth';
    }
    /**
     * Set Socket.IO instance for real-time communication
     */
    setSocketIO(io) {
        this.io = io;
        logger_1.logger.info('Socket.IO initialized');
    }
    /**
     * Emit event to specific profile's socket room
     */
    emitToProfile(profileId, event, data) {
        if (this.io) {
            this.io.emit(event, { profileId, ...data });
        }
    }
    /**
     * Check if client exists for profile
     */
    hasClient(profileId) {
        return this.clients.has(profileId);
    }
    /**
     * Get WhatsApp client instance
     */
    getClient(profileId) {
        const clientData = this.clients.get(profileId);
        return clientData?.client || null;
    }
    /**
     * Get status for a specific profile
     */
    getStatus(profileId) {
        const clientData = this.clients.get(profileId);
        if (!clientData) {
            return {
                status: 'disconnected',
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
    /**
     * Get status of all clients
     */
    getAllStatus() {
        const statuses = {};
        for (const [profileId, clientData] of this.clients) {
            statuses[profileId] = {
                status: clientData.status,
                connected: clientData.connected,
                qrCode: clientData.qrCode,
                info: clientData.info
            };
        }
        return statuses;
    }
    /**
     * Update client status
     */
    updateStatus(profileId, status) {
        const clientData = this.clients.get(profileId);
        if (clientData) {
            clientData.status = status;
            clientData.connected = status === 'connected';
            if (status === 'connected' && !clientData.connectedAt) {
                clientData.connectedAt = Date.now();
            }
        }
    }
    /**
     * Create new WhatsApp client for profile
     */
    async createClient(profileId) {
        if (!(0, validators_1.isValidProfileId)(profileId)) {
            throw new types_1.WhatsAppClientError('INVALID_PROFILE', `Invalid profile ID: ${profileId}`);
        }
        // Destroy existing client if any
        if (this.clients.has(profileId)) {
            logger_1.logger.warn('Destroying existing client before creating new one', profileId);
            await this.destroyClient(profileId);
        }
        logger_1.logger.info('Creating new WhatsApp client', profileId);
        await ClientModel.updateStatus(profileId, 'initializing');
        // Initialize client data
        const clientData = {
            client: null, // Will be set below
            qrCode: null,
            status: 'initializing',
            connected: false,
            info: null,
            connectedAt: null,
            profileId
        };
        // Create WhatsApp client
        const client = new whatsapp_web_js_1.Client({
            authStrategy: new whatsapp_web_js_1.LocalAuth({
                clientId: `profile_${profileId}`,
                dataPath: this.SESSION_PATH
            }),
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
        clientData.client = client;
        this.clients.set(profileId, clientData);
        // Setup event handlers
        this.setupClientEvents(profileId, client);
        // Initialize client
        try {
            await client.initialize();
            return clientData;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Failed to initialize client: ${message}`, profileId);
            // Clean up on failure
            this.clients.delete(profileId);
            await ClientModel.updateStatus(profileId, 'disconnected');
            throw new types_1.WhatsAppClientError('INIT_FAILED', message, profileId);
        }
    }
    /**
     * Setup all event handlers for client
     */
    setupClientEvents(profileId, client) {
        // QR Code event
        client.on('qr', async (qr) => {
            logger_1.logger.connection(profileId, 'qr_generated');
            try {
                const qrDataUrl = await qrcode.toDataURL(qr);
                const clientData = this.clients.get(profileId);
                if (clientData) {
                    clientData.qrCode = qrDataUrl;
                    clientData.status = 'qr';
                }
                await ClientModel.updateStatus(profileId, 'qr');
                this.emitToProfile(profileId, 'qr', { qrCode: qrDataUrl });
                this.emitToProfile(profileId, 'status', { status: 'qr' });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger_1.logger.error(`QR generation failed: ${message}`, profileId);
            }
        });
        // Loading screen event
        client.on('loading_screen', (percent, message) => {
            logger_1.logger.info(`Loading: ${percent}% - ${message}`, profileId);
            this.emitToProfile(profileId, 'loading', { percent, message });
        });
        // Authenticated event
        client.on('authenticated', async () => {
            logger_1.logger.connection(profileId, 'authenticated');
            // Treat authenticated as connected for UI purposes
            const clientData = this.clients.get(profileId);
            if (clientData) {
                clientData.connected = true;
            }
            this.updateStatus(profileId, 'connected');
            await ClientModel.updateConnection(profileId, {
                status: 'connected'
            });
            logger_1.logger.info(`Database updated: Profile ${profileId} → connected`, profileId);
            this.emitToProfile(profileId, 'authenticated', {
                info: { phoneNumber: 'جاري التحميل...' }
            });
            this.emitToProfile(profileId, 'status', { status: 'connected' });
            // Fallback: Poll for client.info if ready doesn't fire within 10 seconds
            const pollForInfo = async () => {
                for (let i = 0; i < 20; i++) {
                    await (0, validators_1.sleep)(500);
                    if (client.info?.wid?.user) {
                        logger_1.logger.info(`Phone number fetched via polling: ${client.info.wid.user}`, profileId);
                        try {
                            await ClientModel.updateConnection(profileId, {
                                phone_number: client.info.wid.user,
                                name: client.info.pushname,
                                push_name: client.info.pushname,
                                platform: client.info.platform,
                                status: 'connected'
                            });
                            // Update local client data
                            const data = this.clients.get(profileId);
                            if (data) {
                                data.connectedAt = Date.now();
                                data.info = {
                                    pushname: client.info.pushname,
                                    platform: client.info.platform,
                                    phoneNumber: client.info.wid.user,
                                    wid: client.info.wid
                                };
                            }
                            // Emit updated info to frontend
                            this.emitToProfile(profileId, 'ready', {
                                connected: true,
                                info: client.info,
                                phone_number: client.info.wid.user
                            });
                        }
                        catch (err) {
                            logger_1.logger.error(`Error saving polled phone: ${err}`, profileId);
                        }
                        return;
                    }
                }
                logger_1.logger.warn(`Timeout waiting for client.info`, profileId);
            };
            pollForInfo().catch(err => logger_1.logger.error(`Poll error: ${err}`, profileId));
        });
        // Ready event
        client.on('ready', async () => {
            logger_1.logger.connection(profileId, 'ready');
            this.updateStatus(profileId, 'connected');
            const clientData = this.clients.get(profileId);
            if (clientData) {
                clientData.connectedAt = Date.now();
                clientData.info = {
                    pushname: client.info?.pushname,
                    platform: client.info?.platform,
                    phoneNumber: client.info?.wid?.user,
                    wid: client.info?.wid
                };
            }
            // Update database with phone number
            try {
                if (client.info?.wid?.user) {
                    await pool.query('UPDATE clients SET phone_number = $1, status = $2, updated_at = NOW() WHERE id = $3', [client.info.wid.user, 'connected', profileId]);
                }
            }
            catch (error) {
                logger_1.logger.error(`Failed to update phone number: ${error}`, profileId);
            }
            this.emitToProfile(profileId, 'ready', {
                connected: true,
                info: client.info,
                phone_number: client.info?.wid?.user
            });
            this.emitToProfile(profileId, 'status', { status: 'connected' });
            ProfileLogger.connection(profileId, 'ready', {
                phoneNumber: client.info?.wid?.user,
                pushName: client.info?.pushname,
                platform: client.info?.platform
            });
        });
        // Auth failure event
        client.on('auth_failure', async (msg) => {
            logger_1.logger.error(`Authentication failed: ${msg}`, profileId);
            this.updateStatus(profileId, 'error');
            await ClientModel.updateStatus(profileId, 'error');
            this.emitToProfile(profileId, 'auth_failure', { reason: msg });
            this.emitToProfile(profileId, 'status', { status: 'error' });
        });
        // Disconnected event  
        client.on('disconnected', async (reason) => {
            logger_1.logger.connection(profileId, 'disconnected', { reason });
            this.updateStatus(profileId, 'disconnected');
            await ClientModel.updateStatus(profileId, 'disconnected');
            this.emitToProfile(profileId, 'disconnected', { reason });
            this.emitToProfile(profileId, 'status', { status: 'disconnected' });
            // Clean up
            this.clients.delete(profileId);
        });
        // Message event
        client.on('message', async (msg) => {
            await this.handleIncomingMessage(profileId, msg, client);
        });
    }
    /**
     * Handle incoming message
     */
    async handleIncomingMessage(profileId, msg, client) {
        try {
            // Skip old messages on reconnect
            const clientData = this.clients.get(profileId);
            if (clientData?.connectedAt) {
                const messageTimestamp = msg.timestamp * 1000;
                const gracePeriod = 60 * 1000;
                const oldMessageThreshold = clientData.connectedAt - gracePeriod;
                if (messageTimestamp < oldMessageThreshold) {
                    logger_1.logger.info(`Skipping old message from ${msg.from}`, profileId);
                    return;
                }
            }
            // Get profile from database
            const profile = await ClientModel.getById(profileId);
            if (!profile) {
                logger_1.logger.error('Profile not found in database', profileId);
                return;
            }
            // Detect group message
            const isGroup = msg.from.includes('@g.us');
            let groupName = null;
            let pushName = 'Unknown';
            let authorNumber = (0, validators_1.extractPhoneFromJid)(msg.from);
            // Get contact info
            try {
                const contact = await msg.getContact();
                pushName = contact?.pushname || contact?.name || authorNumber;
            }
            catch {
                pushName = authorNumber;
            }
            // Get group info
            if (isGroup) {
                try {
                    const chat = await msg.getChat();
                    groupName = chat.name;
                    if (msg.author) {
                        authorNumber = (0, validators_1.extractPhoneFromJid)(msg.author);
                        try {
                            const authorContact = await client.getContactById(msg.author);
                            pushName = authorContact?.pushname || authorNumber;
                        }
                        catch {
                            pushName = authorNumber;
                        }
                    }
                }
                catch (error) {
                    logger_1.logger.warn(`Failed to get group info: ${error}`, profileId);
                }
            }
            // Get profile picture
            let profilePicUrl = null;
            try {
                const contactId = isGroup ? (msg.author || msg.from) : msg.from;
                profilePicUrl = await client.getProfilePicUrl(contactId);
            }
            catch {
                // Profile picture not available
            }
            // Handle media
            let mediaUrl = null;
            let mediaUrlMp3 = null;
            let mediaUrlOgg = null;
            let detectedType = msg.type;
            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const baseFilename = `${Date.now()}_${msg.id.id}`;
                        const uploadsDir = path.join(process.cwd(), 'uploads');
                        // Ensure uploads directory exists
                        if (!fs.existsSync(uploadsDir)) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                        }
                        const isAudio = media.mimetype.includes('audio') ||
                            media.mimetype.includes('ogg') ||
                            msg.type === 'ptt' ||
                            msg.type === 'audio';
                        if (isAudio) {
                            detectedType = 'audio';
                            const oggFilename = `${baseFilename}.ogg`;
                            const oggFilepath = path.join(uploadsDir, oggFilename);
                            fs.writeFileSync(oggFilepath, Buffer.from(media.data, 'base64'));
                            mediaUrlOgg = `${this.BASE_URL}/uploads/${oggFilename}`;
                            mediaUrl = mediaUrlOgg;
                            // Try to convert to MP3
                            try {
                                const { execSync } = require('child_process');
                                const mp3Filename = `${baseFilename}.mp3`;
                                const mp3Filepath = path.join(uploadsDir, mp3Filename);
                                execSync(`ffmpeg -i "${oggFilepath}" -acodec libmp3lame -y "${mp3Filepath}"`, { stdio: 'pipe' });
                                mediaUrlMp3 = `${this.BASE_URL}/uploads/${mp3Filename}`;
                            }
                            catch {
                                // FFmpeg not available or conversion failed
                            }
                        }
                        else {
                            const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
                            const filename = `${baseFilename}.${ext}`;
                            const filepath = path.join(uploadsDir, filename);
                            fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
                            mediaUrl = `${this.BASE_URL}/uploads/${filename}`;
                        }
                        logger_1.logger.info(`Media saved: ${mediaUrl}`, profileId);
                    }
                }
                catch (error) {
                    logger_1.logger.error(`Failed to download media: ${error}`, profileId);
                }
            }
            // Get quoted message info
            let replyInfo = null;
            if (msg.hasQuotedMsg) {
                try {
                    const quotedMsg = await msg.getQuotedMessage();
                    if (quotedMsg) {
                        replyInfo = {
                            type: quotedMsg.type,
                            messageId: quotedMsg.id._serialized,
                            from: quotedMsg.from,
                            content: quotedMsg.body || '[Unsupported content]'
                        };
                    }
                }
                catch {
                    // Quoted message not available
                }
            }
            // Build webhook payload
            const webhookPayload = {
                deviceId: profile.id,
                userId: profile.id,
                from: msg.from.replace('@c.us', '@s.whatsapp.net').replace('@g.us', '@g.us'),
                sender: isGroup ? (msg.author || msg.from) : undefined,
                messageId: msg.id.id,
                type: detectedType === 'chat' ? 'text' : detectedType,
                content: msg.body,
                mediaUrl,
                mediaUrlOgg,
                mediaUrlMp3,
                timestamp: String(msg.timestamp),
                pushName: pushName,
                profilePicUrl,
                reply: replyInfo,
                source: 'regular',
                isFromAdvertisement: false,
                isGroup,
                groupName,
                rawParticipant: isGroup ? (msg.author || '') : '',
                rawRemoteJid: msg.from.replace('@c.us', '@s.whatsapp.net'),
                remoteJidAlt: null,
                advertisementJid: null,
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
            // Send to webhook if configured
            if (profile.webhook_url) {
                logger_1.logger.webhook(profileId, profile.webhook_url, 'sent');
                const result = await WebhookService_1.webhookService.sendWithRetry(profile.webhook_url, webhookPayload);
                if (result.success) {
                    logger_1.logger.webhook(profileId, profile.webhook_url, 'sent', `${result.attempts} attempt(s)`);
                }
                else {
                    logger_1.logger.webhook(profileId, profile.webhook_url, 'failed', result.error);
                }
                ProfileLogger.log(profileId, ProfileLogger.LOG_TYPES.WEBHOOK_INCOMING, ProfileLogger.LOG_LEVELS.INFO, `Incoming message ${isGroup ? `from group: ${groupName}` : `from: ${pushName}`}`, {
                    from: msg.from,
                    isGroup,
                    groupName,
                    pushName,
                    messageType: detectedType,
                    webhookUrl: profile.webhook_url,
                    webhookSuccess: result.success
                });
            }
            // Log message
            ProfileLogger.log(profileId, ProfileLogger.LOG_TYPES.MESSAGE_RECEIVED, ProfileLogger.LOG_LEVELS.INFO, `Message from ${isGroup ? groupName : pushName}`, {
                from: msg.from,
                isGroup,
                messageId: msg.id._serialized,
                messageType: detectedType,
                content: msg.body?.substring(0, 200) || ''
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Error handling message: ${message}`, profileId);
        }
    }
    /**
     * Send message
     */
    async sendMessage(profileId, phoneNumber, message) {
        const clientData = this.clients.get(profileId);
        if (!clientData || !clientData.connected) {
            return {
                success: false,
                error: 'WhatsApp is not connected'
            };
        }
        const client = clientData.client;
        const chatId = (0, validators_1.formatPhoneToJid)(phoneNumber);
        try {
            // Check if number is registered (for individual chats)
            if (chatId.includes('@c.us')) {
                const isRegistered = await client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    return {
                        success: false,
                        error: 'This number is not registered on WhatsApp'
                    };
                }
            }
            const result = await client.sendMessage(chatId, message);
            logger_1.logger.message(profileId, 'outgoing', chatId, message);
            return {
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
                to: chatId
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger_1.logger.error(`Failed to send message: ${errorMessage}`, profileId);
            return {
                success: false,
                error: errorMessage
            };
        }
    }
    /**
     * Destroy client
     */
    async destroyClient(profileId) {
        const clientData = this.clients.get(profileId);
        if (!clientData) {
            return;
        }
        logger_1.logger.info('Destroying client', profileId);
        try {
            await clientData.client.logout();
        }
        catch (error) {
            // Ignore logout errors
        }
        try {
            await clientData.client.destroy();
        }
        catch (error) {
            logger_1.logger.warn(`Error destroying client: ${error}`, profileId);
        }
        this.clients.delete(profileId);
        await ClientModel.updateStatus(profileId, 'disconnected');
        logger_1.logger.info('Client destroyed', profileId);
    }
    /**
     * Auto-restore previously connected sessions
     */
    async autoRestoreSessions() {
        logger_1.logger.info('Auto-restoring sessions...');
        try {
            const result = await pool.query("SELECT id FROM clients WHERE status = 'connected' ORDER BY id");
            if (result.rows.length === 0) {
                logger_1.logger.info('No sessions to restore');
                return;
            }
            logger_1.logger.info(`Found ${result.rows.length} sessions to restore`);
            for (const row of result.rows) {
                try {
                    logger_1.logger.info(`Restoring session for profile ${row.id}`);
                    await this.createClient(row.id);
                    await (0, validators_1.sleep)(2000); // Wait between connections
                }
                catch (error) {
                    logger_1.logger.error(`Failed to restore session for profile ${row.id}: ${error}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`Auto-restore failed: ${error}`);
        }
    }
}
exports.WhatsAppClientManager = WhatsAppClientManager;
// Export singleton instance
const whatsappManager = new WhatsAppClientManager();
exports.default = whatsappManager;
//# sourceMappingURL=WhatsAppClientManager.js.map