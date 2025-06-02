/**
 * Personality Module
 *
 * This module provides personality management functionality for the Tzurot bot.
 * It follows a layered architecture with clear separation of concerns:
 *
 * - PersonalityManager: Main facade providing the public API
 * - PersonalityRegistry: In-memory storage and retrieval
 * - PersonalityPersistence: File-based persistence layer
 * - PersonalityValidator: Business rule validation
 */

const personalityManager = require('./PersonalityManager');

// Export the singleton instance as the default export
module.exports = personalityManager;

// Also export for destructuring if needed
module.exports.personalityManager = personalityManager;

// Export classes for testing or advanced use cases
module.exports.PersonalityRegistry = require('./PersonalityRegistry');
module.exports.PersonalityPersistence = require('./PersonalityPersistence');
module.exports.PersonalityValidator = require('./PersonalityValidator');
