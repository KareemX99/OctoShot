/**
 * WhatsApp Types
 * Core type definitions for WhatsApp client and message handling
 */
import { Client } from 'whatsapp-web.js';
export type ProfileStatus = 'disconnected' | 'initializing' | 'qr' | 'authenticated' | 'connected' | 'error';
export interface ClientInfo {
    pushname?: string;
    platform?: string;
    phoneNumber?: string;
    wid?: {
        user: string;
        server: string;
        _serialized: string;
    };
}
export interface ClientData {
    client: Client;
    qrCode: string | null;
    status: ProfileStatus;
    connected: boolean;
    info: ClientInfo | null;
    connectedAt: number | null;
    profileId: number;
}
export interface ClientStatus {
    status: ProfileStatus;
    connected: boolean;
    qrCode: string | null;
    info: ClientInfo | null;
}
export interface MessageId {
    id: string;
    remote: string;
    fromMe: boolean;
    _serialized: string;
}
export interface WhatsAppMessage {
    id: MessageId;
    body: string;
    type: string;
    timestamp: number;
    from: string;
    to: string;
    author?: string;
    fromMe: boolean;
    hasMedia: boolean;
    isForwarded: boolean;
    hasQuotedMsg: boolean;
    vCards: string[];
    mentionedIds: string[];
    links: string[];
}
export interface MessageResult {
    success: boolean;
    messageId?: string;
    timestamp?: number;
    to?: string;
    error?: string;
}
export interface ContactInfo {
    id: string;
    number: string;
    name: string;
    pushname?: string;
    isGroup: boolean;
    isMyContact: boolean;
    isBusiness: boolean;
    profilePicUrl?: string;
}
export interface ChatInfo {
    id: string;
    name: string;
    isGroup: boolean;
    isReadOnly: boolean;
    unreadCount: number;
    timestamp: number;
    lastMessage?: string;
}
export interface MediaInfo {
    mimetype: string;
    data: string;
    filename?: string;
    filesize?: number;
}
export interface DownloadedMedia {
    url: string;
    urlMp3?: string;
    urlOgg?: string;
    type: string;
    mimetype: string;
}
export interface ReplyInfo {
    type: string;
    messageId: string;
    from: string;
    content: string;
}
export interface Profile {
    id: number;
    uuid: string;
    device_name: string;
    phone_number?: string;
    webhook_url?: string;
    api_key?: string;
    status: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface QREvent {
    profileId: number;
    qrCode: string;
}
export interface StatusEvent {
    profileId: number;
    status: ProfileStatus;
}
export interface AuthenticatedEvent {
    profileId: number;
    info: ClientInfo;
}
export interface ReadyEvent {
    profileId: number;
    connected: boolean;
    info: ClientInfo;
    phone_number?: string;
}
export interface LoadingEvent {
    profileId: number;
    percent: number;
    message: string;
}
export interface DisconnectedEvent {
    profileId: number;
    reason: string;
}
export interface WhatsAppError {
    code: string;
    message: string;
    profileId?: number;
    details?: Record<string, unknown>;
}
export declare class WhatsAppClientError extends Error {
    code: string;
    profileId?: number;
    details?: Record<string, unknown>;
    constructor(code: string, message: string, profileId?: number, details?: Record<string, unknown>);
}
//# sourceMappingURL=whatsapp.types.d.ts.map