/**
 * Usage Level Configuration Service
 * 
 * Manages WhatsApp profile usage levels (separate from Trust Level)
 * Handles daily limits, batch distribution, and level progression
 */

// Usage Level Definitions (0-5)
const USAGE_LEVELS = {
    0: {
        name: 'ضعيف جداً',
        nameEn: 'Very Weak',
        dailyLimit: 30,
        batchSizePercent: 10, // 10% of daily limit per batch
        color: '#495057',     // Dark gray
        emoji: '⚫',
        description: 'بعد حظر من المستوى الأول',
        promotionHours: null  // Cannot promote from here directly
    },
    1: {
        name: 'ضعيف',
        nameEn: 'Weak',
        dailyLimit: 50,
        batchSizePercent: 10,
        color: '#ff6b6b',     // Red
        emoji: '🔴',
        description: 'المستوى المبدئي',
        promotionHours: 72    // 3 days = 72 hours to promote to level 2
    },
    2: {
        name: 'أقل من المتوسط',
        nameEn: 'Below Average',
        dailyLimit: 70,
        batchSizePercent: 10,
        color: '#ffa94d',     // Orange
        emoji: '🟠',
        description: 'بعد 3 أيام حملات ناجحة',
        promotionHours: 48    // +2 days = 48 hours to promote to level 3
    },
    3: {
        name: 'متوسط',
        nameEn: 'Average',
        dailyLimit: 100,
        batchSizePercent: 10,
        color: '#ffd43b',     // Yellow
        emoji: '🟡',
        description: 'بعد 5 أيام حملات ناجحة',
        promotionHours: 168   // +7 days = 168 hours to promote to level 4
    },
    4: {
        name: 'جيد',
        nameEn: 'Good',
        dailyLimit: 150,
        batchSizePercent: 10,
        color: '#69db7c',     // Green
        emoji: '🟢',
        description: 'بعد 12 يوم حملات ناجحة',
        promotionHours: 360   // +15 days = 360 hours to promote to level 5
    },
    5: {
        name: 'ممتاز',
        nameEn: 'Excellent',
        dailyLimit: 200,
        batchSizePercent: 10,
        color: '#4ecdc4',     // Teal
        emoji: '🌟',
        description: 'أعلى مستوى - بعد 27 يوم حملات ناجحة',
        promotionHours: null  // Max level, no further promotion
    }
};

// Questionnaire Options
const QUESTIONNAIRE_OPTIONS = {
    phoneAge: [
        { value: 'new', label: 'جديد (أقل من شهر)', labelEn: 'New (less than 1 month)' },
        { value: 'medium', label: 'متوسط (1-6 أشهر)', labelEn: 'Medium (1-6 months)' },
        { value: 'old', label: 'قديم (أكثر من 6 أشهر)', labelEn: 'Old (more than 6 months)' }
    ],
    dailyMessageRate: [
        { value: '0-50', label: '0-50 رسالة', labelEn: '0-50 messages' },
        { value: '50-100', label: '50-100 رسالة', labelEn: '50-100 messages' },
        { value: '100-300', label: '100-300 رسالة', labelEn: '100-300 messages' },
        { value: '300-500', label: '300-500 رسالة', labelEn: '300-500 messages' }
    ],
    usedSpamSoftware: [
        { value: 'no', label: 'لا، أبداً', labelEn: 'No, never' },
        { value: 'yes', label: 'نعم، استخدمت من قبل', labelEn: 'Yes, I have used before (WaSender, WhatsApp Sender Pro, etc.)' }
    ],
    previousBan: [
        { value: 'never', label: 'لا، لم يتم حظره', labelEn: 'No, never banned' },
        { value: '1-3days', label: 'نعم - من 1-3 أيام فاتوا', labelEn: 'Yes - 1-3 days ago' },
        { value: '3-7days', label: 'نعم - من 3-7 أيام فاتوا', labelEn: 'Yes - 3-7 days ago' },
        { value: '7-15days', label: 'نعم - من 7-15 يوم', labelEn: 'Yes - 7-15 days ago' },
        { value: '15-30days', label: 'نعم - من 15-30 يوم', labelEn: 'Yes - 15-30 days ago' },
        { value: 'month+', label: 'نعم - أكثر من شهر', labelEn: 'Yes - more than a month ago' }
    ]
};

