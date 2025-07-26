const {
  FeatureFlags,
  createFeatureFlags,
} = require('../../../../src/application/services/FeatureFlags');

describe('FeatureFlags', () => {
  let featureFlags;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear any environment feature flags
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('FEATURE_FLAG_')) {
        delete process.env[key];
      }
    });

    // Create fresh instance
    featureFlags = createFeatureFlags();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    // Note: resetFeatureFlags no longer exists since we use factory functions
  });

  describe('initialization', () => {
    it('should initialize with default flags', () => {
      const flags = featureFlags.getAllFlags();

      // Should have the enhanced-context flag
      expect(Object.keys(flags)).toHaveLength(1);
      expect(flags['features.enhanced-context']).toBe(false);
    });

    it('should accept config overrides', () => {
      const customFlags = new FeatureFlags({
        'features.new-ui': true,
        'features.enhanced-context': true,
      });

      expect(customFlags.isEnabled('features.new-ui')).toBe(true);
      expect(customFlags.isEnabled('features.enhanced-context')).toBe(true);
    });

    it('should load from environment variables', () => {
      process.env.FEATURE_FLAG_FEATURES_NEW_UI = 'true';
      process.env.FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT = 'false';

      // Create flags first, then environment variables can override them
      const flags = new FeatureFlags({
        'features.new-ui': false,
        'features.enhanced-context': true,
      });

      expect(flags.isEnabled('features.new-ui')).toBe(true);
      expect(flags.isEnabled('features.enhanced-context')).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('should return correct flag state', () => {
      // Create flags to test with
      const testFlags = new FeatureFlags({
        'features.test-flag': true,
        'features.disabled-flag': false,
      });
      
      expect(testFlags.isEnabled('features.test-flag')).toBe(true);
      expect(testFlags.isEnabled('features.disabled-flag')).toBe(false);
    });

    it('should warn and return false for unknown flags', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = featureFlags.isEnabled('unknown.flag');

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Unknown feature flag: unknown.flag');

      consoleSpy.mockRestore();
    });
  });

  describe('enable', () => {
    it('should enable a flag', () => {
      // Create a test flag first
      const testFlags = new FeatureFlags({
        'features.test-flag': false,
      });
      
      expect(testFlags.isEnabled('features.test-flag')).toBe(false);

      testFlags.enable('features.test-flag');

      expect(testFlags.isEnabled('features.test-flag')).toBe(true);
    });

    it('should throw for unknown flags', () => {
      expect(() => {
        featureFlags.enable('unknown.flag');
      }).toThrow('Unknown feature flag: unknown.flag');
    });
  });

  describe('disable', () => {
    it('should disable a flag', () => {
      const testFlags = new FeatureFlags({
        'features.test-flag': true,
      });
      
      expect(testFlags.isEnabled('features.test-flag')).toBe(true);

      testFlags.disable('features.test-flag');

      expect(testFlags.isEnabled('features.test-flag')).toBe(false);
    });

    it('should throw for unknown flags', () => {
      expect(() => {
        featureFlags.disable('unknown.flag');
      }).toThrow('Unknown feature flag: unknown.flag');
    });
  });

  describe('toggle', () => {
    it('should toggle a flag state', () => {
      const testFlags = new FeatureFlags({
        'features.test-flag': false,
      });
      
      expect(testFlags.isEnabled('features.test-flag')).toBe(false);

      testFlags.toggle('features.test-flag');
      expect(testFlags.isEnabled('features.test-flag')).toBe(true);

      testFlags.toggle('features.test-flag');
      expect(testFlags.isEnabled('features.test-flag')).toBe(false);
    });

    it('should throw for unknown flags', () => {
      expect(() => {
        featureFlags.toggle('unknown.flag');
      }).toThrow('Unknown feature flag: unknown.flag');
    });
  });

  describe('getAllFlags', () => {
    it('should return all flags and their states', () => {
      const testFlags = new FeatureFlags({
        'features.test-flag': false,
        'features.another-flag': true,
      });
      
      testFlags.enable('features.test-flag');

      const flags = testFlags.getAllFlags();

      expect(flags).toEqual({
        'features.enhanced-context': false,
        'features.test-flag': true,
        'features.another-flag': true,
      });
    });
  });

  describe('getFlagsByPrefix', () => {
    it('should return flags matching prefix', () => {
      const testFlags = new FeatureFlags({
        'features.ui-flag': false,
        'features.api-flag': true,
        'debug.logging': false,
      });
      
      testFlags.enable('features.ui-flag');

      const featureFlags = testFlags.getFlagsByPrefix('features');

      expect(featureFlags).toEqual({
        'features.enhanced-context': false,
        'features.ui-flag': true,
        'features.api-flag': true,
      });
    });

    it('should return empty object for non-matching prefix', () => {
      const flags = featureFlags.getFlagsByPrefix('nonexistent');
      expect(flags).toEqual({});
    });
  });

  describe('setFlags', () => {
    it('should set multiple flags at once', () => {
      const testFlags = new FeatureFlags({
        'features.flag1': false,
        'features.flag2': false,
        'features.flag3': false,
      });
      
      testFlags.setFlags({
        'features.flag1': true,
        'features.flag2': true,
        'features.flag3': false,
      });

      expect(testFlags.isEnabled('features.flag1')).toBe(true);
      expect(testFlags.isEnabled('features.flag2')).toBe(true);
      expect(testFlags.isEnabled('features.flag3')).toBe(false);
    });

    it('should throw for unknown flags', () => {
      const testFlags = new FeatureFlags({
        'features.known-flag': true,
      });
      
      expect(() => {
        testFlags.setFlags({
          'features.known-flag': true,
          'unknown.flag': true,
        });
      }).toThrow('Unknown feature flag: unknown.flag');
    });

    it('should throw for non-boolean values', () => {
      const testFlags = new FeatureFlags({
        'features.test-flag': false,
      });
      
      expect(() => {
        testFlags.setFlags({
          'features.test-flag': 'yes',
        });
      }).toThrow('Feature flag value must be boolean: features.test-flag');
    });
  });

  describe('reset', () => {
    it('should reset all flags to defaults', () => {
      const testFlags = new FeatureFlags({
        'features.flag1': false,
        'features.flag2': false,
        'features.flag3': false,
      });
      
      testFlags.setFlags({
        'features.flag1': true,
        'features.flag2': true,
        'features.flag3': true,
      });

      testFlags.reset();

      expect(testFlags.isEnabled('features.flag1')).toBe(false);
      expect(testFlags.isEnabled('features.flag2')).toBe(false);
      expect(testFlags.isEnabled('features.flag3')).toBe(false);
    });
  });

  describe('createScopedChecker', () => {
    it('should create a scoped checker function', () => {
      const testFlags = new FeatureFlags({
        'features.read': false,
        'features.write': false,
        'features.delete': false,
      });
      
      testFlags.enable('features.read');
      testFlags.enable('features.write');

      const featureChecker = testFlags.createScopedChecker('features');

      expect(featureChecker('read')).toBe(true);
      expect(featureChecker('write')).toBe(true);
      expect(featureChecker('delete')).toBe(false);
    });
  });

  describe('factory function behavior', () => {
    it('should return new independent instances from createFeatureFlags', () => {
      const instance1 = createFeatureFlags();
      const instance2 = createFeatureFlags();

      expect(instance1).not.toBe(instance2);
      expect(instance1).toBeInstanceOf(FeatureFlags);
      expect(instance2).toBeInstanceOf(FeatureFlags);
    });

    it('should create instances with independent state', () => {
      const instance1 = createFeatureFlags();
      const instance2 = createFeatureFlags();
      
      // Add a flag to both instances for testing
      instance1.addFlag('features.test-flag', false);
      instance2.addFlag('features.test-flag', false);
      
      // Enable flag in one instance
      instance1.enable('features.test-flag');

      // Instances should have independent state
      expect(instance1.isEnabled('features.test-flag')).toBe(true);
      expect(instance2.isEnabled('features.test-flag')).toBe(false);
    });

    it('should accept configuration in createFeatureFlags', () => {
      const config = {
        'features.test-flag': true,
        'features.another-flag': false,
      };
      
      const instance = createFeatureFlags(config);
      
      expect(instance.isEnabled('features.test-flag')).toBe(true);
      expect(instance.isEnabled('features.another-flag')).toBe(false);
    });
  });

  describe('environment variable parsing', () => {
    it('should handle various boolean representations', () => {
      process.env.FEATURE_FLAG_FEATURES_TEST_READ = 'TRUE';
      process.env.FEATURE_FLAG_FEATURES_TEST_WRITE = 'True';
      process.env.FEATURE_FLAG_FEATURES_API_READ = 'false';
      process.env.FEATURE_FLAG_FEATURES_API_WRITE = 'FALSE';

      // Create flags first, then environment variables can override them
      const flags = new FeatureFlags({
        'features.test-read': false,
        'features.test-write': false,
        'features.api-read': true,
        'features.api-write': true,
      });

      expect(flags.isEnabled('features.test-read')).toBe(true);
      expect(flags.isEnabled('features.test-write')).toBe(true);
      expect(flags.isEnabled('features.api-read')).toBe(false);
      expect(flags.isEnabled('features.api-write')).toBe(false);
    });

    it('should ignore non-matching environment variables', () => {
      process.env.FEATURE_FLAG_UNKNOWN_FLAG = 'true';
      process.env.NOT_A_FEATURE_FLAG = 'true';

      const flags = new FeatureFlags();
      const allFlags = flags.getAllFlags();

      expect(Object.keys(allFlags)).not.toContain('unknown.flag');
    });
  });
});
