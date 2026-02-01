/**
 * Validators Utility
 * Runtime validation functions for external data
 */
/**
 * Validate phone number format
 */
export declare function isValidPhoneNumber(phone: string): boolean;
/**
 * Validate webhook URL
 */
export declare function isValidWebhookUrl(url: string): boolean;
/**
 * Validate WhatsApp chat ID
 */
export declare function isValidChatId(chatId: string): boolean;
/**
 * Format phone number to WhatsApp chat ID
 */
export declare function formatPhoneToJid(phone: string): string;
/**
 * Extract phone number from JID
 */
export declare function extractPhoneFromJid(jid: string): string;
/**
 * Sanitize text input (remove potentially harmful content)
 */
export declare function sanitizeInput(input: string): string;
/**
 * Validate profile ID
 */
export declare function isValidProfileId(id: unknown): id is number;
/**
 * Ensure value is a number, with fallback
 */
export declare function ensureNumber(value: unknown, fallback?: number): number;
/**
 * Ensure value is a string, with fallback
 */
export declare function ensureString(value: unknown, fallback?: string): string;
/**
 * Truncate string to max length with ellipsis
 */
export declare function truncate(str: string, maxLength: number): string;
/**
 * Generate unique ID
 */
export declare function generateId(): string;
/**
 * Sleep utility for async operations
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Retry utility for async operations
 */
export declare function withRetry<T>(fn: () => Promise<T>, retries?: number, delay?: number): Promise<T>;
//# sourceMappingURL=validators.d.ts.map