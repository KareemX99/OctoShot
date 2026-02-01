/**
 * Validators Utility
 * Runtime validation functions for external data
 */

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone: string): boolean {
    if (!phone || typeof phone !== 'string') return false;

    // Remove common formatting characters
    const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');

    // Check if only digits and has reasonable length (7-15 digits)
    return /^\d{7,15}$/.test(cleaned);
}

/**
 * Validate webhook URL
 */
export function isValidWebhookUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;

    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Validate WhatsApp chat ID
 */
export function isValidChatId(chatId: string): boolean {
    if (!chatId || typeof chatId !== 'string') return false;

    // Individual chat: number@c.us or number@s.whatsapp.net
    // Group chat: number-number@g.us
    return /^\d+@(c\.us|s\.whatsapp\.net|g\.us)$/.test(chatId) ||
        /^\d+-\d+@g\.us$/.test(chatId);
}

/**
 * Format phone number to WhatsApp chat ID
 */
export function formatPhoneToJid(phone: string): string {
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
export function extractPhoneFromJid(jid: string): string {
    return jid.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@g.us', '');
}

/**
 * Sanitize text input (remove potentially harmful content)
 */
export function sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') return '';

    // Remove null bytes and control characters except newlines/tabs
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Validate profile ID
 */
export function isValidProfileId(id: unknown): id is number {
    return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

/**
 * Ensure value is a number, with fallback
 */
export function ensureNumber(value: unknown, fallback: number = 0): number {
    if (typeof value === 'number' && !isNaN(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed)) return parsed;
    }
    return fallback;
}

/**
 * Ensure value is a string, with fallback
 */
export function ensureString(value: unknown, fallback: string = ''): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return fallback;
    return String(value);
}

/**
 * Truncate string to max length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
}

/**
 * Generate unique ID
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sleep utility for async operations
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry utility for async operations
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    retries: number = 3,
    delay: number = 1000
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < retries) {
                await sleep(delay * attempt); // Exponential backoff
            }
        }
    }

    throw lastError || new Error('All retry attempts failed');
}
