/**
 * Legacy conversationManager.js
 *
 * This file now re-exports from the new modular conversation system
 * to maintain backward compatibility while the codebase migrates.
 */

// Re-export everything from the new modular conversation system
module.exports = require('./core/conversation');

// Add deprecation notice
const logger = require('./logger');
logger.debug('[conversationManager] Using new modular conversation system from core/conversation');
