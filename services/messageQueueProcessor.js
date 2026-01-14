/**
 * Message Queue Processor Service
 * Processes queued messages with typing simulation and stochastic delays
 */

const ApiMessageQueue = require('../models/ApiMessageQueue');
const Blacklist = require('../models/Blacklist');
const whatsappManager = require('../whatsapp-manager');
const ProfileLogger = require('./ProfileLogger');

let isProcessing = false;
let processInterval = null;
let io = null;

/**
 * Set Socket.IO instance for real-time updates
 */
function setSocketIO(socketIO) {
    io = socketIO;
}

/**
 * Emit queue update to clients
 */
function emitQueueUpdate(message) {
    if (io) {
        io.emit('queue_update', message);
    }
}

/**
 * Simulate typing before sending (human-like behavior)
 * @param {number} deviceId - Device ID
 * @param {string} chatId - Chat ID
 * @param {string} messageContent - Actual message content for duration calc
 */
async function simulateTyping(deviceId, chatId, messageContent) {
    const trustLevelConfig = require('./trustLevelConfig');
    try {
        const client = whatsappManager.getClient(deviceId);
        if (!client) return;

        const chat = await client.getChatById(chatId);
        if (!chat) return;

        // Mark as seen
        await chat.sendSeen();

        // Start typing
        await chat.sendStateTyping();

        // Wait based on message content (realistic human typing speed)
        const typingDuration = trustLevelConfig.getTypingDuration(messageContent || '');
        console.log(`⌨️ Bulk: Simulating typing for ${typingDuration}ms (${(messageContent || '').length} chars)`);
        await new Promise(resolve => setTimeout(resolve, typingDuration));

        // Clear typing state
        await chat.clearState();
    } catch (error) {
        console.error('Typing simulation error:', error.message);
    }
}

/**
 * Process a single queued message with retry logic (max 10 attempts)
 */
async function processMessage(queueItem) {
    const isGroup = queueItem.recipient.endsWith('@g.us');
    const chatId = (isGroup || queueItem.recipient.endsWith('@c.us'))
        ? queueItem.recipient
        : `${queueItem.recipient}@c.us`;

    const MAX_RETRIES = 10;
    const currentRetry = (queueItem.retry_count || 0) + 1;

    try {
        // Update status to sending
        await ApiMessageQueue.updateStatus(queueItem.id, 'sending');
        emitQueueUpdate({ id: queueItem.id, status: 'sending' });

        // Check if still blacklisted
        const isBlacklisted = await Blacklist.isBlacklisted(queueItem.device_id, queueItem.recipient);
        if (isBlacklisted) {
            await ApiMessageQueue.updateStatus(queueItem.id, 'failed', {
                error_message: 'Recipient is blacklisted'
            });
            emitQueueUpdate({ id: queueItem.id, status: 'failed', error: 'Blacklisted' });
            return;
        }

        const client = whatsappManager.getClient(queueItem.device_id);
        if (!client) {
            throw new Error('WhatsApp client not available for this device');
        }

        // Check if number is registered (SKIP FOR GROUPS)
        if (!isGroup) {
            const isRegistered = await client.isRegisteredUser(chatId);
            if (!isRegistered) {
                await ApiMessageQueue.updateStatus(queueItem.id, 'failed', {
                    error_message: 'Number not registered on WhatsApp'
                });
                await checkBatchProgress(queueItem);
                emitQueueUpdate({ id: queueItem.id, status: 'failed', error: 'Not registered' });
                return;
            }
        }

        // Simulate typing (human-like behavior)
        const messageContent = queueItem.resolved_content || queueItem.original_content;
        await simulateTyping(queueItem.device_id, chatId, messageContent);

        // Send the message
        let result;
        if (queueItem.message_type === 'text') {
            result = await client.sendMessage(chatId, messageContent);
        } else {
            // Handle media types (future extension)
            result = await client.sendMessage(chatId, messageContent);
        }

        // Update with success
        await ApiMessageQueue.updateStatus(queueItem.id, 'sent', {
            whatsapp_message_id: result.id._serialized,
            ack_level: 1
        });

        await checkBatchProgress(queueItem);

        emitQueueUpdate({
            id: queueItem.id,
            status: 'sent',
            whatsapp_message_id: result.id._serialized
        });

        console.log(`✅ Queue message sent: ${queueItem.id} -> ${queueItem.recipient}`);

        // Log successful send
        await ProfileLogger.messageSent(
            queueItem.device_id,
            queueItem.recipient,
            result.id._serialized,
            messageContent
        );

    } catch (error) {
        console.error(`❌ Queue message attempt ${currentRetry}/${MAX_RETRIES} failed: ${queueItem.id}`, error.message);

        // Log failed attempt
        await ProfileLogger.messageFailed(
            queueItem.device_id,
            queueItem.recipient,
            error,
            currentRetry
        );

        // Check for block-related errors
        const blockIndicators = ['blocked', 'spam', 'banned', 'not registered', 'invalid'];
        const isBlockIndicator = blockIndicators.some(indicator =>
            error.message.toLowerCase().includes(indicator)
        );

        if (isBlockIndicator) {
            await ProfileLogger.blockDetected(
                queueItem.device_id,
                `Suspicious error while sending: ${error.message}`,
                { recipient: queueItem.recipient, error: error.message, attempt: currentRetry }
            );
        }

        // Run block analysis after multiple failures
        if (currentRetry >= 3) {
            await ProfileLogger.analyzeForBlocks(queueItem.device_id);
        }

        if (currentRetry >= MAX_RETRIES) {
            // Max retries reached - mark as failed
            await ApiMessageQueue.updateStatus(queueItem.id, 'failed', {
                error_message: `Failed after ${MAX_RETRIES} attempts: ${error.message}`
            });
            await checkBatchProgress(queueItem);
            emitQueueUpdate({ id: queueItem.id, status: 'failed', error: error.message });
            console.log(`❌ Message ${queueItem.id} permanently failed after ${MAX_RETRIES} attempts`);
        } else {
            // Still has retries left - mark as pending and schedule retry
            const { pool } = require('../config/database');
            // Schedule retry with exponential backoff (30s, 60s, 90s, etc.)
            const delaySeconds = 30 * currentRetry;
            await pool.query(`
                UPDATE api_message_queue 
                SET status = 'pending', 
                retry_count = $1,
                error_message = $2,
                scheduled_at = (NOW() AT TIME ZONE 'Africa/Cairo') + INTERVAL '${delaySeconds} seconds'
                WHERE id = $3
            `, [currentRetry, error.message, queueItem.id]);

            emitQueueUpdate({ id: queueItem.id, status: 'pending', retry: currentRetry });
            console.log(`🔄 Message ${queueItem.id} scheduled for retry ${currentRetry}/${MAX_RETRIES} in ${delaySeconds}s`);
        }
    }
}

