const logger = require('../../logger');

/**
 * PersonalityValidator - Validates personality data and operations
 * 
 * This class provides validation logic for personality-related operations,
 * ensuring data integrity and business rule compliance.
 */
class PersonalityValidator {
  /**
   * Validate personality data structure
   * @param {Object} personalityData - The personality data to validate
   * @returns {{isValid: boolean, errors: string[]}} Validation result
   */
  validatePersonalityData(personalityData) {
    const errors = [];

    if (!personalityData || typeof personalityData !== 'object') {
      errors.push('Personality data must be an object');
      return { isValid: false, errors };
    }

    // Required fields
    if (!personalityData.fullName || typeof personalityData.fullName !== 'string') {
      errors.push('fullName is required and must be a string');
    }

    if (!personalityData.addedBy || typeof personalityData.addedBy !== 'string') {
      errors.push('addedBy is required and must be a string');
    }

    if (!personalityData.addedAt) {
      errors.push('addedAt is required');
    }

    // Optional fields with type validation
    if (personalityData.displayName !== undefined && typeof personalityData.displayName !== 'string') {
      errors.push('displayName must be a string if provided');
    }

    if (personalityData.avatarUrl !== undefined && typeof personalityData.avatarUrl !== 'string') {
      errors.push('avatarUrl must be a string if provided');
    }

    if (personalityData.activatedChannels !== undefined && !Array.isArray(personalityData.activatedChannels)) {
      errors.push('activatedChannels must be an array if provided');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate personality name format
   * @param {string} name - The personality name to validate
   * @returns {{isValid: boolean, error?: string}} Validation result
   */
  validatePersonalityName(name) {
    if (!name || typeof name !== 'string') {
      return { isValid: false, error: 'Personality name must be a non-empty string' };
    }

    if (name.trim() !== name) {
      return { isValid: false, error: 'Personality name cannot have leading or trailing spaces' };
    }

    if (name.length < 2) {
      return { isValid: false, error: 'Personality name must be at least 2 characters long' };
    }

    if (name.length > 100) {
      return { isValid: false, error: 'Personality name cannot exceed 100 characters' };
    }

    // Check for invalid characters (allowing alphanumeric, spaces, hyphens, underscores, and periods)
    const validNamePattern = /^[a-zA-Z0-9\s\-_.]+$/;
    if (!validNamePattern.test(name)) {
      return { isValid: false, error: 'Personality name contains invalid characters' };
    }

    return { isValid: true };
  }

  /**
   * Validate alias format
   * @param {string} alias - The alias to validate
   * @returns {{isValid: boolean, error?: string}} Validation result
   */
  validateAlias(alias) {
    if (!alias || typeof alias !== 'string') {
      return { isValid: false, error: 'Alias must be a non-empty string' };
    }

    if (alias.trim() !== alias) {
      return { isValid: false, error: 'Alias cannot have leading or trailing spaces' };
    }

    if (alias.length < 1) {
      return { isValid: false, error: 'Alias must be at least 1 character long' };
    }

    if (alias.length > 50) {
      return { isValid: false, error: 'Alias cannot exceed 50 characters' };
    }

    return { isValid: true };
  }

  /**
   * Validate user ID format
   * @param {string} userId - The user ID to validate
   * @returns {{isValid: boolean, error?: string}} Validation result
   */
  validateUserId(userId) {
    if (!userId || typeof userId !== 'string') {
      return { isValid: false, error: 'User ID must be a non-empty string' };
    }

    // Accept both numeric and non-numeric user IDs
    // Discord uses numeric strings, but we support test IDs too
    return { isValid: true };
  }

  /**
   * Check if a personality name is reserved
   * @param {string} name - The personality name to check
   * @returns {boolean} True if reserved, false otherwise
   */
  isReservedName(name) {
    const reservedNames = [
      'system',
      'bot',
      'admin',
      'moderator',
      'everyone',
      'here',
      'null',
      'undefined',
      'true',
      'false'
    ];

    return reservedNames.includes(name.toLowerCase());
  }

  /**
   * Validate personality registration
   * @param {string} fullName - The full name of the personality
   * @param {Object} personalityData - The personality data
   * @param {Object} existingPersonalities - Map of existing personalities
   * @returns {{isValid: boolean, error?: string}} Validation result
   */
  validateRegistration(fullName, personalityData, existingPersonalities) {
    // Validate name
    const nameValidation = this.validatePersonalityName(fullName);
    if (!nameValidation.isValid) {
      return nameValidation;
    }

    // Check reserved names
    if (this.isReservedName(fullName)) {
      return { isValid: false, error: 'This personality name is reserved' };
    }

    // Validate data
    const dataValidation = this.validatePersonalityData(personalityData);
    if (!dataValidation.isValid) {
      return { isValid: false, error: dataValidation.errors.join(', ') };
    }

    // Check if already exists
    if (existingPersonalities && existingPersonalities.has(fullName)) {
      return { isValid: false, error: 'A personality with this name already exists' };
    }

    // Check if fullName matches the one in data
    if (personalityData.fullName !== fullName) {
      return { isValid: false, error: 'Personality fullName must match the registration key' };
    }

    return { isValid: true };
  }

  /**
   * Validate personality removal
   * @param {string} fullName - The full name of the personality
   * @param {string} requestingUserId - The ID of the user requesting removal
   * @param {Object} personality - The personality object
   * @returns {{isValid: boolean, error?: string}} Validation result
   */
  validateRemoval(fullName, requestingUserId, personality) {
    if (!personality) {
      return { isValid: false, error: 'Personality not found' };
    }

    // Only the user who added the personality or a bot owner can remove it
    if (personality.addedBy !== requestingUserId && !this.isBotOwner(requestingUserId)) {
      return { isValid: false, error: 'You can only remove personalities you added' };
    }

    return { isValid: true };
  }

  /**
   * Check if a user is a bot owner
   * @param {string} userId - The user ID to check
   * @returns {boolean} True if bot owner, false otherwise
   */
  isBotOwner(userId) {
    // Check environment variable
    if (process.env.BOT_OWNER_ID && process.env.BOT_OWNER_ID === userId) {
      return true;
    }
    
    // For backward compatibility, also check constants.USER_CONFIG.OWNER_ID
    try {
      const constants = require('../../constants');
      if (constants.USER_CONFIG && constants.USER_CONFIG.OWNER_ID === userId) {
        return true;
      }
    } catch (_error) { // eslint-disable-line no-unused-vars
      // Constants might not be available in all contexts
    }
    
    return false;
  }

  /**
   * Sanitize personality data for safe storage
   * @param {Object} personalityData - The personality data to sanitize
   * @returns {Object} Sanitized personality data
   */
  sanitizePersonalityData(personalityData) {
    const sanitized = { ...personalityData };

    // Trim string fields
    if (sanitized.fullName) sanitized.fullName = sanitized.fullName.trim();
    if (sanitized.displayName) sanitized.displayName = sanitized.displayName.trim();
    if (sanitized.avatarUrl) sanitized.avatarUrl = sanitized.avatarUrl.trim();

    // Ensure arrays are arrays
    if (sanitized.activatedChannels && !Array.isArray(sanitized.activatedChannels)) {
      sanitized.activatedChannels = [];
    }

    // Remove any unexpected fields
    const allowedFields = [
      'fullName',
      'addedBy',
      'addedAt',
      'displayName',
      'avatarUrl',
      'activatedChannels'
    ];

    Object.keys(sanitized).forEach(key => {
      if (!allowedFields.includes(key)) {
        delete sanitized[key];
        logger.debug(`[PersonalityValidator] Removed unexpected field: ${key}`);
      }
    });

    return sanitized;
  }
}

module.exports = PersonalityValidator;