// Recipient Tier Configuration for Smart Distribution
// Tiers determine base timing, then adjusted by usage level health
const RECIPIENT_TIERS = {
    testing: {
        name: '🧪 Testing Mode',
        nameAr: 'وضع الاختبار',
        maxRecipients: 10,
        totalMinutes: 10,           // Complete in ~10 minutes
        baseDelaySeconds: 45,       // Base delay between messages
        minDelaySeconds: 30,
        maxDelaySeconds: 90
    },
    small: {
        name: '📤 Small Campaign',
        nameAr: 'حملة صغيرة',
        maxRecipients: 50,
        totalMinutes: 90,           // ~1.5 hours
        baseDelaySeconds: 90,
        minDelaySeconds: 60,
        maxDelaySeconds: 150
    },
    medium: {
        name: '📊 Medium Campaign',
        nameAr: 'حملة متوسطة',
        maxRecipients: 100,
        totalMinutes: 300,          // ~5 hours
        baseDelaySeconds: 150,
        minDelaySeconds: 100,
        maxDelaySeconds: 240
    },
    large: {
        name: '📈 Large Campaign',
        nameAr: 'حملة كبيرة',
        maxRecipients: 300,
        totalMinutes: 600,          // ~10 hours
        baseDelaySeconds: 180,
        minDelaySeconds: 120,
        maxDelaySeconds: 300
    },
    bulk: {
        name: '🚀 Bulk Campaign (24h)',
        nameAr: 'حملة ضخمة',
        maxRecipients: Infinity,
        totalMinutes: 1440,         // 24 hours
        use24hDistribution: true    // Use existing 24h batch logic
    }
};

// Usage Level Health Multiplier
// Lower levels = slower (safer), Higher levels = faster
const HEALTH_MULTIPLIERS = {
    0: 2.0,   // Very weak - double delay
    1: 1.5,   // Weak - 50% slower
    2: 1.2,   // Below avg - 20% slower
    3: 1.0,   // Average - normal
    4: 0.9,   // Good - 10% faster
    5: 0.8    // Excellent - 20% faster
};

/**
 * Get usage level configuration
 * @param {number} level - Usage level (0-5)
 * @returns {Object} Level configuration
 */
function getConfig(level) {
    const normalizedLevel = Math.min(Math.max(parseInt(level) || 1, 0), 5);
    return USAGE_LEVELS[normalizedLevel];
}

/**
 * Get daily limit for a usage level
 * @param {number} level - Usage level (0-5)
 * @returns {number} Daily message limit
 */
function getDailyLimit(level) {
    return getConfig(level).dailyLimit;
}

/**
 * Calculate batch distribution for a campaign
 * @param {number} level - Usage level (0-5)
 * @param {number} totalMessages - Total messages to send
 * @returns {Object} Batch distribution configuration
 */
function calculateBatchDistribution(level, totalMessages) {
    const config = getConfig(level);
    const dailyLimit = config.dailyLimit;

    // Cap messages to daily limit
    const messagesToSend = Math.min(totalMessages, dailyLimit);

    // Calculate batch size (10% of daily limit)
    const batchSize = Math.ceil(dailyLimit * (config.batchSizePercent / 100));

    // Calculate number of batches needed
    const totalBatches = Math.ceil(messagesToSend / batchSize);

    // Time available: 24 hours = 86400 seconds
    const totalSeconds = 24 * 60 * 60;

    // Time per batch (in seconds)
    const timePerBatch = totalSeconds / 10; // Always 10 batches for 24h distribution

    // Base delay between messages inside a batch (in seconds)
    const baseDelayInsideBatch = timePerBatch / batchSize;

    return {
        dailyLimit,
        messagesToSend,
        batchSize,
        totalBatches,
        timePerBatchSeconds: timePerBatch,
        baseDelaySeconds: baseDelayInsideBatch,
        // Actual delay will be 80-100% of base delay
        minDelaySeconds: Math.floor(baseDelayInsideBatch * 0.8),
        maxDelaySeconds: baseDelayInsideBatch
    };
}

/**
 * Get random delay for message sending (80-100% of base delay)
 * @param {number} baseDelaySeconds - Base delay in seconds
 * @returns {number} Random delay in milliseconds
 */
function getRandomDelay(baseDelaySeconds) {
    // Random multiplier between 0.8 and 1.0
    const multiplier = 0.8 + (Math.random() * 0.2);
    const delaySeconds = baseDelaySeconds * multiplier;
    return Math.floor(delaySeconds * 1000); // Return in milliseconds
}

/**
 * Calculate batch timing for a specific message index
 * @param {number} messageIndex - 0-based index of message
 * @param {number} level - Usage level
 * @param {number} totalMessages - Total messages in campaign
 * @returns {Object} Timing information for this message
 */
