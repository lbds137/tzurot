/**
 * Tests for environment-based bot configuration
 * 
 * These tests verify that the bot correctly switches between development 
 * and production configurations based on NODE_ENV.
 */

describe('Environment Configuration', () => {
  let originalEnv;
  
  beforeAll(() => {
    // Save original NODE_ENV
    originalEnv = process.env.NODE_ENV;
  });
  
  afterAll(() => {
    // Restore original NODE_ENV
    process.env.NODE_ENV = originalEnv;
  });
  
  beforeEach(() => {
    // Clear require cache to get fresh config
    delete require.cache[require.resolve('../../config')];
    // Also clear dotenv cache
    delete require.cache[require.resolve('dotenv')];
  });
  
  it('should load correct config for current environment', () => {
    const { botConfig } = require('../../config');
    
    // Test that config loads without error
    expect(botConfig).toBeDefined();
    expect(botConfig.name).toBeDefined();
    expect(botConfig.prefix).toBeDefined();
    expect(botConfig.token).toBeDefined();
    expect(typeof botConfig.isDevelopment).toBe('boolean');
    expect(botConfig.environment).toBeDefined();
    
    // Test prefix format
    expect(botConfig.prefix).toMatch(/^!/);
    
    // Test environment consistency
    if (botConfig.isDevelopment) {
      expect(botConfig.name).toBe('Rotzot');
      expect(botConfig.prefix).toBe('!rtz');
      expect(botConfig.environment).toBe('development');
      expect(botConfig.token).toBe(process.env.DISCORD_DEV_TOKEN);
    } else {
      expect(botConfig.name).toBe('Tzurot');
      expect(botConfig.prefix).toBe('!tz');
      expect(botConfig.environment).toBe('production');
      expect(botConfig.token).toBe(process.env.DISCORD_TOKEN);
    }
  });
  
  it('should maintain backward compatibility with botPrefix export', () => {
    const { botPrefix, botConfig } = require('../../config');
    
    // botPrefix should match botConfig.prefix
    expect(botPrefix).toBe(botConfig.prefix);
  });
});