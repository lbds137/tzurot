/**
 * @jest-environment node
 * @testType unit
 *
 * MessageHandlerConfig Test
 * - Tests configuration provider for message handling components
 * - No external dependencies, tests singleton instance
 */

describe('MessageHandlerConfig', () => {
  let config;
  let originalState;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the singleton instance
    config = require('../../../src/config/MessageHandlerConfig');
    
    // Save original state
    originalState = {
      maxAliasWordCount: config._maxAliasWordCount,
      initialized: config._initialized
    };
    
    // Reset to fresh state for each test
    config._maxAliasWordCount = 5;
    config._initialized = false;
  });

  afterEach(() => {
    // Restore original state
    if (originalState) {
      config._maxAliasWordCount = originalState.maxAliasWordCount;
      config._initialized = originalState.initialized;
    }
  });

  describe('constructor and initialization', () => {
    it('should initialize with safe defaults', () => {
      expect(config.getMaxAliasWordCount()).toBe(2);
      expect(config.isInitialized()).toBe(false);
    });

    it('should return safe default when not initialized', () => {
      // Fresh instance should not be initialized
      expect(config.isInitialized()).toBe(false);
      expect(config.getMaxAliasWordCount()).toBe(2);
    });
  });

  describe('setMaxAliasWordCount', () => {
    it('should set the maximum alias word count', () => {
      config.setMaxAliasWordCount(10);
      
      expect(config.getMaxAliasWordCount()).toBe(10);
      expect(config.isInitialized()).toBe(true);
    });

    it('should handle setting to zero', () => {
      config.setMaxAliasWordCount(0);
      
      expect(config.getMaxAliasWordCount()).toBe(0);
      expect(config.isInitialized()).toBe(true);
    });

    it('should handle setting to negative values', () => {
      config.setMaxAliasWordCount(-5);
      
      expect(config.getMaxAliasWordCount()).toBe(-5);
      expect(config.isInitialized()).toBe(true);
    });

    it('should handle setting large numbers', () => {
      config.setMaxAliasWordCount(1000);
      
      expect(config.getMaxAliasWordCount()).toBe(1000);
      expect(config.isInitialized()).toBe(true);
    });

    it('should update value when called multiple times', () => {
      config.setMaxAliasWordCount(10);
      expect(config.getMaxAliasWordCount()).toBe(10);
      
      config.setMaxAliasWordCount(15);
      expect(config.getMaxAliasWordCount()).toBe(15);
      
      // Should remain initialized
      expect(config.isInitialized()).toBe(true);
    });
  });

  describe('getMaxAliasWordCount', () => {
    it('should return safe default before initialization', () => {
      expect(config.isInitialized()).toBe(false);
      expect(config.getMaxAliasWordCount()).toBe(2);
    });

    it('should return configured value after initialization', () => {
      config.setMaxAliasWordCount(12);
      expect(config.getMaxAliasWordCount()).toBe(12);
    });

    it('should consistently return the same value', () => {
      config.setMaxAliasWordCount(8);
      
      expect(config.getMaxAliasWordCount()).toBe(8);
      expect(config.getMaxAliasWordCount()).toBe(8);
      expect(config.getMaxAliasWordCount()).toBe(8);
    });
  });

  describe('isInitialized', () => {
    it('should return false before any configuration', () => {
      expect(config.isInitialized()).toBe(false);
    });

    it('should return true after setMaxAliasWordCount is called', () => {
      expect(config.isInitialized()).toBe(false);
      
      config.setMaxAliasWordCount(7);
      
      expect(config.isInitialized()).toBe(true);
    });

    it('should remain true after multiple configurations', () => {
      config.setMaxAliasWordCount(5);
      expect(config.isInitialized()).toBe(true);
      
      config.setMaxAliasWordCount(10);
      expect(config.isInitialized()).toBe(true);
    });
  });

  describe('singleton behavior', () => {
    it('should return the same instance when required multiple times', () => {
      const config1 = require('../../../src/config/MessageHandlerConfig');
      const config2 = require('../../../src/config/MessageHandlerConfig');
      
      expect(config1).toBe(config2);
    });

    it('should maintain state across multiple requires', () => {
      const config1 = require('../../../src/config/MessageHandlerConfig');
      config1.setMaxAliasWordCount(25);
      
      const config2 = require('../../../src/config/MessageHandlerConfig');
      
      expect(config2.getMaxAliasWordCount()).toBe(25);
      expect(config2.isInitialized()).toBe(true);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle non-integer numbers', () => {
      config.setMaxAliasWordCount(5.7);
      
      expect(config.getMaxAliasWordCount()).toBe(5.7);
      expect(config.isInitialized()).toBe(true);
    });

    it('should handle string numbers', () => {
      config.setMaxAliasWordCount('8');
      
      expect(config.getMaxAliasWordCount()).toBe('8');
      expect(config.isInitialized()).toBe(true);
    });

    it('should handle null values', () => {
      config.setMaxAliasWordCount(null);
      
      expect(config.getMaxAliasWordCount()).toBe(null);
      expect(config.isInitialized()).toBe(true);
    });

    it('should handle undefined values', () => {
      config.setMaxAliasWordCount(undefined);
      
      expect(config.getMaxAliasWordCount()).toBe(undefined);
      expect(config.isInitialized()).toBe(true);
    });
  });

  describe('initialization state and defaults interaction', () => {
    it('should not change initialization state by calling getMaxAliasWordCount', () => {
      expect(config.isInitialized()).toBe(false);
      
      const value = config.getMaxAliasWordCount();
      
      expect(value).toBe(2);
      expect(config.isInitialized()).toBe(false); // Should remain false
    });

    it('should return safe default consistently before initialization', () => {
      expect(config.getMaxAliasWordCount()).toBe(2);
      expect(config.getMaxAliasWordCount()).toBe(2);
      expect(config.getMaxAliasWordCount()).toBe(2);
      expect(config.isInitialized()).toBe(false);
    });
  });

  describe('typical usage patterns', () => {
    it('should support configuration during application startup', () => {
      // Simulate application startup
      expect(config.isInitialized()).toBe(false);
      
      // Application configures the instance
      config.setMaxAliasWordCount(6);
      
      // Multiple components can now safely get the value
      expect(config.getMaxAliasWordCount()).toBe(6);
      expect(config.getMaxAliasWordCount()).toBe(6);
      expect(config.isInitialized()).toBe(true);
    });

    it('should handle early access before configuration gracefully', () => {
      // Component tries to get value before app initialization
      const earlyValue = config.getMaxAliasWordCount();
      expect(earlyValue).toBe(2); // Safe default
      expect(config.isInitialized()).toBe(false);
      
      // Later, app initializes
      config.setMaxAliasWordCount(8);
      
      // Now returns configured value
      expect(config.getMaxAliasWordCount()).toBe(8);
      expect(config.isInitialized()).toBe(true);
    });
  });
});