function getMessageTiming(messageIndex, level, totalMessages) {
    const distribution = calculateBatchDistribution(level, totalMessages);

    // Which batch does this message belong to?
    const batchIndex = Math.floor(messageIndex / distribution.batchSize);
    const positionInBatch = messageIndex % distribution.batchSize;

    // Calculate start time for this batch
    const batchStartSeconds = batchIndex * distribution.timePerBatchSeconds;

    // Calculate offset within batch (using base delay)
    const offsetInBatch = positionInBatch * distribution.baseDelaySeconds;

    // Total base delay from campaign start
    const baseTotalSeconds = batchStartSeconds + offsetInBatch;

    // Apply random variation (80-100%)
    const multiplier = 0.8 + (Math.random() * 0.2);
    const actualDelaySeconds = baseTotalSeconds * multiplier;

    return {
        batchIndex,
        positionInBatch,
        batchStartSeconds,
        baseDelaySeconds: baseTotalSeconds,
        actualDelayMs: Math.floor(actualDelaySeconds * 1000)
    };
}

/**
 * Determine initial usage level from questionnaire responses
 * @param {Object} responses - Questionnaire responses
 * @returns {number} Initial usage level (0-5)
 */
function determineInitialLevel(responses) {
    const { phoneAge, dailyMessageRate, usedSpamSoftware, previousBan } = responses;

    // Recent ban or used spam software = Level 0 (Very Weak)
    if (previousBan === '1-3days' || previousBan === '3-7days' || usedSpamSoftware === 'yes') {
        return 0;
    }

    // Old ban (7-30 days) or new number = Level 1 (Weak)
    if (previousBan === '7-15days' || previousBan === '15-30days' || phoneAge === 'new') {
        return 1;
    }

    // Old ban (30+ days) or medium-aged number = Level 2 (Below Average)
    if (previousBan === 'month+' || phoneAge === 'medium') {
        return 2;
    }

    // No ban, old number - start based on daily rate
    if (phoneAge === 'old' && previousBan === 'never') {
        if (dailyMessageRate === '300-500') return 4; // Good
        if (dailyMessageRate === '100-300') return 3; // Average
        if (dailyMessageRate === '50-100') return 2;  // Below Average
    }

    // Default to Level 1 (Weak)
    return 1;
}

/**
 * Get hours required for promotion to next level
 * @param {number} currentLevel - Current usage level
 * @returns {number|null} Hours required, null if max level
 */
function getPromotionHours(currentLevel) {
    const config = getConfig(currentLevel);
    return config.promotionHours;
}

/**
 * Check if profile should be promoted
 * @param {number} currentLevel - Current usage level
 * @param {number} campaignHours - Total active campaign hours
 * @param {number} currentLevelHours - Hours at current level
 * @returns {Object} Promotion status
 */
function checkPromotion(currentLevel, currentLevelHours) {
    if (currentLevel >= 5) {
        return { shouldPromote: false, reason: 'Already at max level' };
    }

    const requiredHours = getPromotionHours(currentLevel);
    if (!requiredHours) {
        return { shouldPromote: false, reason: 'Level cannot be promoted' };
    }

    if (currentLevelHours >= requiredHours) {
        return {
            shouldPromote: true,
            newLevel: currentLevel + 1,
            reason: `Completed ${currentLevelHours} hours at level ${currentLevel}`
        };
    }

    return {
        shouldPromote: false,
        hoursRemaining: requiredHours - currentLevelHours,
        reason: `Need ${requiredHours - currentLevelHours} more hours`
    };
}

/**
 * Handle ban/warning - demote usage level
 * @param {number} currentLevel - Current usage level
 * @returns {Object} Demotion result
 */
function handleBan(currentLevel) {
    // If already at Level 1 (Weak), demote to Level 0 (Very Weak)
    if (currentLevel <= 1) {
        return {
            newLevel: 0,
            dailyLimit: USAGE_LEVELS[0].dailyLimit,
            reason: 'Demoted to Very Weak after ban'
        };
    }

    // All other levels demote to Level 1 (Weak)
    return {
        newLevel: 1,
        dailyLimit: USAGE_LEVELS[1].dailyLimit,
        reason: 'Demoted to Weak after ban'
    };
}

/**
 * Get all usage levels for display
 * @returns {Object} All usage level configurations
 */
function getAllLevels() {
    return USAGE_LEVELS;
}

/**
 * Get questionnaire options for UI
 * @returns {Object} Questionnaire options
 */
function getQuestionnaireOptions() {
    return QUESTIONNAIRE_OPTIONS;
}

// ============================================
// TIERED DISTRIBUTION FUNCTIONS
// ============================================

/**
 * Get the tier based on recipient count
 * @param {number} recipientCount - Number of recipients
 * @returns {Object} Tier configuration with tier key
 */
