/**
 * Feature flag system for gradual rollout of new functionality
 * Supports both static configuration and runtime toggles
 */
class FeatureFlags {
  constructor(config = {}) {
    this.flags = new Map();
    this.defaultFlags = {
      // Feature flags
      'features.enhanced-context': false,

      // Override all flags from config
      ...config,
    };

    // Initialize flags from defaults
    Object.entries(this.defaultFlags).forEach(([key, value]) => {
      this.flags.set(key, value);
    });

    // Load from environment variables (FEATURE_FLAG_PREFIX_KEY format)
    this._loadFromEnvironment();
  }

  /**
   * Check if a feature is enabled
   * @param {string} flagName - The feature flag name
   * @returns {boolean}
   */
  isEnabled(flagName) {
    if (!this.flags.has(flagName)) {
      console.warn(`Unknown feature flag: ${flagName}`);
      return false;
    }
    return this.flags.get(flagName);
  }

  /**
   * Check if a feature flag exists
   * @param {string} flagName - The feature flag name
   * @returns {boolean}
   */
  hasFlag(flagName) {
    return this.flags.has(flagName);
  }

  /**
   * Enable a feature
   * @param {string} flagName - The feature flag name
   */
  enable(flagName) {
    if (!this.flags.has(flagName)) {
      throw new Error(`Unknown feature flag: ${flagName}`);
    }
    this.flags.set(flagName, true);
  }

  /**
   * Disable a feature
   * @param {string} flagName - The feature flag name
   */
  disable(flagName) {
    if (!this.flags.has(flagName)) {
      throw new Error(`Unknown feature flag: ${flagName}`);
    }
    this.flags.set(flagName, false);
  }

  /**
   * Toggle a feature
   * @param {string} flagName - The feature flag name
   */
  toggle(flagName) {
    if (!this.flags.has(flagName)) {
      throw new Error(`Unknown feature flag: ${flagName}`);
    }
    this.flags.set(flagName, !this.flags.get(flagName));
  }

  /**
   * Get all feature flags and their states
   * @returns {Object}
   */
  getAllFlags() {
    const result = {};
    this.flags.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Get flags by prefix (e.g., 'features')
   * @param {string} prefix - The prefix to filter by
   * @returns {Object}
   */
  getFlagsByPrefix(prefix) {
    const result = {};
    this.flags.forEach((value, key) => {
      if (key.startsWith(prefix)) {
        result[key] = value;
      }
    });
    return result;
  }

  /**
   * Set multiple flags at once
   * @param {Object} flags - Object with flag names as keys and boolean values
   */
  setFlags(flags) {
    Object.entries(flags).forEach(([key, value]) => {
      if (!this.flags.has(key)) {
        throw new Error(`Unknown feature flag: ${key}`);
      }
      if (typeof value !== 'boolean') {
        throw new Error(`Feature flag value must be boolean: ${key}`);
      }
      this.flags.set(key, value);
    });
  }

  /**
   * Reset all flags to defaults
   */
  reset() {
    Object.entries(this.defaultFlags).forEach(([key, value]) => {
      this.flags.set(key, value);
    });
  }

  /**
   * Load feature flags from environment variables
   * Format: FEATURE_FLAG_FEATURES_NEW_UI=true
   */
  _loadFromEnvironment() {
    const prefix = 'FEATURE_FLAG_';
    Object.keys(process.env).forEach(key => {
      if (key.startsWith(prefix)) {
        // Convert FEATURE_FLAG_FEATURES_NEW_UI to features.new-ui
        const envKey = key.substring(prefix.length).toLowerCase();
        const parts = envKey.split('_');

        // If we have multiple parts, treat as namespace.feature-name
        let flagName;
        if (parts.length >= 2) {
          const namespace = parts[0];
          const featureParts = parts.slice(1);
          flagName = `${namespace}.${featureParts.join('-')}`;
        } else {
          flagName = envKey.replace(/_/g, '-');
        }

        if (this.flags.has(flagName)) {
          const value = process.env[key].toLowerCase() === 'true';
          this.flags.set(flagName, value);
        }
      }
    });
  }

  /**
   * Create a scoped feature flag checker
   * @param {string} scope - The scope prefix (e.g., 'features')
   * @returns {Function}
   */
  createScopedChecker(scope) {
    return feature => this.isEnabled(`${scope}.${feature}`);
  }

  /**
   * Add a new feature flag dynamically
   * @param {string} flagName - The feature flag name
   * @param {boolean} defaultValue - The default value
   */
  addFlag(flagName, defaultValue = false) {
    if (this.flags.has(flagName)) {
      throw new Error(`Feature flag already exists: ${flagName}`);
    }
    this.flags.set(flagName, defaultValue);
  }
}

/**
 * Create a new feature flags instance
 * @param {Object} config - Optional configuration for initialization
 * @returns {FeatureFlags}
 */
function createFeatureFlags(config) {
  return new FeatureFlags(config);
}

module.exports = {
  FeatureFlags,
  createFeatureFlags,
};
