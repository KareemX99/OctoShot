/**
 * LocalSessionStrategy - WhatsApp Session Storage using Local Files
 * 
 * Features:
 * - Stores compressed sessions as local .tar.gz files
 * - Pure local storage - no database required
 * - No size limits - works with any session size
 * - Fast read/write from local disk
 * - Simple and reliable
 * 
 * @author OctoSHOT Team
 */

const BaseAuthStrategy = require('whatsapp-web.js/src/authStrategies/BaseAuthStrategy');
const tar = require('tar-fs');
const zlib = require('zlib');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const ProfileLogger = require('./ProfileLogger');

// Folder to store session backups
const SESSIONS_FOLDER = './.wwebjs_sessions_backup';

// Files/folders to exclude (reduces size by 90%+)
const EXCLUDE_PATTERNS = [
    '/Cache/', '/Code Cache/', '/GPUCache/', '/DawnCache/',
    '/CacheStorage/', '/ScriptCache/', '/blob_storage/',
    '/Session Storage/', '/VideoDecodeStats/', '/Crashpad/',
    '.log', '.tmp'
];

class LocalSessionStrategy extends BaseAuthStrategy {
    constructor(options = {}) {
        super();
        this.sessionId = options.sessionId;
        this.clientId = options.clientId;
        this.dataPath = options.dataPath || './.wwebjs_auth';
        this.backupOnAuth = options.backupOnAuth !== false;
        this.userDataDir = null;
        this.backupInProgress = false;

        // Ensure backup folder exists
        if (!fs.existsSync(SESSIONS_FOLDER)) {
            fs.mkdirSync(SESSIONS_FOLDER, { recursive: true });
        }
    }

    getSessionPath() {
        return path.join(this.dataPath, `session-${this.sessionId}`);
    }

    getBackupPath() {
        return path.join(SESSIONS_FOLDER, `${this.sessionId}.tar.gz`);
    }

    shouldExclude(filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        return EXCLUDE_PATTERNS.some(p => normalized.includes(p));
    }

    /**
     * Restore session from local backup file
     */
    async beforeBrowserInitialized() {
        const sessionPath = this.getSessionPath();
        this.userDataDir = sessionPath;
        const backupPath = this.getBackupPath();

        console.log(`[${this.sessionId}] 🔍 Checking for local backup...`);

        try {
            if (fs.existsSync(backupPath)) {
                const stats = fs.statSync(backupPath);
                const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

                console.log(`[${this.sessionId}] 📥 Found backup (${sizeMB} MB). Restoring...`);
                const startTime = Date.now();

                // Clean and recreate session directory
                await fsp.rm(sessionPath, { recursive: true, force: true });
                await fsp.mkdir(sessionPath, { recursive: true });

                // Extract backup
                const readStream = fs.createReadStream(backupPath);
                const decompressor = zlib.createGunzip();
                const extractor = tar.extract(sessionPath);

                await pipeline(readStream, decompressor, extractor);

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`[${this.sessionId}] ✅ Session restored in ${elapsed}s`);

                await ProfileLogger.sessionExtract(this.clientId, this.sessionId, 'completed', stats.size);
            } else {
                console.log(`[${this.sessionId}] 📭 No backup found - will need QR scan`);
            }
        } catch (err) {
            console.error(`[${this.sessionId}] ❌ Restore error:`, err.message);
            await ProfileLogger.error(this.clientId, err.message, { session: this.sessionId }, 'session_restore');
        }

        return { userDataDir: sessionPath };
    }

    async afterAuthReady() {
        if (this.backupOnAuth) {
            console.log(`[${this.sessionId}] 🔄 Performing initial backup...`);
            await this.saveSession();
        }
    }

    /**
     * Save session to local backup file
     */
    async saveSession() {
        if (this.backupInProgress) {
            console.log(`[${this.sessionId}] ⏳ Backup in progress, skipping...`);
            return;
        }
        this.backupInProgress = true;

        const sessionPath = this.getSessionPath();
        const backupPath = this.getBackupPath();

        if (!fs.existsSync(sessionPath)) {
            console.warn(`[${this.sessionId}] ⚠️ No session to backup`);
            this.backupInProgress = false;
            return;
        }

        console.log(`[${this.sessionId}] 💾 Saving session to local file...`);
        const startTime = Date.now();

        try {
            // Create tar.gz backup with filtering
            const packStream = tar.pack(sessionPath, {
                ignore: (name) => this.shouldExclude(name)
            });
            const compressor = zlib.createGzip({ level: 6 });
            const writeStream = fs.createWriteStream(backupPath);

            await pipeline(packStream, compressor, writeStream);

            const stats = fs.statSync(backupPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(`[${this.sessionId}] ✅ Backup saved: ${sizeMB} MB in ${elapsed}s`);

            await ProfileLogger.sessionSave(this.clientId, this.sessionId, 'completed', stats.size);

        } catch (err) {
            console.error(`[${this.sessionId}] ❌ Backup failed:`, err.message);
            await ProfileLogger.sessionSave(this.clientId, this.sessionId, 'failed', null, { error: err.message });
        } finally {
            this.backupInProgress = false;
        }
    }

    async destroy() {
        console.log(`[${this.sessionId}] 🗑️ Destroying session...`);

        const backupPath = this.getBackupPath();
        const sessionPath = this.getSessionPath();

        try {
            // Delete backup file
            if (fs.existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
                console.log(`[${this.sessionId}] ✅ Backup file deleted`);
            }

            // Delete session folder
            await fsp.rm(sessionPath, { recursive: true, force: true });

            console.log(`[${this.sessionId}] ✅ Session destroyed`);
        } catch (err) {
            console.error(`[${this.sessionId}] ❌ Destroy error:`, err.message);
        }
    }

    async logout() {
        await this.destroy();
    }

    async sessionExists() {
        return fs.existsSync(this.getBackupPath());
    }

    async getSessionInfo() {
        const backupPath = this.getBackupPath();
        if (!fs.existsSync(backupPath)) return null;

        const stats = fs.statSync(backupPath);
        return {
            session_id: this.sessionId,
            file_path: backupPath,
            size_bytes: stats.size,
            updated_at: stats.mtime
        };
    }
}

module.exports = LocalSessionStrategy;
