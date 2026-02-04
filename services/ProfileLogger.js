/**
 * Profile Logger Service
 * Centralized logging for WhatsApp profile activities
 * Logs to database and emits real-time via Socket.IO
 */

const { pool } = require('../config/database');

// Socket.IO instance (set by server)
let io = null;

// Log types enum
const LOG_TYPES = {
    CONNECTION: 'connection',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_FAILED: 'message_failed',
    MESSAGE_DELIVERED: 'message_delivered',
    MESSAGE_READ: 'message_read',
    MESSAGE_RECEIVED: 'message_received',
    BLOCK_DETECTED: 'block_detected',
    TYPING_SIMULATION: 'typing_simulation',
    SESSION_BACKUP: 'session_backup',
    SESSION_RESTORE: 'session_restore',
    SESSION_CHECK: 'session_check',
    SESSION_EXTRACT: 'session_extract',
    SESSION_SAVE: 'session_save',
    CLIENT_INIT: 'client_init',
    CLIENT_DESTROY: 'client_destroy',
    AUTO_RESTORE: 'auto_restore',
    RATE_LIMIT: 'rate_limit',
    WARNING: 'warning',
    QUEUE_PROCESS: 'queue_process',
    BLACKLIST: 'blacklist',
    SPINTAX: 'spintax',
    // New comprehensive types
    WEBHOOK_SENT: 'webhook_sent',
    WEBHOOK_INCOMING: 'webhook_incoming',
    WEBHOOK_UNREAD: 'webhook_unread',
    WEBHOOK_NOREPLY: 'webhook_noreply',
    BATCH_CREATED: 'batch_created',
    BATCH_COMPLETED: 'batch_completed',
    AUTO_REPLY: 'auto_reply',
    CUSTOMER_REPLIED: 'customer_replied',
    MEDIA_DOWNLOAD: 'media_download',
    API_CALL: 'api_call',
    ERROR: 'error'
};

// Log levels
const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

class ProfileLogger {
    /**
     * Set the Socket.IO instance for real-time emission
     */
    static setSocketIO(socketIO) {
        io = socketIO;
    }

    /**
     * Get profile info by client ID (cached for performance)
     */
    static profileCache = new Map();

    static async getProfileInfo(clientId) {
        // Check cache first (valid for 5 minutes)
        const cached = this.profileCache.get(clientId);
        if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
            return cached.data;
        }

