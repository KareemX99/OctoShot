"use strict";
/**
 * Logger Utility
 * Structured logging with consistent formatting
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.logger = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class Logger {
    formatTimestamp() {
        return new Date().toISOString();
    }
    formatLog(entry) {
        const profilePrefix = entry.profileId ? `[Profile ${entry.profileId}]` : '';
        return `${entry.timestamp} [${entry.level}] ${profilePrefix} ${entry.message}`;
    }
    log(level, message, profileId, metadata) {
        const entry = {
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
    debug(message, profileId, metadata) {
        this.log(LogLevel.DEBUG, message, profileId, metadata);
    }
    info(message, profileId, metadata) {
        this.log(LogLevel.INFO, message, profileId, metadata);
    }
    warn(message, profileId, metadata) {
        this.log(LogLevel.WARN, message, profileId, metadata);
    }
    error(message, profileId, metadata) {
        this.log(LogLevel.ERROR, message, profileId, metadata);
    }
    // Specific log methods for common operations
    webhook(profileId, url, status, details) {
        const emoji = status === 'sent' ? '📤' : '❌';
        this.info(`${emoji} Webhook ${status}: ${url}${details ? ` - ${details}` : ''}`, profileId);
    }
    connection(profileId, event, details) {
        this.info(`🔌 Connection event: ${event}`, profileId, details);
    }
    message(profileId, direction, from, preview) {
        const emoji = direction === 'incoming' ? '📩' : '📤';
        this.info(`${emoji} Message ${direction} from ${from}${preview ? `: ${preview.substring(0, 50)}...` : ''}`, profileId);
    }
}
exports.Logger = Logger;
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map