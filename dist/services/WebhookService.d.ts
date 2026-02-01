/**
 * WebhookService
 * Reliable webhook delivery service with retry logic and error handling
 */
import { WebhookPayload, WebhookResponse, WebhookDeliveryResult, WebhookConfig } from '../types';
declare class WebhookService {
    private config;
    constructor(config?: Partial<WebhookConfig>);
    /**
     * Send webhook with automatic retry on failure
     */
    sendWithRetry(url: string, payload: WebhookPayload, retries?: number): Promise<WebhookDeliveryResult>;
    /**
     * Send a single webhook request
     */
    send(url: string, payload: WebhookPayload): Promise<WebhookResponse>;
    /**
     * Validate webhook URL format
     */
    isValidUrl(url: string): boolean;
    /**
     * Validate webhook payload has required fields
     */
    validatePayload(payload: Partial<WebhookPayload>): payload is WebhookPayload;
    /**
     * Generate correlation ID for request tracking
     */
    private generateCorrelationId;
    /**
     * Sleep utility for retry delays
     */
    private sleep;
}
export declare const webhookService: WebhookService;
export { WebhookService };
//# sourceMappingURL=WebhookService.d.ts.map