function getTier(recipientCount) {
    if (recipientCount <= RECIPIENT_TIERS.testing.maxRecipients) {
        return { key: 'testing', ...RECIPIENT_TIERS.testing };
    }
    if (recipientCount <= RECIPIENT_TIERS.small.maxRecipients) {
        return { key: 'small', ...RECIPIENT_TIERS.small };
    }
    if (recipientCount <= RECIPIENT_TIERS.medium.maxRecipients) {
        return { key: 'medium', ...RECIPIENT_TIERS.medium };
    }
    if (recipientCount <= RECIPIENT_TIERS.large.maxRecipients) {
        return { key: 'large', ...RECIPIENT_TIERS.large };
    }
    return { key: 'bulk', ...RECIPIENT_TIERS.bulk };
}

/**
 * Get health multiplier for a usage level
 * Lower levels = slower (safer), Higher levels = faster
 * @param {number} usageLevel - Usage level (0-5)
 * @returns {number} Multiplier for delay calculation
 */
function getHealthMultiplier(usageLevel) {
    const level = Math.min(Math.max(parseInt(usageLevel) || 1, 0), 5);
    return HEALTH_MULTIPLIERS[level];
}

/**
 * Get safe daily limit using Min(Trust Limit, Usage Limit)
 * This is the safest approach - the lower limit wins
 * @param {number} trustLevel - Trust level (1-5)
 * @param {number} usageLevel - Usage level (0-5)
 * @returns {number} Safe daily limit
 */
function getSafeDailyLimit(trustLevel, usageLevel) {
    const trustLevelConfig = require('./trustLevelConfig');
    const trustLimit = trustLevelConfig.getDailyLimit(trustLevel);
    const usageLimit = getDailyLimit(usageLevel);
    return Math.min(trustLimit, usageLimit);
}

/**
 * Calculate smart timing for tiered distribution
 * Combines tier base delay with usage level health adjustment
 * @param {number} messageIndex - 0-based index of message
 * @param {number} recipientCount - Total recipients
 * @param {number} usageLevel - Usage level (0-5)
 * @returns {Object} Timing information
 */
function getTieredMessageTiming(messageIndex, recipientCount, usageLevel) {
    const tier = getTier(recipientCount);
    const healthMultiplier = getHealthMultiplier(usageLevel);

    // For bulk campaigns, use 24h distribution
    if (tier.use24hDistribution) {
        return {
            tier: tier.key,
            tierName: tier.name,
            use24hDistribution: true
        };
    }

    // Calculate base delay for this tier
    const baseDelay = tier.baseDelaySeconds;

    // Apply health multiplier
    const adjustedBaseDelay = baseDelay * healthMultiplier;

    // Add random variation (±25%)
    const minDelay = adjustedBaseDelay * 0.75;
    const maxDelay = adjustedBaseDelay * 1.25;
    const actualDelaySeconds = minDelay + (Math.random() * (maxDelay - minDelay));

    // Calculate cumulative delay for this message
    const cumulativeDelaySeconds = messageIndex * adjustedBaseDelay;

    // Apply random variation to cumulative as well
    const cumulativeVariation = 0.85 + (Math.random() * 0.3); // 85-115%
    const actualCumulativeSeconds = cumulativeDelaySeconds * cumulativeVariation;

    return {
        tier: tier.key,
        tierName: tier.name,
        tierNameAr: tier.nameAr,
        messageIndex,
        recipientCount,
        usageLevel,
        healthMultiplier,
        baseDelaySeconds: adjustedBaseDelay,
        actualDelaySeconds: Math.floor(actualDelaySeconds),
        actualDelayMs: Math.floor(actualCumulativeSeconds * 1000),
        estimatedTotalMinutes: Math.ceil((recipientCount * adjustedBaseDelay) / 60)
    };
}

/**
 * Get tier configuration for display
 * @returns {Object} All tier configurations
 */
function getAllTiers() {
    return RECIPIENT_TIERS;
}

module.exports = {
    USAGE_LEVELS,
    QUESTIONNAIRE_OPTIONS,
    RECIPIENT_TIERS,
    HEALTH_MULTIPLIERS,
    getConfig,
    getDailyLimit,
    calculateBatchDistribution,
    getRandomDelay,
    getMessageTiming,
    determineInitialLevel,
    getPromotionHours,
    checkPromotion,
    handleBan,
    getAllLevels,
    getQuestionnaireOptions,
    // New tiered distribution functions
    getTier,
    getHealthMultiplier,
    getSafeDailyLimit,
    getTieredMessageTiming,
    getAllTiers
};
