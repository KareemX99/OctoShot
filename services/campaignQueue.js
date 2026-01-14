/**
 * Campaign Queue Service
 * Manages pg-boss job queue for campaign message scheduling
 */

const { PgBoss } = require('pg-boss');
const { pool } = require('../config/database');
const { DateTime } = require('luxon');
const Campaign = require('../models/Campaign');
const whatsappManager = require('../whatsapp-manager');
const ProfileLogger = require('./ProfileLogger');
const trustLevelConfig = require('./trustLevelConfig');

// Queue names
const CAMPAIGN_QUEUE = 'campaign-step';
const WHATSAPP_SEND_QUEUE = 'whatsapp-campaign-send';

let boss = null;
let io = null;

class CampaignQueue {
    /**
     * Initialize pg-boss with existing database connection
     */
    static async start(socketIO = null) {
        io = socketIO;

        // Use same database config as existing pool with SSL disabled for certificate
        boss = new PgBoss({
            host: process.env.DATABASE_HOST,
            port: parseInt(process.env.DATABASE_PORT) || 5432,
            database: process.env.DATABASE_NAME,
            user: process.env.DATABASE_USER,
            password: process.env.DATABASE_PASSWORD,
            ssl: {
                rejectUnauthorized: false
            },
            retryLimit: 3,
            retryDelay: 30,
            retryBackoff: true,
            expireInHours: 24,
            archiveCompletedAfterSeconds: 3600
        });

        boss.on('error', error => {
            console.error('🚨 pg-boss error:', error.message);
            ProfileLogger.error(null, `pg-boss error: ${error.message}`, { stack: error.stack }, 'campaign_queue');
        });

        await boss.start();
        console.log('📬 Campaign Queue (pg-boss) started');

        // Register workers
        await this.registerWorkers();

        return boss;
    }

    /**
     * Register queue workers
     */
    static async registerWorkers() {
        // Create queues first (pg-boss requires this)
        await boss.createQueue(CAMPAIGN_QUEUE);
        await boss.createQueue(WHATSAPP_SEND_QUEUE);
        console.log('📋 Campaign queues created');

        // Campaign step processor - handles business logic, scheduling
        // Note: pg-boss v12+ passes jobs as array when using teamConcurrency
        await boss.work(CAMPAIGN_QUEUE, { teamConcurrency: 5 }, async (jobs) => {
            // Ensure jobs is an array
            const jobArray = Array.isArray(jobs) ? jobs : [jobs];

            for (const job of jobArray) {
                try {
                    await this.processCampaignStep(job);
                } catch (error) {
                    console.error(`❌ Campaign step error for job ${job?.id}:`, error.message);
                    throw error; // pg-boss will retry
                }
            }
        });

        // WhatsApp sender - actually sends messages (concurrency: 1 per device)
        await boss.work(WHATSAPP_SEND_QUEUE, { teamConcurrency: 1 }, async (jobs) => {
            const jobArray = Array.isArray(jobs) ? jobs : [jobs];

            for (const job of jobArray) {
                try {
                    await this.processWhatsAppSend(job);
                } catch (error) {
                    console.error(`❌ WhatsApp send error for job ${job?.id}:`, error.message);
                    throw error;
                }
            }
        });

        console.log('👷 Campaign workers registered');
    }

    /**
     * Queue a campaign step for processing
     */
    static async queueStep(enrollmentId, stepNumber, campaignId, deviceId, startAfter = null) {
        const options = {
            retryLimit: 3,
            // SINGLETON KEY: Prevents duplicate jobs for same enrollment + step
            singletonKey: `campaign-step-${enrollmentId}-${stepNumber}`
        };
        if (startAfter) {
            options.startAfter = startAfter;
        }

        const jobId = await boss.send(CAMPAIGN_QUEUE, {
            enrollmentId,
            stepNumber,
            campaignId,
            deviceId
        }, options);

        console.log(`📤 Queued step ${stepNumber} for enrollment ${enrollmentId} (job: ${jobId})`);
        return jobId;
    }

