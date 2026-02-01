/**
 * OctoShot WhatsApp Manager - TypeScript Edition
 * Main entry point with backward-compatible exports
 */

// Re-export types
export * from './types';

// Re-export utils
export * from './utils';

// Re-export services
export * from './services';

// Default export for backward compatibility with existing require('./whatsapp-manager')
import whatsappManager from './services/WhatsAppClientManager';
export default whatsappManager;
