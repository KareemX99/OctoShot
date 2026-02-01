"use strict";
/**
 * Webhook Types
 * Type definitions for webhook payloads and responses
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookDeliveryError = exports.DEFAULT_WEBHOOK_CONFIG = void 0;
exports.DEFAULT_WEBHOOK_CONFIG = {
    timeout: 10000,
    retries: 3,
    retryDelay: 1000,
    headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OctoSHOT-WhatsApp/2.0'
    }
};
class WebhookDeliveryError extends Error {
    constructor(code, message, url, statusCode, details) {
        super(message);
        this.name = 'WebhookDeliveryError';
        this.code = code;
        this.url = url;
        this.statusCode = statusCode;
        this.details = details;
    }
}
exports.WebhookDeliveryError = WebhookDeliveryError;
//# sourceMappingURL=webhook.types.js.map