/**
 * Authentication module exports
 *
 * This module provides a unified authentication system with:
 * - User token management
 * - NSFW verification
 * - AI client creation
 * - Personality access validation
 * - Persistent storage
 */

const AuthManager = require('./AuthManager');
const UserTokenManager = require('./UserTokenManager');
const NsfwVerificationManager = require('./NsfwVerificationManager');
const AIClientFactory = require('./AIClientFactory');
const PersonalityAuthValidator = require('./PersonalityAuthValidator');
const AuthPersistence = require('./AuthPersistence');

// Export the main AuthManager as default
module.exports = AuthManager;

// Also export individual components for testing or advanced usage
module.exports.AuthManager = AuthManager;
module.exports.UserTokenManager = UserTokenManager;
module.exports.NsfwVerificationManager = NsfwVerificationManager;
module.exports.AIClientFactory = AIClientFactory;
module.exports.PersonalityAuthValidator = PersonalityAuthValidator;
module.exports.AuthPersistence = AuthPersistence;

// Export constants
module.exports.TOKEN_EXPIRATION_MS = AuthManager.TOKEN_EXPIRATION_MS;