    /**
     * Queue a single enrollment for retry (after failure)
     */
    static async queueSingleEnrollment(campaignId, enrollmentId) {
        const campaign = await Campaign.getById(campaignId);
        if (!campaign) throw new Error('Campaign not found');

        const enrollment = await Campaign.getEnrollmentById(enrollmentId);
        if (!enrollment) throw new Error('Enrollment not found');

        // Get device from enrollment or fallback to campaign device
        const deviceId = enrollment.assigned_device_id || campaign.device_id;

        console.log(`🔄 Retrying enrollment ${enrollmentId} on device ${deviceId}`);

        // Queue step 1 with a small delay
        const startAfter = new Date(Date.now() + 5000); // 5 second delay
        await this.queueStep(enrollmentId, 1, campaignId, deviceId, startAfter);

        return { success: true };
    }

    /**
     * Process a campaign step (Recursive Step Pattern)
     */
    static async processCampaignStep(job) {
        // Guard against stale/invalid jobs
        if (!job || !job.data) {
            console.log('⚠️ Invalid job or job.data is undefined, skipping');
            return;
        }

        const { enrollmentId, stepNumber, campaignId, deviceId } = job.data;
        console.log(`⚙️ Processing step ${stepNumber} for enrollment ${enrollmentId}`);

        // 1. Get enrollment and campaign
        const enrollment = await Campaign.getEnrollmentById(enrollmentId);
        if (!enrollment) {
            console.log(`⚠️ Enrollment ${enrollmentId} not found, skipping`);
            return;
        }

        // 2. IDEMPOTENCY CHECK - skip if already processed
        if (enrollment.status !== 'active' && enrollment.status !== 'pending') {
            console.log(`⏭️ Enrollment ${enrollmentId} not active (${enrollment.status}), skipping`);
            return;
        }
        if (enrollment.current_step >= stepNumber) {
            console.log(`⏭️ Step ${stepNumber} already processed for enrollment ${enrollmentId}`);
            return;
        }

        // 3. Get campaign info
        const campaign = await Campaign.getById(campaignId);
        if (!campaign || campaign.status !== 'running') {
            console.log(`⏭️ Campaign ${campaignId} not running (${campaign?.status}), skipping`);
            if (enrollment.status === 'pending') {
                await Campaign.updateEnrollmentStatus(enrollmentId, 'paused');
            }
            return;
        }

        // 4. CHECK BLACKLIST
        const isBlacklisted = await this.checkBlacklist(deviceId, enrollment.recipient);
        if (isBlacklisted) {
            console.log(`🚫 Recipient ${enrollment.recipient} is blacklisted`);
            await Campaign.updateEnrollmentStatus(enrollmentId, 'opted_out');
            await this.emitProgress(campaignId);
            return;
        }

        // 5. BUSINESS HOURS CHECK
        if (!this.isWithinBusinessHours(campaign)) {
            const nextSlot = this.calculateNextBusinessHour(campaign);
            console.log(`🕐 Outside business hours, rescheduling to ${nextSlot}`);
            await this.queueStep(enrollmentId, stepNumber, campaignId, deviceId, nextSlot);
            return;
        }

        // 6. Get step content
        const step = await Campaign.getStepByOrder(campaignId, stepNumber);
        if (!step) {
            console.log(`⚠️ Step ${stepNumber} not found for campaign ${campaignId}`);
            await Campaign.updateEnrollmentStatus(enrollmentId, 'completed');
            return;
        }

        // 7. Process content (spintax, variables)
        let content = step.content || '';
        if (step.use_spintax) {
            content = this.parseSpintax(content);
        }
        content = this.replaceVariables(content, enrollment.attributes || {}, enrollment);

        // 8. Queue for WhatsApp sending (with small delay for typing simulation)
        const delayMs = this.calculateRandomDelay(campaign);
        const startAfter = new Date(Date.now() + delayMs);

        await boss.send(WHATSAPP_SEND_QUEUE, {
            enrollmentId,
            stepNumber,
            campaignId,
            deviceId,
            recipient: enrollment.recipient,
            messageType: step.message_type,
            content,
            mediaUrl: step.media_url,
            filename: step.filename
        }, {
            startAfter,
            retryLimit: 2,
            singletonKey: `send-${enrollmentId}-${stepNumber}` // Prevent duplicate sends
        });

        // 9. Update enrollment state
        await Campaign.updateEnrollmentStep(enrollmentId, stepNumber, job.id);

        // 10. Log to ProfileLogger
        await ProfileLogger.log(deviceId, 'queue_process', 'info',
            `Campaign step ${stepNumber} queued for ${enrollment.recipient}`,
            { campaignId, enrollmentId, stepNumber }
        );

        // 11. Emit real-time update
        await this.emitProgress(campaignId);
    }

