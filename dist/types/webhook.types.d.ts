/**
 * Webhook Types
 * Type definitions for webhook payloads and responses
 */
import { ReplyInfo } from './whatsapp.types';
export interface WebhookPayload {
    deviceId: number;
    userId: number;
    messageId: string;
    from: string;
    sender?: string;
    pushName: string;
    profilePicUrl: string | null;
    type: string;
    content: string;
    timestamp: string;
    mediaUrl: string | null;
    mediaUrlOgg?: string | null;
    mediaUrlMp3?: string | null;
    reply: ReplyInfo | null;
    source: 'regular' | 'advertisement';
    isFromAdvertisement: boolean;
    isGroup: boolean;
    groupName: string | null;
    rawParticipant: string;
    rawRemoteJid: string;
    remoteJidAlt: string | null;
    advertisementJid: string | null;
    profile: {
        id: number;
        uuid: string;
        device_name: string;
        phone_number?: string;
    };
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
export interface WebhookConfig {
    url: string;
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    headers?: Record<string, string>;
}
export declare const DEFAULT_WEBHOOK_CONFIG: Partial<WebhookConfig>;
export type WebhookErrorCode = 'INVALID_URL' | 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'SERVER_ERROR' | 'CLIENT_ERROR' | 'UNKNOWN_ERROR';
export interface WebhookError {
    code: WebhookErrorCode;
    message: string;
    url: string;
    statusCode?: number;
    details?: Record<string, unknown>;
}
export declare class WebhookDeliveryError extends Error {
    code: WebhookErrorCode;
    url: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    constructor(code: WebhookErrorCode, message: string, url: string, statusCode?: number, details?: Record<string, unknown>);
}
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
export interface WebhookLogEntry {
    profileId: number;
    url: string;
    payload: WebhookPayload;
    response: WebhookResponse;
    timestamp: Date;
    duration: number;
    correlationId: string;
}
//# sourceMappingURL=webhook.types.d.ts.map