/**
 * Process next message in queue
 */
async function processNext() {
    if (isProcessing) return;

    try {
        // Check if any WhatsApp client is ready (using whatsappManager)
        const allStatus = whatsappManager.getAllStatus();
        const hasConnectedProfile = Object.values(allStatus).some(s => s.connected || s.status === 'ready' || s.status === 'connected');

        if (!hasConnectedProfile) {
            // No connected profiles, skip this cycle
            return;
        }

        isProcessing = true;

        const nextMessage = await ApiMessageQueue.getNextToSend();

        if (nextMessage) {
            console.log(`📨 Processing queue message ${nextMessage.id} for ${nextMessage.recipient}`);
            await processMessage(nextMessage);
        }

    } catch (error) {
        console.error('Queue processor error:', error.message);
    } finally {
        isProcessing = false;
    }
}

/**
 * Start the queue processor
 */
function start(intervalMs = 5000) {
    if (processInterval) {
        console.log('⚠️ Queue processor already running');
        return;
    }

    console.log('🚀 Starting message queue processor...');

    // Process immediately then at interval
    processNext();
    processInterval = setInterval(processNext, intervalMs);
}

/**
 * Stop the queue processor
 */
function stop() {
    if (processInterval) {
        clearInterval(processInterval);
        processInterval = null;
        console.log('🛑 Queue processor stopped');
    }
}

/**
 * Get queue status
 */
async function getStatus() {
    const stats = await ApiMessageQueue.getStats();
    const pending = await ApiMessageQueue.getPendingCount();

    return {
        isRunning: !!processInterval,
        isProcessing,
        pendingCount: pending,
        stats
    };
}

module.exports = {
    setSocketIO,
    start,
    stop,
    getStatus,
    processNext
};

/**
 * Check and log batch progress
 */
async function checkBatchProgress(queueItem) {
    if (queueItem.batch_id) {
        try {
            const stats = await ApiMessageQueue.getBatchStats(queueItem.batch_id);

            // Log completion if no messages remaining
            if (stats.remaining === 0) {
                await ProfileLogger.batchCompleted(queueItem.device_id, queueItem.batch_id, {
                    sent: stats.sent,
                    failed: stats.failed,
                    total: stats.total
                });
            }
            // Log progress periodically (every 10 messages)
            else if (stats.sent > 0 && stats.sent % 10 === 0) {
                await ProfileLogger.log(queueItem.device_id, 'batch_progress', 'info',
                    `Batch ${queueItem.batch_id} progress: ${stats.sent}/${stats.total} sent`,
                    stats
                );
            }
        } catch (err) {
            console.error('Error logging batch progress:', err);
        }
    }
}
