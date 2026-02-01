/**
 * Logger Utility
 * Structured logging with consistent formatting
 */
export declare enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR"
}
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    profileId?: number;
    message: string;
    metadata?: Record<string, unknown>;
}
declare class Logger {
    private formatTimestamp;
    private formatLog;
    private log;
    debug(message: string, profileId?: number, metadata?: Record<string, unknown>): void;
    info(message: string, profileId?: number, metadata?: Record<string, unknown>): void;
    warn(message: string, profileId?: number, metadata?: Record<string, unknown>): void;
    error(message: string, profileId?: number, metadata?: Record<string, unknown>): void;
    webhook(profileId: number, url: string, status: 'sent' | 'failed', details?: string): void;
    connection(profileId: number, event: string, details?: Record<string, unknown>): void;
    message(profileId: number, direction: 'incoming' | 'outgoing', from: string, preview?: string): void;
}
export declare const logger: Logger;
export { Logger };
//# sourceMappingURL=logger.d.ts.map