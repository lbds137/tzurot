const { FeatureFlags, getFeatureFlags, resetFeatureFlags } = require('../../../../src/application/services/FeatureFlags');

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
    
    // Reset singleton
    resetFeatureFlags();
    
    // Create fresh instance
    featureFlags = new FeatureFlags();
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    resetFeatureFlags();
  });
  
  describe('initialization', () => {
    it('should initialize with default flags', () => {
      const flags = featureFlags.getAllFlags();
      
      expect(flags['ddd.personality.read']).toBe(false);
      expect(flags['ddd.personality.write']).toBe(false);
      expect(flags['ddd.personality.dual-write']).toBe(false);
      expect(flags['commands.text.enabled']).toBe(true);
      expect(flags['commands.slash.enabled']).toBe(false);
    });
    
    it('should accept config overrides', () => {
      const customFlags = new FeatureFlags({
        'ddd.personality.read': true,
        'commands.slash.enabled': true
      });
      
      expect(customFlags.isEnabled('ddd.personality.read')).toBe(true);
      expect(customFlags.isEnabled('commands.slash.enabled')).toBe(true);
      expect(customFlags.isEnabled('ddd.personality.write')).toBe(false);
    });
    
    it('should load from environment variables', () => {
      process.env.FEATURE_FLAG_DDD_PERSONALITY_READ = 'true';
      process.env.FEATURE_FLAG_COMMANDS_SLASH_ENABLED = 'true';
      process.env.FEATURE_FLAG_DDD_AI_WRITE = 'false';
      
      const flags = new FeatureFlags();
      
      expect(flags.isEnabled('ddd.personality.read')).toBe(true);
      expect(flags.isEnabled('commands.slash.enabled')).toBe(true);
      expect(flags.isEnabled('ddd.ai.write')).toBe(false);
    });
  });
  
  describe('isEnabled', () => {
    it('should return correct flag state', () => {
      expect(featureFlags.isEnabled('commands.text.enabled')).toBe(true);
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(false);
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
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(false);
      
      featureFlags.enable('ddd.personality.read');
      
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(true);
    });
    
    it('should throw for unknown flags', () => {
      expect(() => {
        featureFlags.enable('unknown.flag');
      }).toThrow('Unknown feature flag: unknown.flag');
    });
  });
  
  describe('disable', () => {
    it('should disable a flag', () => {
      featureFlags.enable('ddd.personality.read');
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(true);
      
      featureFlags.disable('ddd.personality.read');
      
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(false);
    });
    
    it('should throw for unknown flags', () => {
      expect(() => {
        featureFlags.disable('unknown.flag');
      }).toThrow('Unknown feature flag: unknown.flag');
    });
  });
  
  describe('toggle', () => {
    it('should toggle a flag state', () => {
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(false);
      
      featureFlags.toggle('ddd.personality.read');
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(true);
      
      featureFlags.toggle('ddd.personality.read');
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(false);
    });
    
    it('should throw for unknown flags', () => {
      expect(() => {
        featureFlags.toggle('unknown.flag');
      }).toThrow('Unknown feature flag: unknown.flag');
    });
  });
  
  describe('getAllFlags', () => {
    it('should return all flags and their states', () => {
      featureFlags.enable('ddd.personality.read');
      
      const flags = featureFlags.getAllFlags();
      
      expect(flags).toEqual(expect.objectContaining({
        'ddd.personality.read': true,
        'ddd.personality.write': false,
        'commands.text.enabled': true,
        'commands.slash.enabled': false
      }));
    });
  });
  
  describe('getFlagsByPrefix', () => {
    it('should return flags matching prefix', () => {
      featureFlags.enable('ddd.personality.read');
      featureFlags.enable('ddd.personality.write');
      
      const personalityFlags = featureFlags.getFlagsByPrefix('ddd.personality');
      
      expect(personalityFlags).toEqual({
        'ddd.personality.read': true,
        'ddd.personality.write': true,
        'ddd.personality.dual-write': false
      });
    });
    
    it('should return empty object for non-matching prefix', () => {
      const flags = featureFlags.getFlagsByPrefix('nonexistent');
      expect(flags).toEqual({});
    });
  });
  
  describe('setFlags', () => {
    it('should set multiple flags at once', () => {
      featureFlags.setFlags({
        'ddd.personality.read': true,
        'ddd.personality.write': true,
        'commands.slash.enabled': true
      });
      
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(true);
      expect(featureFlags.isEnabled('ddd.personality.write')).toBe(true);
      expect(featureFlags.isEnabled('commands.slash.enabled')).toBe(true);
    });
    
    it('should throw for unknown flags', () => {
      expect(() => {
        featureFlags.setFlags({
          'ddd.personality.read': true,
          'unknown.flag': true
        });
      }).toThrow('Unknown feature flag: unknown.flag');
    });
    
    it('should throw for non-boolean values', () => {
      expect(() => {
        featureFlags.setFlags({
          'ddd.personality.read': 'yes'
        });
      }).toThrow('Feature flag value must be boolean: ddd.personality.read');
    });
  });
  
  describe('reset', () => {
    it('should reset all flags to defaults', () => {
      featureFlags.setFlags({
        'ddd.personality.read': true,
        'ddd.personality.write': true,
        'commands.slash.enabled': true,
        'commands.text.enabled': false
      });
      
      featureFlags.reset();
      
      expect(featureFlags.isEnabled('ddd.personality.read')).toBe(false);
      expect(featureFlags.isEnabled('ddd.personality.write')).toBe(false);
      expect(featureFlags.isEnabled('commands.slash.enabled')).toBe(false);
      expect(featureFlags.isEnabled('commands.text.enabled')).toBe(true);
    });
  });
  
  describe('createScopedChecker', () => {
    it('should create a scoped checker function', () => {
      featureFlags.enable('ddd.personality.read');
      featureFlags.enable('ddd.personality.write');
      
      const personalityFlags = featureFlags.createScopedChecker('ddd.personality');
      
      expect(personalityFlags('read')).toBe(true);
      expect(personalityFlags('write')).toBe(true);
      expect(personalityFlags('dual-write')).toBe(false);
    });
  });
  
  describe('singleton behavior', () => {
    it('should return same instance from getFeatureFlags', () => {
      const instance1 = getFeatureFlags();
      const instance2 = getFeatureFlags();
      
      expect(instance1).toBe(instance2);
    });
    
    it('should maintain state across getInstance calls', () => {
      const instance1 = getFeatureFlags();
      instance1.enable('ddd.personality.read');
      
      const instance2 = getFeatureFlags();
      expect(instance2.isEnabled('ddd.personality.read')).toBe(true);
    });
    
    it('should reset singleton with resetFeatureFlags', () => {
      const instance1 = getFeatureFlags();
      instance1.enable('ddd.personality.read');
      
      resetFeatureFlags();
      
      const instance2 = getFeatureFlags();
      expect(instance2.isEnabled('ddd.personality.read')).toBe(false);
      expect(instance1).not.toBe(instance2);
    });
  });
  
  describe('environment variable parsing', () => {
    it('should handle various boolean representations', () => {
      process.env.FEATURE_FLAG_DDD_PERSONALITY_READ = 'TRUE';
      process.env.FEATURE_FLAG_DDD_PERSONALITY_WRITE = 'True';
      process.env.FEATURE_FLAG_DDD_AI_READ = 'false';
      process.env.FEATURE_FLAG_DDD_AI_WRITE = 'FALSE';
      
      const flags = new FeatureFlags();
      
      expect(flags.isEnabled('ddd.personality.read')).toBe(true);
      expect(flags.isEnabled('ddd.personality.write')).toBe(true);
      expect(flags.isEnabled('ddd.ai.read')).toBe(false);
      expect(flags.isEnabled('ddd.ai.write')).toBe(false);
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