    /**
     * Actually send the WhatsApp message
     */
    static async processWhatsAppSend(job) {
        // Guard against stale/invalid jobs
        if (!job || !job.data) {
            console.log('⚠️ Invalid WhatsApp send job, skipping');
            return;
        }

        const { enrollmentId, stepNumber, campaignId, deviceId, recipient, messageType, content, mediaUrl, filename } = job.data;

        // IDEMPOTENCY CHECK: Skip if enrollment is already completed or step was already sent
        const enrollment = await Campaign.getEnrollmentById(enrollmentId);
        if (!enrollment) {
            console.log(`⚠️ Enrollment ${enrollmentId} not found, skipping send`);
            return;
        }
        if (enrollment.status === 'completed') {
            console.log(`⚠️ Enrollment ${enrollmentId} already completed, skipping duplicate send`);
            return;
        }

        const currentStep = enrollment.current_step || 0;

        // Check if this step was already sent (current_step > stepNumber means this step completed)
        // Note: current_step is set when step is queued, so skip only if GREATER than this step
        if (currentStep > stepNumber) {
            console.log(`⚠️ Step ${stepNumber} already sent (current: ${currentStep}), skipping`);
            return;
        }

        // STRICT ORDER CHECK: Step N can only run if step N-1 was completed
        if (stepNumber > 1 && currentStep < stepNumber - 1) {
            // Previous step not completed yet - reschedule this step
            console.log(`⏸️ Step ${stepNumber} waiting for step ${stepNumber - 1} (current: ${currentStep}), rescheduling...`);
            const delayMs = 5000; // Wait 5 seconds and retry
            await boss.send(WHATSAPP_SEND_QUEUE, job.data, {
                startAfter: new Date(Date.now() + delayMs),
                singletonKey: `step-${enrollmentId}-${stepNumber}` // Prevent duplicates
            });
            return;
        }

        console.log(`📱 Sending ${messageType} to ${recipient} (step ${stepNumber})`);

        try {
            // Get WhatsApp client
            const clientData = whatsappManager.clients.get(deviceId);
            if (!clientData || !clientData.connected) {
                throw new Error(`Device ${deviceId} not connected`);
            }

            const client = clientData.client;
            const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;
            const isGroup = chatId.endsWith('@g.us');

            // Check if number is registered on WhatsApp (skip for groups)
            if (!isGroup) {
                try {
                    const isRegistered = await client.isRegisteredUser(chatId);
                    if (!isRegistered) {
                        console.log(`❌ ${recipient} is NOT registered on WhatsApp`);

                        await Campaign.logMessageFailed(enrollmentId, stepNumber, 'الرقم غير مسجل على الواتساب');
                        await Campaign.incrementFailedCount(campaignId);
                        await Campaign.updateEnrollmentStatus(enrollmentId, 'failed');

                        await ProfileLogger.log(deviceId, 'not_registered', 'warning',
                            `Number not registered on WhatsApp: ${recipient}`,
                            { campaignId, enrollmentId, recipient }
                        );

                        // FOR SEQUENTIAL CAMPAIGNS: Queue next customer immediately
                        const campaign = await Campaign.getById(campaignId);
                        const steps = await Campaign.getSteps(campaignId);
                        if (campaign.type === 'sequential' && steps.length > 1) {
                            const nextEnrollment = await Campaign.getNextPendingEnrollment(campaignId, deviceId);
                            if (nextEnrollment) {
                                const delayMs = await this.calculateRandomDelayForDevice(deviceId);
                                const startAfter = new Date(Date.now() + delayMs);

                                await Campaign.updateEnrollmentStatus(nextEnrollment.id, 'active');
                                await this.queueStep(nextEnrollment.id, 1, campaignId, deviceId, startAfter);
                                console.log(`➡️ Skipping to next customer ${nextEnrollment.recipient} (after ${Math.round(delayMs / 1000)}s)`);
                            } else {
                                console.log(`✅ No more pending customers for device ${deviceId}`);
                            }
                        }

                        await this.emitProgress(campaignId);
                        return; // Don't throw - this is expected, not an error
                    }
                } catch (regError) {
                    console.log(`⚠️ Could not verify registration: ${regError.message}`);
                    // Continue anyway - may still work
                }
            }

            let sentMessage;

            // Simulate typing before sending (realistic human behavior)
            try {
                const chat = await client.getChatById(chatId);
                if (chat) {
                    await chat.sendSeen();
                    await chat.sendStateTyping();
                    const typingDuration = trustLevelConfig.getTypingDuration(content);
                    console.log(`⌨️ Campaign: Simulating typing for ${typingDuration}ms (${(content || '').length} chars)`);
                    await new Promise(resolve => setTimeout(resolve, typingDuration));
                    await chat.clearState();
                }
            } catch (typingError) {
                console.log(`⚠️ Could not simulate typing: ${typingError.message}`);
            }

            // Send based on message type
            if (messageType === 'text' || !mediaUrl) {
                sentMessage = await client.sendMessage(chatId, content);
            } else {
                // Media message
                const { MessageMedia } = require('whatsapp-web.js');
                const media = await MessageMedia.fromUrl(mediaUrl);
                sentMessage = await client.sendMessage(chatId, media, { caption: content });
            }

            // Log success
            await Campaign.logMessageSent(enrollmentId, stepNumber, sentMessage.id._serialized);
            await Campaign.incrementSentCount(campaignId);

            await ProfileLogger.messageSent(deviceId, recipient, sentMessage.id._serialized, content?.substring(0, 50));

            console.log(`✅ Message sent to ${recipient} (${sentMessage.id._serialized})`);

            // Check if this was the last step
            const campaign = await Campaign.getById(campaignId);
            const steps = await Campaign.getSteps(campaignId);
            const nextStepNumber = stepNumber + 1;
            const nextStep = steps.find(s => s.step_order === nextStepNumber);

            if (nextStep) {
                // Schedule next step - use 20 seconds for sequential campaigns
                // (messages go to same customer in quick succession)
                const delayMs = 20 * 1000; // Fixed 20 seconds between steps to same customer
                const startAfter = new Date(Date.now() + delayMs);

                console.log(`⏰ Scheduling step ${nextStepNumber} after 20s (sequential)`);
                await this.queueStep(enrollmentId, nextStepNumber, campaignId, deviceId, startAfter);
            } else {
                // Campaign completed for this recipient
                await Campaign.updateEnrollmentStatus(enrollmentId, 'completed');
                console.log(`🎉 Campaign completed for ${recipient}`);

                // FOR SEQUENTIAL CAMPAIGNS: Queue next customer after current one finishes all steps
                if (campaign.type === 'sequential' && steps.length > 1) {
                    const nextEnrollment = await Campaign.getNextPendingEnrollment(campaignId, deviceId);
                    if (nextEnrollment) {
                        // Calculate delay before next customer (trust level based)
                        const delayMs = await this.calculateRandomDelayForDevice(deviceId);
                        const startAfter = new Date(Date.now() + delayMs);

                        await Campaign.updateEnrollmentStatus(nextEnrollment.id, 'active');
                        await this.queueStep(nextEnrollment.id, 1, campaignId, deviceId, startAfter);
                        console.log(`➡️ Queuing next customer ${nextEnrollment.recipient} (after ${Math.round(delayMs / 1000)}s)`);
                    } else {
                        console.log(`✅ No more pending customers for device ${deviceId}`);
                    }
                }
            }

            // Emit progress
            await this.emitProgress(campaignId);

        } catch (error) {
            console.error(`❌ Failed to send to ${recipient}:`, error.message);

            await Campaign.logMessageFailed(enrollmentId, stepNumber, error.message);
            await Campaign.incrementFailedCount(campaignId);
            await Campaign.updateEnrollmentStatus(enrollmentId, 'failed');

            await ProfileLogger.messageFailed(deviceId, recipient, error, job.retryCount || 0);
            await this.emitProgress(campaignId);

            throw error; // Let pg-boss handle retry
        }
    }

