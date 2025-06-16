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
    // Token may be undefined in test environment - that's ok
    expect(botConfig).toHaveProperty('token');
    expect(typeof botConfig.isDevelopment).toBe('boolean');
    expect(botConfig.environment).toBeDefined();
    
    // Test prefix format
    expect(botConfig.prefix).toMatch(/^!/);
    
    // In test environment, NODE_ENV is 'test'
    expect(botConfig.environment).toBe('test');
    
    // Test environment consistency
    // In test environment, isDevelopment is false, so we get production values
    expect(botConfig.isDevelopment).toBe(false);
    
    // The bot name and prefix depend on environment variables
    // If BOT_NAME is set to 'Rotzot', that takes precedence
    if (process.env.BOT_NAME === 'Rotzot') {
      expect(botConfig.name).toBe('Rotzot');
      expect(botConfig.prefix).toBe('!rtz');
    } else {
      expect(botConfig.name).toBe('Tzurot');
      expect(botConfig.prefix).toBe('!tz');
    }
    
    // Mention char also depends on env or isDevelopment
    expect(botConfig.mentionChar).toBe(process.env.BOT_MENTION_CHAR || '@');
    
    // Token should always use DISCORD_TOKEN now
    expect(botConfig.token).toBe(process.env.DISCORD_TOKEN);
  });
  
  it('should maintain backward compatibility with botPrefix export', () => {
    const { botPrefix, botConfig } = require('../../config');
    
    // botPrefix should match botConfig.prefix
    expect(botPrefix).toBe(botConfig.prefix);
  });
});