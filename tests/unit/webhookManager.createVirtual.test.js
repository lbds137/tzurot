/**
 * Test for webhookManager.js createVirtualResult function
 */
const logger = require('../../src/logger');

// Mock the logger to avoid unnecessary output
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('WebhookManager - createVirtualResult', () => {
  let webhookManager;
  
  beforeEach(() => {
    // Reset modules to get a fresh instance
    jest.resetModules();
    
    // Load the module we're testing
    webhookManager = require('../../src/webhookManager');
  });
  
  it('should create a virtual result with expected format', () => {
    // Test data
    const personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality'
    };
    const channelId = 'test-channel-123';
    
    // Call the function we're testing
    const result = webhookManager.createVirtualResult(personality, channelId);
    
    // Verify the returned object has the expected format
    expect(result).toHaveProperty('message');
    expect(result.message).toHaveProperty('id');
    expect(typeof result.message.id).toBe('string');
    expect(result.message.id).toMatch(/^virtual-/);
    
    expect(result).toHaveProperty('messageIds');
    expect(Array.isArray(result.messageIds)).toBe(true);
    expect(result.messageIds).toHaveLength(1);
    expect(result.messageIds[0]).toBe(result.message.id);
    
    expect(result).toHaveProperty('isDuplicate', true);
  });
  
  it('should handle null personality gracefully', () => {
    // Call the function with null personality
    const result = webhookManager.createVirtualResult(null, 'test-channel-123');
    
    // Verify the structure of the result
    expect(result).toHaveProperty('message');
    expect(result.message).toHaveProperty('id');
    expect(result).toHaveProperty('messageIds');
    expect(result).toHaveProperty('isDuplicate', true);
  });
  
  it('should handle missing fullName property gracefully', () => {
    // Test with personality missing fullName
    const personality = {
      displayName: 'Test Personality'
      // No fullName property
    };
    
    // Call the function
    const result = webhookManager.createVirtualResult(personality, 'test-channel-123');
    
    // Verify the structure of the result
    expect(result).toHaveProperty('message');
    expect(result.message).toHaveProperty('id');
    expect(result).toHaveProperty('messageIds');
    expect(result).toHaveProperty('isDuplicate', true);
  });
  
  it('should generate a unique virtual ID for each call', () => {
    // Call the function multiple times
    const result1 = webhookManager.createVirtualResult(null, 'test-channel-123');
    const result2 = webhookManager.createVirtualResult(null, 'test-channel-123');
    
    // Verify the IDs are different
    expect(result1.message.id).not.toBe(result2.message.id);
    
    // Both should match the expected pattern
    expect(result1.message.id).toMatch(/^virtual-/);
    expect(result2.message.id).toMatch(/^virtual-/);
  });
});