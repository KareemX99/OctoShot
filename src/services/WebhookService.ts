/**
 * WebhookService
 * Reliable webhook delivery service with retry logic and error handling
 */

import {
    WebhookPayload,
    WebhookResponse,
    WebhookDeliveryResult,
    WebhookConfig,
    DEFAULT_WEBHOOK_CONFIG,
    WebhookDeliveryError,
    WebhookErrorCode
} from '../types';

class WebhookService {
    private config: WebhookConfig;

    constructor(config?: Partial<WebhookConfig>) {
        this.config = {
            url: '',
            ...DEFAULT_WEBHOOK_CONFIG,
            ...config
        };
    }

    /**
     * Send webhook with automatic retry on failure
     */
    async sendWithRetry(
        url: string,
        payload: WebhookPayload,
        retries: number = this.config.retries || 3
    ): Promise<WebhookDeliveryResult> {
        const startTime = Date.now();
        let lastError: string | undefined;
        let attempts = 0;

        for (let attempt = 1; attempt <= retries; attempt++) {
            attempts = attempt;

            try {
                const response = await this.send(url, payload);

                if (response.success) {
                    console.log(`✅ [WebhookService] Delivered to ${url} (attempt ${attempt}/${retries})`);
                    return {
                        success: true,
                        status: response.status,
                        attempts,
                        lastAttemptAt: new Date(),
                        responseBody: response.responseBody
                    };
                }

                // 4xx errors - don't retry (client error)
                if (response.status >= 400 && response.status < 500) {
                    console.error(`❌ [WebhookService] Client error ${response.status} - not retrying`);
                    return {
                        success: false,
                        status: response.status,
                        attempts,
                        lastAttemptAt: new Date(),
                        error: response.error || `HTTP ${response.status}`
                    };
                }

                lastError = response.error || `HTTP ${response.status}`;

            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                console.error(`⚠️ [WebhookService] Attempt ${attempt}/${retries} failed: ${lastError}`);
            }

            // Wait before retry (exponential backoff)
            if (attempt < retries) {
                const delay = (this.config.retryDelay || 1000) * Math.pow(2, attempt - 1);
                console.log(`⏳ [WebhookService] Retrying in ${delay}ms...`);
                await this.sleep(delay);
            }
        }

        console.error(`❌ [WebhookService] All ${retries} attempts failed for ${url}`);
        return {
            success: false,
            attempts,
            lastAttemptAt: new Date(),
            error: lastError || 'All retry attempts failed'
        };
    }

    /**
     * Send a single webhook request
     */
    async send(url: string, payload: WebhookPayload): Promise<WebhookResponse> {
        const startTime = Date.now();

        // Validate URL
        if (!this.isValidUrl(url)) {
            return {
                success: false,
                status: 0,
                error: 'Invalid webhook URL'
            };
        }

        try {
            // Dynamic import for node-fetch (ESM module)
            const fetch = (await import('node-fetch')).default;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeout || 10000);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'OctoSHOT-WhatsApp/2.0',
                    'X-Correlation-ID': this.generateCorrelationId(),
                    ...this.config.headers
                },
                body: JSON.stringify(payload),
                signal: controller.signal as any
            });

            clearTimeout(timeoutId);

            const duration = Date.now() - startTime;
            const responseBody = await response.text();

            if (response.ok) {
                console.log(`📤 [WebhookService] Sent to ${url} (${duration}ms)`);
                return {
                    success: true,
                    status: response.status,
                    responseBody: responseBody.substring(0, 500),
                    duration
                };
            } else {
                console.error(`❌ [WebhookService] HTTP ${response.status}: ${responseBody.substring(0, 200)}`);
                return {
                    success: false,
                    status: response.status,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                    responseBody: responseBody.substring(0, 500),
                    duration
                };
            }

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Determine error type
            let errorCode: WebhookErrorCode = 'UNKNOWN_ERROR';
            if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
                errorCode = 'TIMEOUT';
            } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
                errorCode = 'NETWORK_ERROR';
            }

            console.error(`❌ [WebhookService] Error: ${errorMessage} (${duration}ms)`);

            return {
                success: false,
                status: 0,
                error: errorMessage,
                duration
            };
        }
    }

    /**
     * Validate webhook URL format
     */
    isValidUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    /**
     * Validate webhook payload has required fields
     */
    validatePayload(payload: Partial<WebhookPayload>): payload is WebhookPayload {
        const requiredFields: (keyof WebhookPayload)[] = [
            'deviceId',
            'messageId',
            'from',
            'type',
            'content',
            'timestamp'
        ];

        for (const field of requiredFields) {
            if (payload[field] === undefined || payload[field] === null) {
                console.warn(`⚠️ [WebhookService] Missing required field: ${field}`);
                return false;
            }
        }

        return true;
    }

    /**
     * Generate correlation ID for request tracking
     */
    private generateCorrelationId(): string {
        return `octo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Sleep utility for retry delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
export const webhookService = new WebhookService();
export { WebhookService };
