const logger = require('../../logger');

/**
 * PersonalityRegistry - Manages in-memory storage of personalities and aliases
 *
 * This class provides the core registry functionality for personalities,
 * maintaining both the personality data and their aliases in memory.
 */
class PersonalityRegistry {
  constructor() {
    this.personalities = new Map();
    this.aliases = new Map(); // Store aliases in lowercase for case-insensitive matching
    this._maxAliasWordCount = null; // Track the maximum word count across all aliases
  }

  /**
   * Get the maximum alias word count, calculating it if necessary
   * @returns {number} The maximum word count
   */
  get maxAliasWordCount() {
    // Lazy initialization - calculate on first access if not set
    if (this._maxAliasWordCount === null) {
      this.updateMaxWordCount();
    }
    return this._maxAliasWordCount || 1;
  }

  /**
   * Set the maximum alias word count
   * @param {number} value - The new max word count
   */
  set maxAliasWordCount(value) {
    this._maxAliasWordCount = value;
  }

  /**
   * Register a new personality in the registry
   * @param {string} fullName - The full name of the personality
   * @param {Object} personalityData - The personality data object
   * @returns {boolean} True if registered successfully, false if already exists
   */
  register(fullName, personalityData) {
    if (this.personalities.has(fullName)) {
      logger.warn(`[PersonalityRegistry] Personality ${fullName} already exists`);
      return false;
    }

    this.personalities.set(fullName, personalityData);
    logger.debug(`[PersonalityRegistry] Registered personality: ${fullName}`);
    return true;
  }

  /**
   * Get a personality by full name
   * @param {string} fullName - The full name of the personality
   * @returns {Object|null} The personality data or null if not found
   */
  get(fullName) {
    return this.personalities.get(fullName) || null;
  }

  /**
   * Remove a personality from the registry
   * @param {string} fullName - The full name of the personality
   * @returns {boolean} True if removed successfully, false if not found
   */
  remove(fullName) {
    if (!this.personalities.has(fullName)) {
      return false;
    }

    // Remove the personality
    this.personalities.delete(fullName);

    // Check if any aliases being removed have the max word count
    let needsMaxUpdate = false;
    
    // Remove all aliases pointing to this personality
    const aliasesToRemove = [];
    for (const [alias, targetName] of this.aliases.entries()) {
      if (targetName === fullName) {
        aliasesToRemove.push(alias);
        // Check if this alias has max word count
        if (this.getWordCount(alias) >= (this._maxAliasWordCount || 0)) {
          needsMaxUpdate = true;
        }
      }
    }
    aliasesToRemove.forEach(alias => this.aliases.delete(alias));

    // Recalculate max word count if needed
    if (needsMaxUpdate) {
      this.updateMaxWordCount();
    }

    logger.debug(
      `[PersonalityRegistry] Removed personality: ${fullName} and ${aliasesToRemove.length} aliases`
    );
    return true;
  }

  /**
   * Check if a personality exists
   * @param {string} fullName - The full name of the personality
   * @returns {boolean} True if exists, false otherwise
   */
  has(fullName) {
    return this.personalities.has(fullName);
  }

  /**
   * Get all personalities for a specific user
   * @param {string} userId - The user ID to filter by
   * @returns {Array<Object>} Array of personality objects for the user
   */
  getByUser(userId) {
    const userPersonalities = [];
    for (const [fullName, personality] of this.personalities.entries()) {
      if (personality.addedBy === userId) {
        userPersonalities.push({ fullName, ...personality });
      }
    }
    return userPersonalities;
  }