    /**
     * Start a campaign - smart tiered distribution based on recipient count
     * Uses Min(Trust Limit, Usage Limit) for safety
     * Supports multi-profile round-robin distribution
     * Each device has its OWN daily limit (not shared)
     */
    static async startCampaign(campaignId) {
        const campaign = await Campaign.getById(campaignId);
        if (!campaign) throw new Error('Campaign not found');

        const enrollments = await Campaign.getEnrollments(campaignId);
        if (enrollments.length === 0) {
            throw new Error('No recipients in campaign');
        }

        // Get device_ids for round-robin (fallback to single device_id)
        const deviceIds = campaign.device_ids && campaign.device_ids.length > 0
            ? campaign.device_ids
            : [campaign.device_id];
        const deviceCount = deviceIds.length;

        console.log(`\n${'='.repeat(60)}`);
        console.log(`🚀 Starting campaign ${campaignId}`);
        console.log(`📱 Using ${deviceCount} device(s): [${deviceIds.join(', ')}]`);

        // Get daily limit for EACH device
        const usageLevelConfig = require('./usageLevelConfig');
        const deviceLimits = {};  // { deviceId: { limit, remaining, usageLevel, trustLevel } }

        for (const deviceId of deviceIds) {
            const deviceResult = await pool.query(
                'SELECT trust_level, usage_level FROM clients WHERE id = $1',
                [deviceId]
            );
            const deviceData = deviceResult.rows[0] || { trust_level: 1, usage_level: 1 };

            const trustLevel = deviceData.trust_level || 1;
            const usageLevel = deviceData.usage_level || 1;
            const dailyLimit = usageLevelConfig.getSafeDailyLimit(trustLevel, usageLevel);

            // Get how many this device already sent today
            const todaySent = await Campaign.getTodaySentCountByDevice(deviceId);
            const remaining = Math.max(0, dailyLimit - todaySent);

            deviceLimits[deviceId] = {
                limit: dailyLimit,
                todaySent,
                remaining,
                trustLevel,
                usageLevel
            };

            console.log(`  📊 Device ${deviceId}: Limit=${dailyLimit}, Sent Today=${todaySent}, Remaining=${remaining}`);
        }

        // Detect campaign tier based on recipient count
        const firstDeviceData = deviceLimits[deviceIds[0]];
        const tier = usageLevelConfig.getTier(enrollments.length);
        const healthMultiplier = usageLevelConfig.getHealthMultiplier(firstDeviceData.usageLevel);

        // Calculate total capacity across all devices
        const totalCapacity = Object.values(deviceLimits).reduce((sum, d) => sum + d.remaining, 0);
        console.log(`📋 ${tier.name} - ${enrollments.length} recipients`);
        console.log(`💪 Health Multiplier: ${healthMultiplier}x`);
        console.log(`🔒 Total Capacity: ${totalCapacity} messages across ${deviceCount} devices`);
        console.log(`${'='.repeat(60)}\n`);

        // Distribute enrollments to devices based on their remaining capacity
        const deviceQueue = {};  // { deviceId: [enrollmentIds] }
        for (const deviceId of deviceIds) {
            deviceQueue[deviceId] = [];
        }

        // Smart distribution: assign enrollments to devices based on capacity
        // Round-robin but respects each device's remaining limit
        let messagesToProcess = 0;
        for (let i = 0; i < enrollments.length && messagesToProcess < totalCapacity; i++) {
            // Find a device with remaining capacity using round-robin
            let assignedDevice = null;
            for (let d = 0; d < deviceCount; d++) {
                const deviceId = deviceIds[(i + d) % deviceCount];
                if (deviceLimits[deviceId].remaining > 0) {
                    assignedDevice = deviceId;
                    deviceLimits[deviceId].remaining--;
                    deviceQueue[deviceId].push(enrollments[i]);
                    break;
                }
            }

            if (assignedDevice) {
                messagesToProcess++;
            } else {
                // All devices are at capacity, mark as pending
                await Campaign.updateEnrollmentStatus(enrollments[i].id, 'pending');
            }
        }

        console.log(`📊 Distribution:`);
        for (const deviceId of deviceIds) {
            console.log(`  Device ${deviceId}: ${deviceQueue[deviceId].length} messages assigned`);
        }

        // SEQUENTIAL CAMPAIGNS: Queue only first customer per device
        // Other customers stay pending and are queued when the current one finishes all steps
        const steps = await Campaign.getSteps(campaignId);
        if (campaign.type === 'sequential' && steps.length > 1) {
            console.log(`📬 SEQUENTIAL CAMPAIGN - Queueing first customer per device only`);
            console.log(`📋 Each customer receives ${steps.length} messages with 20s delay between each`);

            for (const deviceId of deviceIds) {
                const deviceEnrollments = deviceQueue[deviceId];
                if (deviceEnrollments.length === 0) continue;

                // Queue only the FIRST customer for this device
                const firstEnrollment = deviceEnrollments[0];
                await Campaign.assignDeviceToEnrollment(firstEnrollment.id, deviceId);
                await Campaign.updateEnrollmentStatus(firstEnrollment.id, 'active');
                await this.queueStep(firstEnrollment.id, 1, campaignId, deviceId, new Date());
                console.log(`📤 Device ${deviceId}: Starting with ${firstEnrollment.recipient}`);

                // Mark remaining customers as pending (they'll be queued when first finishes)
                for (let i = 1; i < deviceEnrollments.length; i++) {
                    await Campaign.assignDeviceToEnrollment(deviceEnrollments[i].id, deviceId);
                    await Campaign.updateEnrollmentStatus(deviceEnrollments[i].id, 'pending');
                }
                console.log(`⏸️ Device ${deviceId}: ${deviceEnrollments.length - 1} customers waiting`);
            }
        } else {
            // SINGLE MESSAGE or standard campaigns: Use normal distribution logic
            // Check if using bulk 24h distribution
            const usageLevel = firstDeviceData.usageLevel;
            if (tier.use24hDistribution) {
                console.log(`📦 Using 24-hour batch distribution for ${messagesToProcess} messages`);

                const distribution = usageLevelConfig.calculateBatchDistribution(usageLevel, messagesToProcess);
                console.log(`⏱️ Batch size: ${distribution.batchSize}, Total batches: ${distribution.totalBatches}`);

                let messageIndex = 0;
                for (const deviceId of deviceIds) {
                    for (let i = 0; i < deviceQueue[deviceId].length; i++) {
                        const enrollment = deviceQueue[deviceId][i];
                        const timing = usageLevelConfig.getMessageTiming(messageIndex, usageLevel, messagesToProcess);
                        const startAfter = new Date(Date.now() + timing.actualDelayMs);

                        await Campaign.assignDeviceToEnrollment(enrollment.id, deviceId);
                        await Campaign.updateEnrollmentStatus(enrollment.id, 'active');
                        await Campaign.setNextExecution(enrollment.id, startAfter);
                        await this.queueStep(enrollment.id, 1, campaignId, deviceId, startAfter);

                        if (messageIndex < 3 || messageIndex === messagesToProcess - 1) {
                            console.log(`📤 Message ${messageIndex + 1}/${messagesToProcess} [Device ${deviceId}] - batch ${timing.batchIndex + 1}, in ${Math.round(timing.actualDelayMs / 1000 / 60)} min`);
                        }
                        messageIndex++;
                    }
                }
            } else {
                // Use smart tiered distribution for smaller campaigns
                const firstTiming = usageLevelConfig.getTieredMessageTiming(0, enrollments.length, usageLevel);
                console.log(`⏱️ Estimated completion: ~${firstTiming.estimatedTotalMinutes} minutes`);
                console.log(`⏱️ Base delay: ${Math.round(firstTiming.baseDelaySeconds)}s (adjusted by health)`);

                let messageIndex = 0;
                for (const deviceId of deviceIds) {
                    for (let i = 0; i < deviceQueue[deviceId].length; i++) {
                        const enrollment = deviceQueue[deviceId][i];
                        const timing = usageLevelConfig.getTieredMessageTiming(messageIndex, enrollments.length, usageLevel);
                        const startAfter = new Date(Date.now() + timing.actualDelayMs);

                        await Campaign.assignDeviceToEnrollment(enrollment.id, deviceId);
                        await Campaign.updateEnrollmentStatus(enrollment.id, 'active');
                        await Campaign.setNextExecution(enrollment.id, startAfter);
                        await this.queueStep(enrollment.id, 1, campaignId, deviceId, startAfter);

                        // Log first few and last
                        if (messageIndex < 3 || messageIndex === messagesToProcess - 1) {
                            const delaySeconds = Math.round(timing.actualDelayMs / 1000);
                            const delayMinutes = Math.round(delaySeconds / 60);
                            console.log(`📤 Message ${messageIndex + 1}/${messagesToProcess} [Device ${deviceId}] - in ${delayMinutes > 0 ? delayMinutes + ' min' : delaySeconds + 's'}`);
                        }
                        messageIndex++;
                    }
                }
            }
        }

        // Mark any remaining enrollments as pending
        for (let i = messagesToProcess; i < enrollments.length; i++) {
            await Campaign.updateEnrollmentStatus(enrollments[i].id, 'pending');
        }
        if (enrollments.length > messagesToProcess) {
            console.log(`⏸️ ${enrollments.length - messagesToProcess} recipients pending (device limits reached)`);
        }

        // Update campaign status
        await Campaign.updateStatus(campaignId, 'running');
        await Campaign.setStartedAt(campaignId);

        await this.emitProgress(campaignId);

        console.log(`\n✅ Campaign ${campaignId} started successfully!\n`);

        return {
            queued: messagesToProcess,
            pending: Math.max(0, enrollments.length - messagesToProcess),
            tier: tier.key,
            tierName: tier.name
        };
    }

