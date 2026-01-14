/**
 * Trust Level Configuration for Campaign Sending
 * 
 * Provides automatic anti-ban settings based on profile trust level
 * Higher trust levels = faster sending, larger batches
 */

const TRUST_CONFIGS = {
    1: {  // New number / Low trust
        batchSize: 5,
        minDelaySeconds: 45,
        maxDelaySeconds: 90,
        dailyLimit: 50,
        description: 'جديد - إرسال بطيء'
    },
    2: {
        batchSize: 10,
        minDelaySeconds: 30,
        maxDelaySeconds: 60,
        dailyLimit: 100,
        description: 'منخفض'
    },
    3: {  // Default / Medium trust
        batchSize: 20,
        minDelaySeconds: 20,
        maxDelaySeconds: 45,
        dailyLimit: 200,
        description: 'متوسط'
    },
    4: {
        batchSize: 35,
        minDelaySeconds: 15,
        maxDelaySeconds: 35,
        dailyLimit: 350,
        description: 'مرتفع'
    },
    5: {  // Trusted / Established number
        batchSize: 50,
        minDelaySeconds: 10,
        maxDelaySeconds: 25,
        dailyLimit: 500,
        description: 'موثوق - إرسال سريع'
    }
};

// Fixed operating hours (Cairo timezone)
const OPERATING_HOURS = {
    periods: [
        { start: '08:00', end: '12:00' },  // Morning: 8am - 12pm
        { start: '18:00', end: '21:00' }   // Evening: 6pm - 9pm
    ],
    // Luxon weekday: 1=Mon, 2=Tue, ..., 7=Sun
    // We want Sun-Thu = [7, 1, 2, 3, 4]
    days: [7, 1, 2, 3, 4], // Sunday=7, Monday=1, Tuesday=2, Wednesday=3, Thursday=4
    timezone: 'Africa/Cairo'
};

/**
 * Get configuration for a trust level
 * @param {number} trustLevel - Trust level (1-5)
 * @returns {Object} Configuration object
 */
function getConfig(trustLevel) {
    const level = Math.min(Math.max(parseInt(trustLevel) || 1, 1), 5);
    return TRUST_CONFIGS[level];
}

/**
 * Calculate random delay based on trust level
 * @param {number} trustLevel - Trust level (1-5)
 * @returns {number} Delay in milliseconds
 */
function getRandomDelay(trustLevel) {
    const config = getConfig(trustLevel);
    const delaySeconds = Math.floor(
        Math.random() * (config.maxDelaySeconds - config.minDelaySeconds + 1)
    ) + config.minDelaySeconds;
    return delaySeconds * 1000;
}

/**
 * Get batch size for a trust level
 * @param {number} trustLevel - Trust level (1-5)
 * @returns {number} Batch size
 */
function getBatchSize(trustLevel) {
    return getConfig(trustLevel).batchSize;
}

/**
 * Get daily limit for a trust level
 * @param {number} trustLevel - Trust level (1-5)
 * @returns {number} Daily limit
 */
function getDailyLimit(trustLevel) {
    return getConfig(trustLevel).dailyLimit;
}

/**
 * Get operating hours configuration
 * @returns {Object} Operating hours config
 */
function getOperatingHours() {
    return OPERATING_HOURS;
}

/**
 * Calculate typing duration based on message length
 * Simulates realistic human typing speed
 * 
 * Base speeds (ms per character):
 * - Regular lowercase: ~80ms
 * - Capital letters: ~120ms (shift key)
 * - Numbers: ~100ms (top row)
 * - Special chars: ~130ms (@#$%&*...)
 * - Space: ~50ms (easy key)
 * - Arabic base (ا ب ت...): ~90ms
 * - Arabic with diacritics (أ إ ؤ ئ): ~150ms (shift or alt)
 * 
 * @param {string} message - Message content
 * @returns {number} Typing duration in milliseconds (min 300ms, max 8000ms)
 */
function getTypingDuration(message) {
    if (!message || message.length === 0) return 300;

    let totalMs = 0;

    // Character type patterns
    const patterns = {
        // English
        lowercase: /[a-z]/,
        uppercase: /[A-Z]/,
        numbers: /[0-9]/,
        specialChars: /[!@#$%^&*()_+\-=\[\]{}|;':",./<>?\\`~]/,
        space: /\s/,

        // Arabic
        arabicBase: /[\u0627\u0628\u062A\u062B\u062C\u062D\u062E\u062F\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0639\u063A\u0641\u0642\u0643\u0644\u0645\u0646\u0647\u0648\u064A]/,
        // Arabic with hamza/diacritics (أ إ ؤ ئ ء ة آ)
        arabicDiacritics: /[\u0623\u0625\u0624\u0626\u0621\u0629\u0622\u0649]/,
        // Arabic tashkeel (فتحة ضمة كسرة إلخ)
        arabicTashkeel: /[\u064B-\u0652]/
    };

    // Speed multipliers (ms per char)
    const speeds = {
        lowercase: 80,
        uppercase: 120,      // Need shift
        numbers: 100,        // Top row
        specialChars: 130,   // Need shift + thinking
        space: 50,           // Easy
        arabicBase: 90,
        arabicDiacritics: 150,  // Harder to type
        arabicTashkeel: 0,      // Added mostly by keyboard, skip
        default: 100
    };

    // Process each character
    for (let i = 0; i < message.length; i++) {
        const char = message[i];
        let charTime = speeds.default;

        if (patterns.space.test(char)) {
            charTime = speeds.space;
        } else if (patterns.lowercase.test(char)) {
            charTime = speeds.lowercase;
        } else if (patterns.uppercase.test(char)) {
            charTime = speeds.uppercase;
        } else if (patterns.numbers.test(char)) {
            charTime = speeds.numbers;
        } else if (patterns.specialChars.test(char)) {
            charTime = speeds.specialChars;
        } else if (patterns.arabicDiacritics.test(char)) {
            charTime = speeds.arabicDiacritics;
        } else if (patterns.arabicBase.test(char)) {
            charTime = speeds.arabicBase;
        } else if (patterns.arabicTashkeel.test(char)) {
            charTime = speeds.arabicTashkeel;
        }

        // Add jitter (±20% random variation for realism)
        const jitter = 0.8 + (Math.random() * 0.4);
        totalMs += charTime * jitter;
    }

    // Add small pauses between words (average 150ms per word break)
    const wordCount = message.split(/\s+/).length - 1;
    totalMs += wordCount * 150;

    // Add thinking pauses for longer messages (every ~50 chars)
    const thinkingPauses = Math.floor(message.length / 50);
    totalMs += thinkingPauses * 300;

    // Clamp between 300ms and 8000ms
    return Math.min(Math.max(Math.round(totalMs), 300), 8000);
}

module.exports = {
    TRUST_CONFIGS,
    OPERATING_HOURS,
    getConfig,
    getRandomDelay,
    getBatchSize,
    getDailyLimit,
    getOperatingHours,
    getTypingDuration
};