  /**
   * Calculate the word count for an alias
   * @param {string} alias - The alias to count words for
   * @returns {number} The number of words in the alias
   */
  getWordCount(alias) {
    return alias.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Update the maximum alias word count
   * @private
   */
  updateMaxWordCount() {
    let max = 1;
    for (const alias of this.aliases.keys()) {
      const wordCount = this.getWordCount(alias);
      if (wordCount > max) {
        max = wordCount;
      }
    }
    this._maxAliasWordCount = max;
    logger.debug(`[PersonalityRegistry] Updated max alias word count to: ${max}`);
  }

  /**
   * Set an alias for a personality
   * @param {string} alias - The alias to set
   * @param {string} fullName - The full name of the personality
   * @returns {boolean} True if set successfully, false if personality doesn't exist
   */
  setAlias(alias, fullName) {
    if (!this.personalities.has(fullName)) {
      logger.warn(
        `[PersonalityRegistry] Cannot set alias for non-existent personality: ${fullName}`
      );
      return false;
    }

    // Convert alias to lowercase for case-insensitive storage
    const lowerAlias = alias.toLowerCase();

    // Check if alias already exists
    const existingTarget = this.aliases.get(lowerAlias);
    if (existingTarget) {
      if (existingTarget === fullName) {
        logger.info(`Alias ${alias} already points to ${fullName} - no changes needed`);
        return true;
      } else {
        logger.info(
          `[PersonalityRegistry] Alias ${alias} reassigned from ${existingTarget} to ${fullName}`
        );
      }
    }

    // Store in lowercase for case-insensitive matching
    this.aliases.set(lowerAlias, fullName);
    
    // Update max word count if this alias has more words
    const wordCount = this.getWordCount(alias);
    if (wordCount > (this._maxAliasWordCount || 0)) {
      this._maxAliasWordCount = wordCount;
      logger.debug(`[PersonalityRegistry] New max alias word count: ${wordCount} (from alias: ${alias})`);
    }
    
    logger.debug(`[PersonalityRegistry] Set alias ${alias} -> ${fullName}`);
    return true;
  }

  /**
   * Get a personality by alias
   * @param {string} alias - The alias to look up
   * @returns {Object|null} The personality data or null if not found
   */
  getByAlias(alias) {
    // Always do case-insensitive lookup
    const fullName = this.aliases.get(alias.toLowerCase());
    if (!fullName) {
      return null;
    }
    return this.get(fullName);
  }

  /**
   * Remove an alias
   * @param {string} alias - The alias to remove
   * @returns {boolean} True if removed successfully, false if not found
   */
  removeAlias(alias) {
    const lowerAlias = alias.toLowerCase();
    const removed = this.aliases.delete(lowerAlias);
    
    if (removed) {
      // Check if we removed an alias with the max word count
      const removedWordCount = this.getWordCount(alias);
      if (removedWordCount >= (this._maxAliasWordCount || 0)) {
        // Recalculate max word count
        this.updateMaxWordCount();
      }
    }
    
    return removed;
  }

  /**
   * Get all aliases for a personality
   * @param {string} fullName - The full name of the personality
   * @returns {Array<string>} Array of aliases for the personality
   */
  getAliases(fullName) {
    const aliases = [];
    for (const [alias, targetName] of this.aliases.entries()) {
      if (targetName === fullName) {
        aliases.push(alias);
      }
    }
    return aliases;
  }

  /**
   * Clear all data from the registry
   */
  clear() {
    this.personalities.clear();
    this.aliases.clear();
    this._maxAliasWordCount = null; // Reset to null for lazy recalculation
    logger.info('[PersonalityRegistry] Cleared all personalities and aliases');
  }

  /**
   * Get the total count of registered personalities
   * @returns {number} The number of personalities
   */
  get size() {
    return this.personalities.size;
  }

  /**
   * Get all personalities as an array
   * @returns {Array<Object>} Array of all personality objects
   */
  getAll() {
    const all = [];
    for (const [fullName, personality] of this.personalities.entries()) {
      all.push({ fullName, ...personality });
    }
    return all;
  }

  /**
   * Load personalities from a plain object (for deserialization)
   * @param {Object} personalitiesObj - Object with personality data
   * @param {Object} aliasesObj - Object with alias data
   */
  loadFromObjects(personalitiesObj, aliasesObj) {
    // Clear existing data
    this.clear();

    // Load personalities
    if (personalitiesObj) {
      for (const [key, value] of Object.entries(personalitiesObj)) {
        // Skip entries where key doesn't match fullName (data integrity check)
        if (key !== value.fullName) {
          logger.warn(
            `[PersonalityRegistry] Skipping mismatched entry: key=${key}, fullName=${value.fullName}`
          );
          continue;
        }
        this.personalities.set(key, value);
      }
    }

    // Load aliases and track max word count
    let maxWords = 1;
    if (aliasesObj) {
      for (const [alias, fullName] of Object.entries(aliasesObj)) {
        // Only set alias if the personality exists
        if (this.personalities.has(fullName)) {
          this.aliases.set(alias.toLowerCase(), fullName);
          // Track max word count while loading
          const wordCount = this.getWordCount(alias);
          if (wordCount > maxWords) {
            maxWords = wordCount;
          }
        } else {
          logger.warn(
            `[PersonalityRegistry] Skipping alias ${alias} -> ${fullName} (personality not found)`
          );
        }
      }
    }
    
    // Set the max word count
    this._maxAliasWordCount = maxWords;

    logger.info(
      `[PersonalityRegistry] Loaded ${this.personalities.size} personalities and ${this.aliases.size} aliases (max ${this.maxAliasWordCount} words)`
    );
  }

  /**
   * Export data as plain objects (for serialization)
   * @returns {{personalities: Object, aliases: Object}} Plain objects for storage
   */
  exportToObjects() {
    const personalities = {};
    for (const [key, value] of this.personalities.entries()) {
      personalities[key] = value;
    }

    const aliases = {};
    for (const [key, value] of this.aliases.entries()) {
      aliases[key] = value;
    }

    return { personalities, aliases };
  }
}

module.exports = PersonalityRegistry;