    /**
     * Pause a campaign - stop processing new steps
     */
    static async pauseCampaign(campaignId) {
        await Campaign.updateStatus(campaignId, 'paused');
        console.log(`⏸️ Campaign ${campaignId} paused`);

        if (io) {
            io.emit('campaign:status', { campaignId, status: 'paused' });
        }
    }

    /**
     * Resume a paused campaign
     */
    static async resumeCampaign(campaignId) {
        const campaign = await Campaign.getById(campaignId);
        const enrollments = await Campaign.getEnrollmentsByStatus(campaignId, 'active');

        await Campaign.updateStatus(campaignId, 'running');

        // Re-queue current step for active enrollments
        for (const enrollment of enrollments) {
            const nextStep = enrollment.current_step + 1;
            await this.queueStep(enrollment.id, nextStep, campaignId, campaign.device_id);
        }

        console.log(`▶️ Campaign ${campaignId} resumed with ${enrollments.length} active enrollments`);

        if (io) {
            io.emit('campaign:status', { campaignId, status: 'running' });
        }
    }

    // ==================== HELPER FUNCTIONS ====================

    /**
     * Check if within business hours (DISABLED FOR TESTING - 24/7 sending)
     * Original: 8-12, 18-21 Sun-Thu
     */
    static isWithinBusinessHours(campaign) {
        // TEMPORARILY DISABLED FOR TESTING - Always allow sending
        console.log('📅 Business hours check DISABLED - 24/7 mode');
        return true;
    }

