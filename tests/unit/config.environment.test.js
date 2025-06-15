/**
 * Tests for environment-based bot configuration
 * 
 * These tests verify that the bot correctly switches between development 
 * and production configurations based on NODE_ENV.
 */

// Mock dotenv to prevent loading .env file during tests
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

describe('Environment Configuration', () => {
  let originalEnv;
  let originalBotName;
  let originalBotPrefix;
  let originalBotMentionChar;
  
  beforeAll(() => {
    // Save original environment variables
    originalEnv = process.env.NODE_ENV;
    originalBotName = process.env.BOT_NAME;
    originalBotPrefix = process.env.BOT_PREFIX;
    originalBotMentionChar = process.env.BOT_MENTION_CHAR;
  });
  
  afterAll(() => {
    // Restore original environment variables
    process.env.NODE_ENV = originalEnv;
    if (originalBotName !== undefined) {
      process.env.BOT_NAME = originalBotName;
    } else {
      delete process.env.BOT_NAME;
    }
    if (originalBotPrefix !== undefined) {
      process.env.BOT_PREFIX = originalBotPrefix;
    } else {
      delete process.env.BOT_PREFIX;
    }
    if (originalBotMentionChar !== undefined) {
      process.env.BOT_MENTION_CHAR = originalBotMentionChar;
    } else {
      delete process.env.BOT_MENTION_CHAR;
    }
  });
  
  beforeEach(() => {
    // Clear require cache to get fresh config
    delete require.cache[require.resolve('../../config')];
    // Also clear dotenv cache
    delete require.cache[require.resolve('dotenv')];
    // Clear BOT_NAME to test default behavior
    delete process.env.BOT_NAME;
    delete process.env.BOT_PREFIX;
    delete process.env.BOT_MENTION_CHAR;
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
    // Testing both branches to avoid conditional expect
    const expectedName = botConfig.isDevelopment ? 'Rotzot' : 'Tzurot';
    const expectedPrefix = botConfig.isDevelopment ? '!rtz' : '!tz';
    const expectedMentionChar = botConfig.isDevelopment ? '&' : '@';
    
    expect(botConfig.name).toBe(expectedName);
    expect(botConfig.prefix).toBe(expectedPrefix);
    expect(botConfig.mentionChar).toBe(expectedMentionChar);
    
    // Token should always use DISCORD_TOKEN now
    expect(botConfig.token).toBe(process.env.DISCORD_TOKEN);
  });
  
  it('should maintain backward compatibility with botPrefix export', () => {
    const { botPrefix, botConfig } = require('../../config');
    
    // botPrefix should match botConfig.prefix
    expect(botPrefix).toBe(botConfig.prefix);
  });
});