        try {
            const result = await pool.query(
                'SELECT uuid, device_name, phone_number FROM clients WHERE id = $1',
                [clientId]
            );
            const profile = result.rows[0] || { uuid: null, device_name: 'Unknown', phone_number: null };

            // Cache it
            this.profileCache.set(clientId, { data: profile, timestamp: Date.now() });
            return profile;
        } catch (error) {
            return { uuid: null, device_name: 'Unknown', phone_number: null };
        }
    }

    /**
     * Clear profile cache (call when profile is updated)
     */
    static clearProfileCache(clientId = null) {
        if (clientId) {
            this.profileCache.delete(clientId);
        } else {
            this.profileCache.clear();
        }
    }

    /**
     * Main logging method
     * @param {number} clientId - The WhatsApp client/profile ID
     * @param {string} logType - Type of log (use LOG_TYPES)
     * @param {string} logLevel - Severity level (use LOG_LEVELS)
     * @param {string} message - Human-readable message
     * @param {object} details - Additional JSON details
     * @param {string} explanation - Detailed explanation for technical staff
     */
    static async log(clientId, logType, logLevel, message, details = null, explanation = null) {
        // Get profile info
        const profile = await this.getProfileInfo(clientId);

        const logEntry = {
            client_id: clientId,
            profile_uuid: profile.uuid,
            profile_name: profile.device_name,
            profile_phone: profile.phone_number,
            log_type: logType,
            log_level: logLevel,
            message: message,
            explanation: explanation,
            details: details,
            created_at: new Date().toISOString()
        };

        try {
            // Save to database (with explanation in details)
            const dbDetails = { ...details, explanation };
            const result = await pool.query(`
                INSERT INTO profile_logs (client_id, log_type, log_level, message, details)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, created_at
            `, [clientId, logType, logLevel, message, dbDetails ? JSON.stringify(dbDetails) : null]);

            logEntry.id = result.rows[0].id;
            logEntry.created_at = result.rows[0].created_at;

            // Emit to admin clients via Socket.IO
            this.emitToAdmins(logEntry);

            // Console log based on level
            this.consoleLog(logLevel, `[${logType}] ${message}`, details);

        } catch (error) {
            console.error('❌ ProfileLogger error:', error.message);
            // Still emit to Socket.IO even if DB fails
            this.emitToAdmins(logEntry);
        }

        return logEntry;
    }

    /**
     * Console output with color coding
     */
    static consoleLog(level, message, details) {
        const prefix = {
            debug: '🔍',
            info: 'ℹ️',
            warning: '⚠️',
            error: '❌',
            critical: '🚨'
        };

        const emoji = prefix[level] || 'ℹ️';
        console[level === 'error' || level === 'critical' ? 'error' : 'log'](`${emoji} ${message}`);

        if (details && level !== 'debug') {
            console.log('   Details:', JSON.stringify(details, null, 2));
        }
    }

    /**
     * Emit log to admin Socket.IO room
     */
    static emitToAdmins(logEntry) {
        if (io) {
            io.to('admin-logs').emit('new_log', logEntry);
        }
    }

    // ============================================
    // CONVENIENCE METHODS FOR SPECIFIC LOG TYPES
    // ============================================

    /**
     * Log connection events (QR, connect, disconnect, auth)
     */
    static async connection(clientId, event, details = null) {
        const eventInfo = {
            qr_generated: {
                message: 'QR code generated for scanning',
                explanation: 'The WhatsApp Web interface requested a new QR code. Open WhatsApp on your phone, go to Settings > Linked Devices > Link a Device, and scan this QR code.'
            },
            authenticated: {
                message: 'Successfully authenticated',
                explanation: 'The QR code was scanned successfully. WhatsApp is verifying the session with their servers.'
            },
            ready: {
                message: 'WhatsApp client is ready',
                explanation: 'The WhatsApp client is fully connected and ready to send/receive messages. The device is now operational.'
            },
            disconnected: {
                message: 'Client disconnected',
                explanation: this.getDisconnectExplanation(details?.reason)
            },
            auth_failure: {
                message: 'Authentication failed',
                explanation: 'The session authentication failed. This may happen if the phone was disconnected from the internet, the session was logged out from the phone, or WhatsApp detected unusual activity.'
            },
            loading: {
                message: 'Loading WhatsApp Web',
                explanation: 'WhatsApp Web is initializing. This typically takes a few seconds.'
            }
        };

        const info = eventInfo[event] || { message: event, explanation: 'Unknown connection event.' };
        const level = event === 'auth_failure' || event === 'disconnected' ? LOG_LEVELS.WARNING : LOG_LEVELS.INFO;
        return this.log(clientId, LOG_TYPES.CONNECTION, level, info.message, details, info.explanation);
    }

    /**
     * Get explanation for disconnect reasons
     */
    static getDisconnectExplanation(reason) {
        const reasonLower = (reason || '').toLowerCase();

        if (reasonLower === 'logout' || reasonLower.includes('logout')) {
            return 'The session was manually logged out from the phone (WhatsApp > Linked Devices > Log Out). This is a normal user action. Need to scan QR code again to reconnect.';
        }
        if (reasonLower.includes('banned')) {
            return '⚠️ CRITICAL: The phone number appears to be banned by WhatsApp. Contact WhatsApp support or use a different number.';
        }
        if (reasonLower.includes('spam')) {
            return '⚠️ WARNING: WhatsApp may have detected spam-like behavior. Reduce message frequency and ensure messages are not repetitive.';
        }
        if (reasonLower.includes('replaced')) {
            return 'Another session replaced this one. Someone else logged in from another browser/device.';
        }
        if (reasonLower.includes('network')) {
            return 'Network connectivity issue. Check internet connection on both the server and the phone.';
        }
        if (reasonLower.includes('conflict')) {
            return 'Session conflict detected. The phone may have been used to scan QR in another location.';
        }
        return `The client disconnected with reason: "${reason}". Check if the phone is connected to the internet and WhatsApp is running.`;
    }

    /**
     * Log successful message send
     */
    static async messageSent(clientId, recipient, messageId, messagePreview = null) {
        return this.log(clientId, LOG_TYPES.MESSAGE_SENT, LOG_LEVELS.INFO,
            `Message sent to ${recipient}`,
            { recipient, messageId, preview: messagePreview?.substring(0, 50) },
            `Message successfully sent via WhatsApp API and queued for delivery. MessageID: ${messageId}. The message will be marked as delivered when recipient's phone receives it.`
        );
    }

    /**
     * Log failed message send
     */
    static async messageFailed(clientId, recipient, error, attempt = 1) {
        const level = attempt >= 5 ? LOG_LEVELS.ERROR : LOG_LEVELS.WARNING;
        const errorMsg = error.message || error;

        let explanation = `Message failed on attempt ${attempt}. `;
        if (errorMsg.includes('not registered')) {
            explanation += 'The recipient is not registered on WhatsApp or the number format is incorrect.';
        } else if (errorMsg.includes('blocked')) {
            explanation += 'You may be blocked by this recipient, or the number has blocked unknown senders.';
        } else if (errorMsg.includes('timeout')) {
            explanation += 'Message sending timed out. Check network connectivity.';
        } else {
            explanation += `Error: ${errorMsg}. Will retry automatically if retries remain.`;
        }

        return this.log(clientId, LOG_TYPES.MESSAGE_FAILED, level,
            `Message to ${recipient} failed (attempt ${attempt})`,
            { recipient, error: errorMsg, attempt },
            explanation
        );
    }

    /**
     * Log message delivery confirmation
     */
    static async messageDelivered(clientId, recipient, messageId) {
        return this.log(clientId, LOG_TYPES.MESSAGE_DELIVERED, LOG_LEVELS.INFO,
            `Message delivered to ${recipient}`,
            { recipient, messageId },
            `The message was successfully delivered to the recipient's phone. They have not read it yet. WhatsApp confirmed delivery.`
        );
    }

    /**
     * Log message read confirmation
     */
    static async messageRead(clientId, recipient, messageId) {
        return this.log(clientId, LOG_TYPES.MESSAGE_READ, LOG_LEVELS.INFO,
            `Message read by ${recipient}`,
            { recipient, messageId },
            `The recipient opened the chat and read the message. Blue checkmarks (✓✓) are now showing.`
        );
    }

    /**
     * Log potential block detection
     */
    static async blockDetected(clientId, reason, evidence = null) {
        const explanation = `⚠️ BLOCK ALERT: ${reason}. This indicates WhatsApp may have flagged the account for suspicious activity. ` +
            `Recommended actions: 1) Reduce message frequency immediately, 2) Use more varied message content, ` +
            `3) Avoid sending to recipients who haven't replied, 4) Consider warming up the account for 24-48 hours.`;

        return this.log(clientId, LOG_TYPES.BLOCK_DETECTED, LOG_LEVELS.CRITICAL,
            `⚠️ POTENTIAL BLOCK DETECTED: ${reason}`,
            { reason, evidence, detectedAt: new Date().toISOString() },
            explanation
        );
    }

    /**
     * Log typing simulation events
     */
    static async typingSimulation(clientId, recipient, durationMs) {
        return this.log(clientId, LOG_TYPES.TYPING_SIMULATION, LOG_LEVELS.DEBUG,
            `Typing simulation for ${durationMs}ms`,
            { recipient, durationMs },
            `Simulated human typing behavior before sending message. This helps appear more natural to WhatsApp's anti-spam systems.`
        );
    }

    /**
     * Log session backup events
     */
    static async sessionBackup(clientId, event, sizeBytes = null) {
        const eventInfo = {
            save_started: {
                message: 'Session backup started',
                explanation: 'Starting to backup WhatsApp session to database for persistence.'
            },
            save_completed: {
                message: 'Session backup completed',
                explanation: `Session successfully saved to PostgreSQL database (${sizeBytes ? (sizeBytes / 1024).toFixed(1) + ' KB' : 'size unknown'}). The session will be restored automatically on next server restart.`
            },
            save_failed: {
                message: 'Session backup failed',
                explanation: '❌ Failed to save session! Check database connectivity. The session may be lost on server restart.'
            },
            restore_started: {
                message: 'Session restore started',
                explanation: 'Attempting to restore WhatsApp session from database.'
            },
            restore_completed: {
                message: 'Session restored from database',
                explanation: `Session successfully restored from PostgreSQL database (${sizeBytes ? (sizeBytes / 1024).toFixed(1) + ' KB' : 'size unknown'}). No QR scan needed.`
            },
            restore_failed: {
                message: 'Session restore failed',
                explanation: '❌ Failed to restore session from database. A new QR scan will be required.'
            }
        };

        const info = eventInfo[event] || { message: event, explanation: 'Unknown session event.' };
        const level = event.includes('failed') ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO;
        return this.log(clientId, LOG_TYPES.SESSION_BACKUP, level,
            info.message,
            { event, sizeBytes },
            info.explanation
        );
    }

    /**
     * Log rate limiting events
     */
    static async rateLimit(clientId, action, delayMs, reason = null) {
        return this.log(clientId, LOG_TYPES.RATE_LIMIT, LOG_LEVELS.INFO,
            `Rate limit: ${action} delayed by ${delayMs}ms`,
            { action, delayMs, reason },
            `Message sending was delayed to respect rate limits. This prevents account flagging. Trust level determines limits.`
        );
    }

    /**
     * Log warnings (suspicious patterns)
     */
    static async warning(clientId, message, details = null) {
        return this.log(clientId, LOG_TYPES.WARNING, LOG_LEVELS.WARNING, message, details,
            `A warning condition was detected. Review the details and take action if necessary.`
        );
    }

    /**
     * Log queue processing events
     */
    static async queueProcess(clientId, action, details = null) {
        return this.log(clientId, LOG_TYPES.QUEUE_PROCESS, LOG_LEVELS.INFO,
            `Queue: ${action}`,
            details
        );
    }

    /**
     * Log blacklist events
     */
    static async blacklist(clientId, action, phoneNumber, reason = null) {
        return this.log(clientId, LOG_TYPES.BLACKLIST, LOG_LEVELS.INFO,
            `Blacklist: ${action} - ${phoneNumber}`,
            { phoneNumber, reason }
        );
    }

    // ==================== NEW HELPER METHODS ====================

    /**
     * Log webhooks sent (outgoing notifications)
     */
    static async webhookSent(clientId, webhookUrl, eventType, recipientPhone = null) {
        return this.log(clientId, LOG_TYPES.WEBHOOK_SENT, LOG_LEVELS.INFO,
            `Webhook sent: ${eventType}${recipientPhone ? ` to ${recipientPhone}` : ''}`,
            { webhookUrl, eventType, recipientPhone }
        );
    }

    /**
     * Log incoming message webhooks
     */
    static async webhookIncoming(clientId, from, messageType, webhookUrl = null) {
        return this.log(clientId, LOG_TYPES.WEBHOOK_INCOMING, LOG_LEVELS.INFO,
            `Incoming message from ${from} (${messageType})`,
            { from, messageType, webhookUrl }
        );
    }

    /**
     * Log received messages
     */
    static async messageReceived(clientId, from, messageType, hasMedia = false) {
        return this.log(clientId, LOG_TYPES.MESSAGE_RECEIVED, LOG_LEVELS.INFO,
            `Message received from ${from} (${messageType})`,
            { from, messageType, hasMedia }
        );
    }

    /**
     * Log batch creation
     */
    static async batchCreated(clientId, batchId, messageCount, scheduledAt = null) {
        return this.log(clientId, LOG_TYPES.BATCH_CREATED, LOG_LEVELS.INFO,
            `Batch created: ${batchId} (${messageCount} messages)`,
            { batchId, messageCount, scheduledAt }
        );
    }

    /**
     * Log batch completion
     */
    static async batchCompleted(clientId, batchId, stats) {
        return this.log(clientId, LOG_TYPES.BATCH_COMPLETED, LOG_LEVELS.INFO,
            `Batch completed: ${batchId} - Sent: ${stats.sent}, Failed: ${stats.failed}`,
            { batchId, ...stats }
        );
    }

    /**
     * Log auto-reply sent
     */
    static async autoReply(clientId, recipient, triggerKeyword, replyMessage) {
        return this.log(clientId, LOG_TYPES.AUTO_REPLY, LOG_LEVELS.INFO,
            `Auto-reply sent to ${recipient}`,
            { recipient, triggerKeyword, replyPreview: replyMessage.substring(0, 50) }
        );
    }

    /**
     * Log customer replied (for read-no-reply tracking)
     */
    static async customerReplied(clientId, customerPhone, messagesMarked) {
        return this.log(clientId, LOG_TYPES.CUSTOMER_REPLIED, LOG_LEVELS.INFO,
            `Customer ${customerPhone} replied - ${messagesMarked} messages marked`,
            { customerPhone, messagesMarked }
        );
    }

    /**
     * Log media download
     */
    static async mediaDownloaded(clientId, mediaType, filename, sizeBytes = null) {
        return this.log(clientId, LOG_TYPES.MEDIA_DOWNLOAD, LOG_LEVELS.INFO,
            `Media downloaded: ${mediaType} - ${filename}`,
            { mediaType, filename, sizeBytes }
        );
    }

    /**
     * Log session restore
     */
    static async sessionRestored(clientId, deviceName, phoneNumber) {
        return this.log(clientId, LOG_TYPES.SESSION_RESTORE, LOG_LEVELS.INFO,
            `Session restored: ${deviceName} (${phoneNumber})`,
            { deviceName, phoneNumber }
        );
    }

    /**
     * Log API calls
     */
    static async apiCall(clientId, endpoint, method, statusCode = null, requestId = null) {
        const level = statusCode >= 400 ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO;
        return this.log(clientId, LOG_TYPES.API_CALL, level,
            `API ${method} ${endpoint}${statusCode ? ` - ${statusCode}` : ''}`,
            { endpoint, method, statusCode, requestId }
        );
    }

    /**
     * Log general errors
     */
    static async error(clientId, errorMessage, errorDetails = null, source = null) {
        return this.log(clientId, LOG_TYPES.ERROR, LOG_LEVELS.ERROR,
            `Error${source ? ` in ${source}` : ''}: ${errorMessage}`,
            { errorMessage, errorDetails, source }
        );
    }

    // ==================== SESSION & CLIENT LIFECYCLE METHODS ====================

    /**
     * Log client initialization
     */
    static async clientInit(clientId, event, details = null) {
        const events = {
            start: { message: 'Starting client initialization', level: LOG_LEVELS.INFO },
            creating_store: { message: 'Creating PostgresStore for session', level: LOG_LEVELS.INFO },
            puppeteer_launch: { message: 'Launching Puppeteer browser', level: LOG_LEVELS.INFO },
            initialized: { message: 'Client initialized successfully', level: LOG_LEVELS.INFO },
            failed: { message: 'Client initialization failed', level: LOG_LEVELS.ERROR },
            retry: { message: 'Retrying client initialization', level: LOG_LEVELS.WARNING }
        };
        const { message, level } = events[event] || { message: event, level: LOG_LEVELS.INFO };
        return this.log(clientId, LOG_TYPES.CLIENT_INIT, level, message, details);
    }

    /**
     * Log client destruction
     */
    static async clientDestroy(clientId, reason, details = null) {
        return this.log(clientId, LOG_TYPES.CLIENT_DESTROY, LOG_LEVELS.INFO,
            `Client destroyed: ${reason}`,
            { reason, ...details }
        );
    }

    /**
     * Log session existence check
     */
    static async sessionCheck(clientId, sessionId, exists, sizeBytes = null) {
        return this.log(clientId, LOG_TYPES.SESSION_CHECK, LOG_LEVELS.INFO,
            `Session check: ${sessionId} - ${exists ? 'EXISTS' : 'NOT FOUND'}${sizeBytes ? ` (${(sizeBytes / 1024).toFixed(1)} KB)` : ''}`,
            { sessionId, exists, sizeBytes }
        );
    }

    /**
     * Log session save operation
     */
    static async sessionSave(clientId, sessionId, event, sizeBytes = null, details = null) {
        const events = {
            started: { message: `Session save started: ${sessionId}`, level: LOG_LEVELS.INFO },
            completed: { message: `Session saved: ${sessionId} (${sizeBytes ? (sizeBytes / 1024).toFixed(1) + ' KB' : 'size unknown'})`, level: LOG_LEVELS.INFO },
            skipped_small: { message: `Session save skipped - file too small (${sizeBytes} bytes)`, level: LOG_LEVELS.WARNING },
            failed: { message: `Session save failed: ${sessionId}`, level: LOG_LEVELS.ERROR }
        };
        const { message, level } = events[event] || { message: event, level: LOG_LEVELS.INFO };
        return this.log(clientId, LOG_TYPES.SESSION_SAVE, level, message, { sessionId, sizeBytes, ...details });
    }

    /**
     * Log session extract/restore operation
     */
    static async sessionExtract(clientId, sessionId, event, sizeBytes = null, details = null) {
        const events = {
            started: { message: `Session extract started: ${sessionId}`, level: LOG_LEVELS.INFO },
            completed: { message: `Session extracted: ${sessionId} (${sizeBytes ? (sizeBytes / 1024).toFixed(1) + ' KB' : 'size unknown'})`, level: LOG_LEVELS.INFO },
            not_found: { message: `Session not found in database: ${sessionId}`, level: LOG_LEVELS.WARNING },
            failed: { message: `Session extract failed: ${sessionId}`, level: LOG_LEVELS.ERROR }
        };
        const { message, level } = events[event] || { message: event, level: LOG_LEVELS.INFO };
        return this.log(clientId, LOG_TYPES.SESSION_EXTRACT, level, message, { sessionId, sizeBytes, ...details });
    }

    /**
     * Log auto-restore operations
     */
    static async autoRestore(clientId, event, details = null) {
        const events = {
            scan_start: { message: 'Scanning database for sessions to restore', level: LOG_LEVELS.INFO },
            found_sessions: { message: `Found ${details?.count || 0} session(s) to restore`, level: LOG_LEVELS.INFO },
            no_sessions: { message: 'No sessions found in database', level: LOG_LEVELS.INFO },
            restoring: { message: `Restoring session for profile ${clientId}`, level: LOG_LEVELS.INFO },
            restored: { message: `Session restored successfully for profile ${clientId}`, level: LOG_LEVELS.INFO },
            skipped: { message: `Skipped restore - ${details?.reason || 'unknown reason'}`, level: LOG_LEVELS.WARNING },
            failed: { message: `Auto-restore failed: ${details?.error || 'unknown error'}`, level: LOG_LEVELS.ERROR },
            complete: { message: 'Auto-restore process complete', level: LOG_LEVELS.INFO }
        };
        const { message, level } = events[event] || { message: event, level: LOG_LEVELS.INFO };
        return this.log(clientId, LOG_TYPES.AUTO_RESTORE, level, message, details);
    }

    /**
     * Analyze patterns for block detection
     */
    static async analyzeForBlocks(clientId) {
        try {
            // Check for high failure rate in last hour
            const result = await pool.query(`
                SELECT 
                    COUNT(*) FILTER (WHERE log_type = 'message_failed') as failures,
                    COUNT(*) FILTER (WHERE log_type = 'message_sent') as successes
                FROM profile_logs
                WHERE client_id = $1
                AND created_at > NOW() - INTERVAL '1 hour'
            `, [clientId]);

            const { failures, successes } = result.rows[0];
            const total = parseInt(failures) + parseInt(successes);

            if (total >= 10) {
                const failureRate = parseInt(failures) / total;
                if (failureRate > 0.3) {
                    await this.blockDetected(clientId,
                        `High failure rate detected: ${Math.round(failureRate * 100)}%`,
                        { failures, successes, failureRate, timeWindow: '1 hour' }
                    );
                    return true;
                }
            }

            // Check for specific error patterns
            const errorPatterns = await pool.query(`
                SELECT details->>'error' as error, COUNT(*) as count
                FROM profile_logs
                WHERE client_id = $1
                AND log_type = 'message_failed'
                AND created_at > NOW() - INTERVAL '30 minutes'
                GROUP BY details->>'error'
                HAVING COUNT(*) >= 5
            `, [clientId]);

            for (const row of errorPatterns.rows) {
                if (row.error && (
                    row.error.includes('blocked') ||
                    row.error.includes('spam') ||
                    row.error.includes('not registered'))
                ) {
                    await this.blockDetected(clientId,
                        `Suspicious error pattern: "${row.error}" occurred ${row.count} times`,
                        { error: row.error, count: row.count, timeWindow: '30 minutes' }
                    );
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error('Error analyzing for blocks:', error.message);
            return false;
        }
    }

    /**
     * Get recent logs for a client
     */
    static async getRecentLogs(clientId = null, limit = 100, offset = 0, filters = {}) {
        let query = 'SELECT * FROM profile_logs WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        if (clientId) {
            query += ` AND client_id = $${paramIndex++}`;
            params.push(clientId);
        }

        if (filters.logType) {
            query += ` AND log_type = $${paramIndex++}`;
            params.push(filters.logType);
        }

        if (filters.logLevel) {
            query += ` AND log_level = $${paramIndex++}`;
            params.push(filters.logLevel);
        }

        if (filters.since) {
            query += ` AND created_at >= $${paramIndex++}`;
            params.push(filters.since);
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Get log statistics
     */
    static async getStats(clientId = null, timeWindow = '24 hours') {
        let whereClause = `WHERE created_at > NOW() - INTERVAL '${timeWindow}'`;
        const params = [];

        if (clientId) {
            whereClause += ' AND client_id = $1';
            params.push(clientId);
        }

        const result = await pool.query(`
            SELECT 
                log_type,
                log_level,
                COUNT(*) as count
            FROM profile_logs
            ${whereClause}
            GROUP BY log_type, log_level
            ORDER BY count DESC
        `, params);

        return result.rows;
    }
}

// Export constants with the class
ProfileLogger.LOG_TYPES = LOG_TYPES;
ProfileLogger.LOG_LEVELS = LOG_LEVELS;

module.exports = ProfileLogger;
