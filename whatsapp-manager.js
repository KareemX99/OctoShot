/**
 * WhatsApp Manager - Backward Compatibility Wrapper
 * 
 * This file provides backward compatibility with existing require('./whatsapp-manager')
 * by re-exporting the TypeScript implementation from dist/
 */

// Import the compiled TypeScript module
const { default: whatsappManager } = require('./dist/services/WhatsAppClientManager');

// Export for CommonJS compatibility
module.exports = whatsappManager;
