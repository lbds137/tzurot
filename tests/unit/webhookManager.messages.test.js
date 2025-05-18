/**
 * Tests for webhookManager.js focusing on message sending functionality
 */

// Import mock utilities
const { createMockChannel, createMockWebhook } = require('../utils/discordMocks');

// Mock node-fetch
jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => "Success",
    buffer: async () => Buffer.from("Success"),
    headers: new Map([['content-type', 'application/json']])
  }));
});

// Mock discord.js
jest.mock('discord.js', () => {
  const webhookMocks = new Map();
  
  // Mock WebhookClient with a send method that can be spied on
  class MockWebhookClient {
    constructor(options) {
      this.id = 'mock-webhook-id';
      this.url = options.url;
      this.send = jest.fn().mockImplementation(data => {
        return Promise.resolve({
          id: `mock-message-${Date.now()}`,
          webhookId: this.id,
          content: typeof data === 'string' ? data : data.content,
          author: {
            username: typeof data === 'string' ? undefined : data.username,
            bot: true
          }
        });
      });
      
      this.destroy = jest.fn();
      
      // Store this instance for test verification
      webhookMocks.set(options.url || 'default-url', this);
    }
  }
  
  return {
    WebhookClient: jest.fn().mockImplementation(options => new MockWebhookClient(options)),
    EmbedBuilder: jest.fn().mockImplementation(data => ({ 
      ...data,
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis()
    })),
    _webhookMocks: webhookMocks,
    _clearWebhookMocks: () => webhookMocks.clear()
  };
});

// Import the module after mocking
let webhookManager;

