"use strict";
/**
 * Validators Utility
 * Runtime validation functions for external data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidPhoneNumber = isValidPhoneNumber;
exports.isValidWebhookUrl = isValidWebhookUrl;
exports.isValidChatId = isValidChatId;
exports.formatPhoneToJid = formatPhoneToJid;
exports.extractPhoneFromJid = extractPhoneFromJid;
exports.sanitizeInput = sanitizeInput;
exports.isValidProfileId = isValidProfileId;
exports.ensureNumber = ensureNumber;
exports.ensureString = ensureString;
exports.truncate = truncate;
exports.generateId = generateId;
exports.sleep = sleep;
exports.withRetry = withRetry;
/**
 * Validate phone number format
 */
function isValidPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string')
        return false;
    // Remove common formatting characters
    const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
    // Check if only digits and has reasonable length (7-15 digits)
    return /^\d{7,15}$/.test(cleaned);
}
/**
 * Validate webhook URL
 */
function isValidWebhookUrl(url) {
    if (!url || typeof url !== 'string')
        return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    }
    catch {
        return false;
    }
}
/**
 * Validate WhatsApp chat ID
 */
function isValidChatId(chatId) {
    if (!chatId || typeof chatId !== 'string')
        return false;
    // Individual chat: number@c.us or number@s.whatsapp.net
    // Group chat: number-number@g.us
    return /^\d+@(c\.us|s\.whatsapp\.net|g\.us)$/.test(chatId) ||
        /^\d+-\d+@g\.us$/.test(chatId);
}
/**
 * Format phone number to WhatsApp chat ID
 */
function formatPhoneToJid(phone) {
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    // If already contains @ it's a JID
    if (phone.includes('@')) {
        return phone;
    }
    return `${cleaned}@c.us`;
}
/**
 * Extract phone number from JID
 */
function extractPhoneFromJid(jid) {
    return jid.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@g.us', '');
}
/**
 * Sanitize text input (remove potentially harmful content)
 */
function sanitizeInput(input) {
    if (!input || typeof input !== 'string')
        return '';
    // Remove null bytes and control characters except newlines/tabs
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
/**
 * Validate profile ID
 */
function isValidProfileId(id) {
    return typeof id === 'number' && Number.isInteger(id) && id > 0;
}
/**
 * Ensure value is a number, with fallback
 */
function ensureNumber(value, fallback = 0) {
    if (typeof value === 'number' && !isNaN(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed))
            return parsed;
    }
    return fallback;
}
/**
 * Ensure value is a string, with fallback
 */
function ensureString(value, fallback = '') {
    if (typeof value === 'string')
        return value;
    if (value === null || value === undefined)
        return fallback;
    return String(value);
}
/**
 * Truncate string to max length with ellipsis
 */
function truncate(str, maxLength) {
    if (!str || str.length <= maxLength)
        return str;
    return str.substring(0, maxLength - 3) + '...';
}
/**
 * Generate unique ID
 */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
/**
 * Sleep utility for async operations
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Retry utility for async operations
 */
async function withRetry(fn, retries = 3, delay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < retries) {
                await sleep(delay * attempt); // Exponential backoff
            }
        }
    }
    throw lastError || new Error('All retry attempts failed');
}
//# sourceMappingURL=validators.js.map