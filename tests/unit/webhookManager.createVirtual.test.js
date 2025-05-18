/**
 * Test for webhookManager.js createVirtualResult function
 * Focus on ensuring clearPendingMessage is called correctly
 */

// We need to mock the entire webhookManager module but spy on specific functions
describe('WebhookManager - createVirtualResult', () => {
  // Mock original functions to spy on them
  let mockClearPendingMessage;
  let createVirtualResultOriginal;
  let webhookManager;

  // Set up spies before tests
  beforeEach(() => {
    // Clear any module state by resetting modules
    jest.resetModules();
    
    // First, get the original implementation
    const originalWebhookManager = jest.requireActual('../../src/webhookManager');
    
    // Store the original function for later use
    createVirtualResultOriginal = originalWebhookManager.createVirtualResult;
    
    // Create a mock function for clearPendingMessage that we can spy on
    mockClearPendingMessage = jest.fn();
    
    // Now, mock the module
    jest.mock('../../src/webhookManager', () => {
      // Start with the original module
      const original = jest.requireActual('../../src/webhookManager');
      
      // Override the clearPendingMessage function with our spy
      return {
        ...original,
        clearPendingMessage: mockClearPendingMessage,
        // We keep the original createVirtualResult to test it properly
      };
    });
    
    // Require the mocked module
    webhookManager = require('../../src/webhookManager');
  });
  
  afterEach(() => {
    // Clear all mock function calls
    jest.clearAllMocks();
    jest.resetModules();
  });
  
  it('should call clearPendingMessage when personality is provided', () => {
    // Test data
    const personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality'
    };
    const channelId = 'test-channel-123';
    
    // Call the function we're testing
    const result = webhookManager.createVirtualResult(personality, channelId);
    
    // Verify clearPendingMessage was called with the right arguments
    expect(mockClearPendingMessage).toHaveBeenCalledTimes(1);
    expect(mockClearPendingMessage).toHaveBeenCalledWith(personality.fullName, channelId);
    
    // Verify the returned object has the expected format
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('messageIds');
    expect(result).toHaveProperty('isDuplicate', true);
    expect(result.messageIds).toHaveLength(1);
    expect(result.message.id).toBe(result.messageIds[0]);
  });
  
  it('should not call clearPendingMessage when personality is null', () => {
    // Test with null personality
    const result = webhookManager.createVirtualResult(null, 'test-channel-123');
    
    // Verify clearPendingMessage was not called
    expect(mockClearPendingMessage).not.toHaveBeenCalled();
    
    // Verify the returned object still has the expected format
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('messageIds');
    expect(result).toHaveProperty('isDuplicate', true);
  });
  
  it('should not call clearPendingMessage when personality has no fullName', () => {
    // Test with personality missing fullName
    const personality = {
      displayName: 'Test Personality'
      // No fullName property
    };
    const result = webhookManager.createVirtualResult(personality, 'test-channel-123');
    
    // Verify clearPendingMessage was not called
    expect(mockClearPendingMessage).not.toHaveBeenCalled();
    
    // Verify the returned object still has the expected format
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('messageIds');
    expect(result).toHaveProperty('isDuplicate', true);
  });
  
  it('should generate a unique virtual ID for each call', () => {
    // Call the function multiple times
    const result1 = webhookManager.createVirtualResult(null, 'test-channel-123');
    const result2 = webhookManager.createVirtualResult(null, 'test-channel-123');
    
    // Verify the IDs are different
    expect(result1.message.id).not.toBe(result2.message.id);
  });
});