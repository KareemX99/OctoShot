"use strict";
/**
 * WhatsApp Types
 * Core type definitions for WhatsApp client and message handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClientError = void 0;
class WhatsAppClientError extends Error {
    constructor(code, message, profileId, details) {
        super(message);
        this.name = 'WhatsAppClientError';
        this.code = code;
        this.profileId = profileId;
        this.details = details;
    }
}
exports.WhatsAppClientError = WhatsAppClientError;
//# sourceMappingURL=whatsapp.types.js.map