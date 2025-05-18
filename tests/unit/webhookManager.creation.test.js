/**
 * Tests for webhookManager.js focusing on webhook creation and management
 */

// Import mock utilities
const { createMockChannel, createMockWebhook } = require('../utils/discordMocks');

// Mock node-fetch
jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation(async (url, requestOptions = {}) => {
    // Default to a successful response
    const defaultResponse = {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => "Success",
      buffer: async () => Buffer.from("Success"),
      headers: new Map([['content-type', 'application/json']])
    };
    
    // Allow tests to provide custom mock responses
    if (global.mockFetchResponses && global.mockFetchResponses[url]) {
      const mockResponse = global.mockFetchResponses[url];
      
      // If it's set to throw an error, do so
      if (mockResponse.shouldThrow) {
        if (mockResponse.abortError) {
          // Simulate an AbortError
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          throw error;
        } else {
          throw new Error(`Mock error for URL: ${url}`);
        }
      }
      
      // Return a custom response
      return {
        ok: mockResponse.ok !== undefined ? mockResponse.ok : true,
        status: mockResponse.status || 200,
        json: async () => mockResponse.data || { success: true },
        text: async () => mockResponse.text || "Success",
        buffer: async () => Buffer.from(mockResponse.text || "Success"),
        headers: new Map([['content-type', mockResponse.contentType || 'application/json']])
      };
    }
    
    return defaultResponse;
  });
});

// Mock discord.js
jest.mock('discord.js', () => {
  const mockWebhookClients = new Map();
  
  // Create a mock WebhookClient class
  class MockWebhookClient {
    constructor(options) {
      this.id = options.id || 'mock-webhook-id';
      this.url = options.url;
      this.channelId = options.channelId || 'mock-channel-id';
      
      // Store this instance for test assertions
      if (this.url) {
        mockWebhookClients.set(this.url, this);
      }
      
      // Create spy methods
      this.send = jest.fn().mockImplementation(async (options) => {
        // Store the last call for testing
        this.lastSendOptions = options;
        
        // Return a mock message
        return {
          id: `mock-msg-${Date.now()}`,
          webhookId: this.id,
          content: typeof options === 'string' ? options : options.content,
          username: typeof options === 'string' ? undefined : options.username
        };
      });
      
      this.destroy = jest.fn();
    }
  }
  
  // Create a mock EmbedBuilder
  const MockEmbedBuilder = jest.fn().mockImplementation((data = {}) => {
    const embed = {
      ...data,
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setThumbnail: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis()
    };
    return embed;
  });
  
  // Return the mocked module
  return {
    WebhookClient: jest.fn().mockImplementation((options) => {
      return new MockWebhookClient(options);
    }),
    EmbedBuilder: MockEmbedBuilder,
    _mockWebhookClients: mockWebhookClients,
    _clearMockWebhookClients: () => {
      mockWebhookClients.clear();
    }
  };
});

// Import the module after mocking dependencies
let webhookManager;

describe('WebhookManager - Webhook Creation and Management', () => {
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // Test variables
  let mockChannel;
  let mockWebhook;
  
  beforeEach(() => {
    // Mock console methods to prevent noisy output
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset global mock fetch responses
    global.mockFetchResponses = {};
    
    // Reset discord.js mock webhook clients
    require('discord.js')._clearMockWebhookClients();
    
    // Ensure module is freshly loaded
    jest.resetModules();
    webhookManager = require('../../src/webhookManager');
    
    // Create a mock channel and webhook for testing
    mockChannel = createMockChannel({
      id: 'test-channel-123',
      name: 'test-channel',
      fetchWebhooks: jest.fn().mockResolvedValue(new Map())
    });
    
    mockChannel.createWebhook = jest.fn().mockResolvedValue({
      id: 'test-webhook-123',
      name: 'Tzurot',
      url: 'https://discord.com/api/webhooks/test-webhook-123/token',
      token: 'token'
    });
    
    mockWebhook = createMockWebhook({
      id: 'test-webhook-123',
      name: 'Tzurot',
      channelId: 'test-channel-123',
      url: 'https://discord.com/api/webhooks/test-webhook-123/token'
    });
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });
  
  // warmupAvatarUrl is an internal function, so we can't test it directly
  
  // Let's focus on the exported functions that we can actually test
  
  // We need to focus our tests on functions that are actually exported
  
  describe('preloadPersonalityAvatar', () => {
    it('should preload a personality avatar', async () => {
      // Create a test personality
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png'
      };
      
      // Call the function
      await webhookManager.preloadPersonalityAvatar(personality);
      
      // Verify fetch was called with the avatar URL
      const fetch = require('node-fetch');
      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/avatar.png',
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(Object)
        })
      );
    });
    
    it('should handle personalities with no avatar URL', async () => {
      // Create a test personality with no avatar
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality'
      };
      
      // Call the function
      await webhookManager.preloadPersonalityAvatar(personality);
      
      // Verify fetch was not called
      const fetch = require('node-fetch');
      expect(fetch).not.toHaveBeenCalled();
      
      // Verify warning was logged
      expect(console.warn).toHaveBeenCalled();
    });
    
    it('should handle null or undefined personalities', async () => {
      // Call the function with null and undefined
      await webhookManager.preloadPersonalityAvatar(null);
      await webhookManager.preloadPersonalityAvatar(undefined);
      
      // Verify fetch was not called
      const fetch = require('node-fetch');
      expect(fetch).not.toHaveBeenCalled();
      
      // Verify error was logged
      expect(console.error).toHaveBeenCalled();
    });
  });
  
  describe('getStandardizedUsername', () => {
    it('should prioritize displayName if available', () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Display Name'
      };
      
      const result = webhookManager.getStandardizedUsername(personality);
      expect(result).toBe('Test Display Name');
    });
    
    it('should truncate display names longer than 32 characters', () => {
      const personality = {
        displayName: 'This is a very long display name that exceeds Discord\'s limit of 32 characters'
      };
      
      const result = webhookManager.getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
      expect(result).toContain('...');
    });
    
    it('should extract name from fullName if displayName is not available', () => {
      const personality = {
        fullName: 'test-personality-with-hyphens'
      };
      
      const result = webhookManager.getStandardizedUsername(personality);
      // Should capitalize the first part of the hyphenated name
      expect(result).toBe('Test');
    });
    
    it('should use fullName if it has no hyphens and is short enough', () => {
      const personality = {
        fullName: 'shortname'
      };
      
      const result = webhookManager.getStandardizedUsername(personality);
      // Should capitalize the first letter
      expect(result).toBe('Shortname');
    });
    
    it('should return "Bot" for null or undefined personality', () => {
      expect(webhookManager.getStandardizedUsername(null)).toBe('Bot');
      expect(webhookManager.getStandardizedUsername(undefined)).toBe('Bot');
    });
  });
});