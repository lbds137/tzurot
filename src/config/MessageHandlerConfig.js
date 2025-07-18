/**
 * MessageHandlerConfig
 *
 * Configuration provider for message handling components.
 * This breaks the circular dependency by providing configuration
 * without requiring access to the full ApplicationBootstrap.
 */
class MessageHandlerConfig {
  constructor() {
    this._maxAliasWordCount = 5; // Safe default
    this._initialized = false;
  }

  /**
   * Set the maximum alias word count
   * @param {number} count - Maximum word count for aliases
   */
  setMaxAliasWordCount(count) {
    this._maxAliasWordCount = count;
    this._initialized = true;
  }

  /**
   * Get the maximum alias word count
   * @returns {number} Maximum word count for aliases
   */
  getMaxAliasWordCount() {
    if (!this._initialized) {
      // Return a safe default if not initialized yet
      // This prevents startup issues
      return 5;
    }
    return this._maxAliasWordCount;
  }

  /**
   * Check if configuration has been initialized
   * @returns {boolean} Whether config is initialized
   */
  isInitialized() {
    return this._initialized;
  }
}

// Export singleton instance
module.exports = new MessageHandlerConfig();