describe('WebhookManager - Message Sending', () => {
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // Test variables
  let mockChannel;
  let personality;
  
  beforeEach(() => {
    // Mock console methods to prevent noisy output
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset discord.js webhook mocks
    require('discord.js')._clearWebhookMocks();
    
    // Ensure module is freshly loaded
    jest.resetModules();
    webhookManager = require('../../src/webhookManager');
    
    // Mock getOrCreateWebhook to return a consistent webhook
    webhookManager.getOrCreateWebhook = jest.fn().mockImplementation(async () => {
      const WebhookClient = require('discord.js').WebhookClient;
      return new WebhookClient({ url: 'https://discord.com/api/webhooks/mock-id/mock-token' });
    });
    
    // Create mock objects for testing
    mockChannel = createMockChannel({
      id: 'test-channel-123',
      name: 'test-channel'
    });
    
    personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
    
    // Mock Date.now for consistent IDs in tests
    jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    
    // Reset state variables that might persist between tests
    webhookManager._testResetState?.();
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    
    // Restore Date.now
    jest.restoreAllMocks();
  });
  
  describe('sendWebhookMessage', () => {
    it('should send a simple message via webhook', async () => {
      // Call the function
      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        'Test message content',
        personality
      );
      
      // Verify result contains message data
      expect(result).toBeDefined();
      expect(result.message).toBeDefined();
      expect(result.messageIds).toBeDefined();
      expect(result.messageIds.length).toBe(1);
      
      // Get the webhook mock to verify the call
      const discordJs = require('discord.js');
      const mockWebhook = Array.from(discordJs._webhookMocks.values())[0];
      
      // Verify webhook.send was called with correct data
      expect(mockWebhook.send).toHaveBeenCalled();
      
      // Get the call arguments
      const sendArgs = mockWebhook.send.mock.calls[0][0];
      
      // Verify message content
      expect(sendArgs.content).toBe('Test message content');
      
      // Verify username is the display name
      expect(sendArgs.username).toBe('Test Personality');
      
      // Verify avatar URL
      expect(sendArgs.avatarURL).toBe('https://example.com/avatar.png');
    });
    
    it('should split long messages into chunks', async () => {
      // Create a very long message
      const longMessage = 'This is a long message. '.repeat(500); // Well over 2000 char limit
      
      // Call the function
      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        longMessage,
        personality
      );
      
      // Verify result contains message data
      expect(result).toBeDefined();
      expect(result.messageIds.length).toBeGreaterThan(1);
      
      // Get the webhook mock to verify the call
      const discordJs = require('discord.js');
      const mockWebhook = Array.from(discordJs._webhookMocks.values())[0];
      
      // Verify webhook.send was called multiple times
      expect(mockWebhook.send.mock.calls.length).toBeGreaterThan(1);
      
      // Verify each chunk is within the Discord limit
      mockWebhook.send.mock.calls.forEach(call => {
        const args = call[0];
        expect(args.content.length).toBeLessThanOrEqual(2000);
      });
    });
    
    it('should add embeds to the first chunk only', async () => {
      // Create a long message that will be split
      const longMessage = 'This is a long message. '.repeat(500);
      
      // Create an embed
      const embed = {
        title: 'Test Embed',
        description: 'This is a test embed'
      };
      
      // Call the function with embed option
      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        longMessage,
        personality,
        { embed }
      );
      
      // Verify result contains message data
      expect(result).toBeDefined();
      
      // Get the webhook mock to verify the call
      const discordJs = require('discord.js');
      const mockWebhook = Array.from(discordJs._webhookMocks.values())[0];
      
      // Verify webhook.send was called multiple times
      expect(mockWebhook.send.mock.calls.length).toBeGreaterThan(1);
      
      // Verify only the first call has embeds
      const firstCall = mockWebhook.send.mock.calls[0][0];
      expect(firstCall.embeds).toBeDefined();
      expect(firstCall.embeds.length).toBe(1);
      
      // Verify subsequent calls don't have embeds
      if (mockWebhook.send.mock.calls.length > 1) {
        const secondCall = mockWebhook.send.mock.calls[1][0];
        expect(secondCall.embeds).toBeUndefined();
      }
    });
    
    it('should prevent sending duplicate messages', async () => {
      // Call the function twice with same content
      const message = 'This is a test message';
      
      // First call should succeed
      const result1 = await webhookManager.sendWebhookMessage(
        mockChannel,
        message,
        personality
      );
      
      // Reset mocks
      jest.clearAllMocks();
      
      // Second call should detect duplicate
      const result2 = await webhookManager.sendWebhookMessage(
        mockChannel,
        message,
        personality
      );
      
      // Get the webhook mock
      const discordJs = require('discord.js');
      const mockWebhook = Array.from(discordJs._webhookMocks.values())[0];
      
      // Verify second call was detected as duplicate
      expect(result2).toBeDefined();
      expect(result2.isDuplicate).toBe(true);
      
      // Verify webhook.send was not called for the second message
      expect(mockWebhook.send).not.toHaveBeenCalled();
    });
    
    it('should handle webhook send errors', async () => {
      // Get the webhook mock and make it throw an error
      const discordJs = require('discord.js');
      const mockWebhook = new discordJs.WebhookClient({ url: 'test' });
      webhookManager.getOrCreateWebhook = jest.fn().mockResolvedValue(mockWebhook);
      
      // Make send throw an error
      mockWebhook.send.mockRejectedValueOnce(new Error('Webhook send failed'));
      
      // Call the function and expect it to throw
      await expect(webhookManager.sendWebhookMessage(
        mockChannel,
        'Test message',
        personality
      )).rejects.toThrow();
      
      // Verify error was logged
      expect(console.error).toHaveBeenCalled();
    });
    
    it('should handle missing personality', async () => {
      // Call with no personality
      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        'Test message',
        null
      );
      
      // Verify result contains message data
      expect(result).toBeDefined();
      
      // Get the webhook mock to verify the call
      const discordJs = require('discord.js');
      const mockWebhook = Array.from(discordJs._webhookMocks.values())[0];
      
      // Verify webhook.send was called with fallback username
      const sendArgs = mockWebhook.send.mock.calls[0][0];
      expect(sendArgs.username).toBe('Bot');
    });
    
    it('should detect and mark error messages', async () => {
      // List of error patterns to test
      const errorPatterns = [
        "I'm having trouble connecting to my knowledge base",
        "ERROR_MESSAGE_PREFIX: Sorry for the issue",
        "trouble connecting to my brain",
        "technical issue",
        "Error ID: abc123",
        "issue with my configuration",
        "issue with my response system",
        "momentary lapse in my systems",
        "try again later",
        "connection is unstable right now",
        "unable to formulate a response",
        "Please try again in a few minutes"
      ];
      
      // Check if each error pattern is detected
      for (const errorPattern of errorPatterns) {
        // Reset mocks
        jest.clearAllMocks();
        
        // Call with error message
        await webhookManager.sendWebhookMessage(
          mockChannel,
          errorPattern,
          personality
        );
        
        // Get the webhook mock to verify the call
        const discordJs = require('discord.js');
        const mockWebhook = Array.from(discordJs._webhookMocks.values())[0];
        
        // Verify send was called
        expect(mockWebhook.send).toHaveBeenCalled();
        
        // Get the content that was sent
        const sentContent = mockWebhook.send.mock.calls[0][0].content;
        
        // Verify content has ERROR_MESSAGE_PREFIX if it didn't already
        if (!errorPattern.includes('ERROR_MESSAGE_PREFIX:')) {
          expect(sentContent).toContain('ERROR_MESSAGE_PREFIX:');
        }
      }
    });
    
    it('should skip messages with HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY marker', async () => {
      // Create a message with the hard block marker
      const blockedMessage = 'This is a HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY message';
      
      // Call the function
      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        blockedMessage,
        personality
      );
      
      // Get the webhook mock
      const discordJs = require('discord.js');
      const mockWebhook = Array.from(discordJs._webhookMocks.values())[0];
      
      // Verify webhook.send was not called
      expect(mockWebhook.send).not.toHaveBeenCalled();
      
      // Verify result is a virtual result with isDuplicate flag
      expect(result).toBeDefined();
      expect(result.isDuplicate).toBe(true);
    });
    
    it('should track message IDs', async () => {
      // Call the function
      const result = await webhookManager.sendWebhookMessage(
        mockChannel,
        'Test message',
        personality
      );
      
      // Verify result contains message IDs
      expect(result).toBeDefined();
      expect(result.messageIds).toBeDefined();
      expect(result.messageIds.length).toBe(1);
      
      // Verify message ID is from the webhook response
      const sentMessage = result.message;
      expect(result.messageIds[0]).toBe(sentMessage.id);
    });
  });
  
  // isErrorWebhookMessage is an internal function, so we can't test it directly
});