/**
 * Webhook Types
 * Type definitions for webhook payloads and responses
 */

import { Profile, ReplyInfo, WhatsAppMessage } from './whatsapp.types';

// ============================================
// Webhook Payload Types
// ============================================

export interface WebhookPayload {
    // Core identifiers
    deviceId: number;
    userId: number;
    messageId: string;

    // Sender info
    from: string;  // formatted jid
    sender?: string;  // for groups
    pushName: string;
    profilePicUrl: string | null;

    // Message content
    type: string;
    content: string;
    timestamp: string;

    // Media
    mediaUrl: string | null;
    mediaUrlOgg?: string | null;
    mediaUrlMp3?: string | null;

    // Reply/quote info
    reply: ReplyInfo | null;

    // Context
    source: 'regular' | 'advertisement';
    isFromAdvertisement: boolean;
    isGroup: boolean;
    groupName: string | null;

    // Raw WhatsApp data
    rawParticipant: string;
    rawRemoteJid: string;
    remoteJidAlt: string | null;
    advertisementJid: string | null;

    // Profile info
    profile: {
        id: number;
        uuid: string;
        device_name: string;
        phone_number?: string;
    };

    // Full message object
    msg: {
        id: string;
        body: string;
        type: string;
        timestamp: number;
        fromMe: boolean;
        hasMedia: boolean;
        isForwarded: boolean;
        hasQuotedMsg: boolean;
        vCards: string[];
        mentionedIds: string[];
        links: string[];
    };
}

// ============================================
// Webhook Response Types
// ============================================

export interface WebhookResponse {
    success: boolean;
    status: number;
    responseBody?: string;
    error?: string;
    duration?: number;
}

export interface WebhookDeliveryResult {
    success: boolean;
    status?: number;
    attempts: number;
    lastAttemptAt: Date;
    error?: string;
    responseBody?: string;
}

// ============================================
// Webhook Configuration Types
// ============================================

export interface WebhookConfig {
    url: string;
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    headers?: Record<string, string>;
}

export const DEFAULT_WEBHOOK_CONFIG: Partial<WebhookConfig> = {
    timeout: 10000,
    retries: 3,
    retryDelay: 1000,
    headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OctoSHOT-WhatsApp/2.0'
    }
};

// ============================================
// Webhook Error Types
// ============================================

export type WebhookErrorCode =
    | 'INVALID_URL'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'SERVER_ERROR'
    | 'CLIENT_ERROR'
    | 'UNKNOWN_ERROR';

export interface WebhookError {
    code: WebhookErrorCode;
    message: string;
    url: string;
    statusCode?: number;
    details?: Record<string, unknown>;
}

export class WebhookDeliveryError extends Error {
    code: WebhookErrorCode;
    url: string;
    statusCode?: number;
    details?: Record<string, unknown>;

    constructor(
        code: WebhookErrorCode,
        message: string,
        url: string,
        statusCode?: number,
        details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'WebhookDeliveryError';
        this.code = code;
        this.url = url;
        this.statusCode = statusCode;
        this.details = details;
    }
}

// ============================================
// Webhook Queue Types (for retry logic)
// ============================================

export interface QueuedWebhook {
    id: string;
    url: string;
    payload: WebhookPayload;
    attempts: number;
    maxAttempts: number;
    nextAttemptAt: Date;
    createdAt: Date;
    lastError?: string;
}

// ============================================
// Webhook Logger Types
// ============================================

export interface WebhookLogEntry {
    profileId: number;
    url: string;
    payload: WebhookPayload;
    response: WebhookResponse;
    timestamp: Date;
    duration: number;
    correlationId: string;
}
