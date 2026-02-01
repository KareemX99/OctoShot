/**
 * Logger Utility
 * Structured logging with consistent formatting
 */

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR'
}

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    profileId?: number;
    message: string;
    metadata?: Record<string, unknown>;
}

class Logger {
    private formatTimestamp(): string {
        return new Date().toISOString();
    }

    private formatLog(entry: LogEntry): string {
        const profilePrefix = entry.profileId ? `[Profile ${entry.profileId}]` : '';
        return `${entry.timestamp} [${entry.level}] ${profilePrefix} ${entry.message}`;
    }

    private log(level: LogLevel, message: string, profileId?: number, metadata?: Record<string, unknown>): void {
        const entry: LogEntry = {
            timestamp: this.formatTimestamp(),
            level,
            profileId,
            message,
            metadata
        };

        const formattedMessage = this.formatLog(entry);

        switch (level) {
            case LogLevel.DEBUG:
                console.debug(formattedMessage, metadata ? metadata : '');
                break;
            case LogLevel.INFO:
                console.log(formattedMessage, metadata ? metadata : '');
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage, metadata ? metadata : '');
                break;
            case LogLevel.ERROR:
                console.error(formattedMessage, metadata ? metadata : '');
                break;
        }
    }

    debug(message: string, profileId?: number, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.DEBUG, message, profileId, metadata);
    }

    info(message: string, profileId?: number, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.INFO, message, profileId, metadata);
    }

    warn(message: string, profileId?: number, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.WARN, message, profileId, metadata);
    }

    error(message: string, profileId?: number, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.ERROR, message, profileId, metadata);
    }

    // Specific log methods for common operations
    webhook(profileId: number, url: string, status: 'sent' | 'failed', details?: string): void {
        const emoji = status === 'sent' ? '📤' : '❌';
        this.info(`${emoji} Webhook ${status}: ${url}${details ? ` - ${details}` : ''}`, profileId);
    }

    connection(profileId: number, event: string, details?: Record<string, unknown>): void {
        this.info(`🔌 Connection event: ${event}`, profileId, details);
    }

    message(profileId: number, direction: 'incoming' | 'outgoing', from: string, preview?: string): void {
        const emoji = direction === 'incoming' ? '📩' : '📤';
        this.info(`${emoji} Message ${direction} from ${from}${preview ? `: ${preview.substring(0, 50)}...` : ''}`, profileId);
    }
}

export const logger = new Logger();
export { Logger };
