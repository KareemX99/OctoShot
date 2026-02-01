/**
 * WhatsAppClientManager
 * Main class managing all WhatsApp client instances with full TypeScript support
 */
import { Client } from 'whatsapp-web.js';
import { Server as SocketIOServer } from 'socket.io';
import { ClientData, ClientStatus, MessageResult } from '../types';
declare class WhatsAppClientManager {
    private clients;
    private io;
    private readonly BASE_URL;
    private readonly SESSION_PATH;
    /**
     * Set Socket.IO instance for real-time communication
     */
    setSocketIO(io: SocketIOServer): void;
    /**
     * Emit event to specific profile's socket room
     */
    private emitToProfile;
    /**
     * Check if client exists for profile
     */
    hasClient(profileId: number): boolean;
    /**
     * Get WhatsApp client instance
     */
    getClient(profileId: number): Client | null;
    /**
     * Get status for a specific profile
     */
    getStatus(profileId: number): ClientStatus;
    /**
     * Get status of all clients
     */
    getAllStatus(): Record<number, ClientStatus>;
    /**
     * Update client status
     */
    private updateStatus;
    /**
     * Create new WhatsApp client for profile
     */
    createClient(profileId: number): Promise<ClientData>;
    /**
     * Setup all event handlers for client
     */
    private setupClientEvents;
    /**
     * Handle incoming message
     */
    private handleIncomingMessage;
    /**
     * Send message
     */
    sendMessage(profileId: number, phoneNumber: string, message: string): Promise<MessageResult>;
    /**
     * Destroy client
     */
    destroyClient(profileId: number): Promise<void>;
    /**
     * Auto-restore previously connected sessions
     */
    autoRestoreSessions(): Promise<void>;
}
declare const whatsappManager: WhatsAppClientManager;
export default whatsappManager;
export { WhatsAppClientManager };
//# sourceMappingURL=WhatsAppClientManager.d.ts.map