    /**
     * Calculate next valid business hour (Fixed periods)
     */
    static calculateNextBusinessHour(campaign) {
        const { OPERATING_HOURS } = trustLevelConfig;
        let cursor = DateTime.now().setZone(OPERATING_HOURS.timezone);

        for (let daysAhead = 0; daysAhead < 7; daysAhead++) {
            const checkDate = cursor.plus({ days: daysAhead });
            const dayOfWeek = checkDate.weekday;

            if (OPERATING_HOURS.days.includes(dayOfWeek)) {
                // Check each period
                for (const period of OPERATING_HOURS.periods) {
                    const [startHour, startMin] = period.start.split(':').map(Number);
                    const periodStart = checkDate.set({ hour: startHour, minute: startMin, second: 0 });

                    if (periodStart > DateTime.now()) {
                        console.log(`📅 Next slot: ${periodStart.toFormat('yyyy-MM-dd HH:mm')}`);
                        return periodStart.toJSDate();
                    }
                }
            }
        }
        // Fallback: tomorrow morning
        return cursor.plus({ days: 1 }).set({ hour: 8, minute: 0 }).toJSDate();
    }

    /**
     * Calculate random delay based on device trust level
     */
    static async calculateRandomDelayForDevice(deviceId) {
        try {
            // Get device trust level from database
            const result = await pool.query('SELECT trust_level FROM clients WHERE id = $1', [deviceId]);
            const trustLevel = result.rows[0]?.trust_level || 1;
            return trustLevelConfig.getRandomDelay(trustLevel);
        } catch (error) {
            console.error('Error getting trust level:', error.message);
            return 30000; // Default 30 seconds delay on error
        }
    }

    /**
     * Calculate random delay (legacy, uses campaign settings or trust level)
     */
    static calculateRandomDelay(campaign) {
        // Use trust level config instead of campaign settings
        const trustLevel = campaign.trust_level || 1;
        return trustLevelConfig.getRandomDelay(trustLevel);
    }

    /**
     * Check blacklist
     */
    static async checkBlacklist(deviceId, recipient) {
        const result = await pool.query(
            'SELECT 1 FROM client_chats_blocked WHERE client_id = $1 AND phone_number = $2',
            [deviceId, recipient.replace('@c.us', '')]
        );
        return result.rowCount > 0;
    }

    /**
     * Parse spintax - only matches patterns with | separator
     * e.g., {مرحبا|أهلا|السلام عليكم} but NOT {name}
     */
    static parseSpintax(text) {
        // Only match patterns that contain | (pipe) - these are spintax
        const regex = /{([^{}]*\|[^{}]*)}/g;
        return text.replace(regex, (match, options) => {
            const choices = options.split('|');
            return choices[Math.floor(Math.random() * choices.length)];
        });
    }

    /**
     * Replace variables in text
     */
    static replaceVariables(text, attributes, enrollment) {
        let result = text;

        // Replace {{name}}, {{phone}}, etc.
        result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return attributes[key] || enrollment[key] || match;
        });

        // Replace {name}, {phone}, etc.
        result = result.replace(/\{(\w+)\}/g, (match, key) => {
            if (key.includes('|')) return match; // Skip spintax
            return attributes[key] || enrollment[key] || match;
        });

        return result;
    }

    /**
     * Emit real-time progress update
     */
    static async emitProgress(campaignId) {
        if (!io) return;

        const stats = await Campaign.getStats(campaignId);
        const campaign = await Campaign.getById(campaignId);

        io.emit('campaign:progress', {
            campaignId,
            ...stats,
            status: campaign.status,
            eta: this.calculateETA(stats)
        });
    }

    /**
     * Calculate estimated time of completion
     */
    static calculateETA(stats) {
        if (!stats) return null;

        const total = stats.total || 0;
        const sent = stats.sent || 0;
        const failed = stats.failed || 0;
        const remaining = total - sent - failed;

        if (remaining <= 0 || isNaN(remaining)) return null;

        const avgDelaySeconds = 30; // Average delay between messages
        const etaSeconds = remaining * avgDelaySeconds;

        try {
            return new Date(Date.now() + etaSeconds * 1000).toISOString();
        } catch (e) {
            console.error('Error calculating ETA:', e);
            return null;
        }
    }

    /**
     * Stop pg-boss
     */
    static async stop() {
        if (boss) {
            await boss.stop();
            console.log('📬 Campaign Queue stopped');
        }
    }
}

module.exports = CampaignQueue;
