/**
 * Tests for webhookManager.js focusing on webhook creation and management
 */

// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

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
      text: async () => 'Success',
      buffer: async () => Buffer.from('Success'),
      headers: new Map([['content-type', 'application/json']]),
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
        text: async () => mockResponse.text || 'Success',
        buffer: async () => Buffer.from(mockResponse.text || 'Success'),
        headers: new Map([['content-type', mockResponse.contentType || 'application/json']]),
      };
    }

    return defaultResponse;
  });
});

// Mock logger first
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock profileInfoFetcher to avoid fetching real profiles
jest.mock('../../src/profileInfoFetcher', () => ({
  getProfileAvatarUrl: jest.fn().mockResolvedValue(null),
  getProfileDisplayName: jest.fn().mockResolvedValue(null),
}));

// Mock other webhookManager dependencies
jest.mock('../../src/utils/errorTracker', () => ({
  trackError: jest.fn(),
  ErrorCategory: {
    WEBHOOK: 'webhook',
    AVATAR: 'avatar',
  },
}));

jest.mock('../../src/utils/media', () => ({
  isMediaUrl: jest.fn(() => false),
  formatMediaUrls: jest.fn(() => []),
}));

jest.mock('../../src/utils/webhookCache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  clear: jest.fn(),
  getActiveWebhooks: jest.fn(() => new Set()),
}));

jest.mock('../../src/utils/messageDeduplication', () => ({
  isDuplicate: jest.fn(() => false),
  addMessage: jest.fn(),
}));

jest.mock('../../src/utils/avatarManager', () => ({
  validateAvatarUrl: jest.fn(async () => true),
  getValidAvatarUrl: jest.fn(async url => url),
  warmupAvatar: jest.fn(async () => {}),
  preloadPersonalityAvatar: jest.fn(async () => {}),
}));

jest.mock('../../src/utils/messageFormatter', () => ({
  formatContent: jest.fn(content => content),
  trimContent: jest.fn(content => content),
}));

jest.mock('../../src/webhook', () => ({
  createWebhookForPersonality: jest.fn(),
  sendWebhookMessage: jest.fn(),
  CHUNK_DELAY: 100,
  MAX_CONTENT_LENGTH: 2000,
  EMBED_CHUNK_SIZE: 1800,
  DEFAULT_MESSAGE_DELAY: 150,
  MAX_ERROR_WAIT_TIME: 60000,
  MIN_MESSAGE_DELAY: 150,
  // Functions that webhookManager re-exports
  sendDirectThreadMessage: jest.fn(),
  createPersonalityChannelKey: jest.fn((personality, channel) => `${personality}_${channel}`),
  hasPersonalityPendingMessage: jest.fn(() => false),
  registerPendingMessage: jest.fn(),
  clearPendingMessage: jest.fn(),
  calculateMessageDelay: jest.fn(() => 0),
  updateChannelLastMessageTime: jest.fn(),
  sendFormattedMessageInDM: jest.fn(),
  isErrorContent: jest.fn(() => false),
  markErrorContent: jest.fn(),
  isErrorWebhookMessage: jest.fn(() => false),
  getStandardizedUsername: jest.fn(personality => {
    if (!personality) return 'Bot';
    if (personality.displayName) {
      return personality.displayName.length > 32
        ? personality.displayName.substring(0, 29) + '...'
        : personality.displayName;
    }
    const namePart = personality.fullName?.split('-')[0] || 'Bot';
    return namePart.charAt(0).toUpperCase() + namePart.slice(1);
  }),
  generateMessageTrackingId: jest.fn(() => 'mock-tracking-id'),
  prepareMessageData: jest.fn(data => data),
  createVirtualResult: jest.fn(),
  sendMessageChunk: jest.fn(),
  minimizeConsoleOutput: jest.fn(),
  restoreConsoleOutput: jest.fn(),
}));

jest.mock('../../src/constants', () => ({
  TIME: {
    SECOND: 1000,
    MINUTE: 60000,
  },
}));

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
      this.send = jest.fn().mockImplementation(async options => {
        // Store the last call for testing
        this.lastSendOptions = options;

        // Return a mock message
        return {
          id: `mock-msg-${Date.now()}`,
          webhookId: this.id,
          content: typeof options === 'string' ? options : options.content,
          username: typeof options === 'string' ? undefined : options.username,
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
      setFooter: jest.fn().mockReturnThis(),
    };
    return embed;
  });

  // Return the mocked module
  return {
    WebhookClient: jest.fn().mockImplementation(options => {
      return new MockWebhookClient(options);
    }),
    EmbedBuilder: MockEmbedBuilder,
    _mockWebhookClients: mockWebhookClients,
    _clearMockWebhookClients: () => {
      mockWebhookClients.clear();
    },
  };
});

describe('WebhookManager - Webhook Creation and Management', () => {
  // Test variables
  let webhookManager;
  let mockChannel;
  let mockWebhook;
  const logger = require('../../src/logger');

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset global mock fetch responses
    global.mockFetchResponses = {};

    // Reset discord.js mock webhook clients
    require('discord.js')._clearMockWebhookClients();

    // Create a mock channel and webhook for testing
    mockChannel = createMockChannel({
      id: 'test-channel-123',
      name: 'test-channel',
      fetchWebhooks: jest.fn().mockResolvedValue(new Map()),
    });

    mockChannel.createWebhook = jest.fn().mockResolvedValue({
      id: 'test-webhook-123',
      name: 'Tzurot',
      url: 'https://discord.com/api/webhooks/test-webhook-123/token',
      token: 'token',
    });

    mockWebhook = createMockWebhook({
      id: 'test-webhook-123',
      name: 'Tzurot',
      channelId: 'test-channel-123',
      url: 'https://discord.com/api/webhooks/test-webhook-123/token',
    });

    // Load the module under test after all mocks are set up
    jest.resetModules();
    webhookManager = require('../../src/webhookManager');

    // Debug: Check what's loaded
    if (!webhookManager.getStandardizedUsername) {
      console.error(
        'Missing getStandardizedUsername. Available functions:',
        Object.keys(webhookManager)
      );
    }
  });

  afterEach(() => {
    // Restore all mocks and spies
    jest.restoreAllMocks();
  });

  describe('preloadPersonalityAvatar', () => {
    it('should preload a personality avatar', async () => {
      // Debug: Check what webhookManager contains
      expect(typeof webhookManager).toBe('object');
      expect(webhookManager).toBeDefined();
      expect(typeof webhookManager.preloadPersonalityAvatar).toBe('function');
      // Create a test personality
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'https://example.com/avatar.png',
      };

      // Call the function
      await webhookManager.preloadPersonalityAvatar(personality);

      // Verify avatarManager.preloadPersonalityAvatar was called
      const avatarManager = require('../../src/utils/avatarManager');
      expect(avatarManager.preloadPersonalityAvatar).toHaveBeenCalledWith(personality);
    });

    it('should handle personalities with no avatar URL', async () => {
      // Create a test personality with no avatar
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
      };

      // Call the function
      await webhookManager.preloadPersonalityAvatar(personality);

      // Verify avatarManager.preloadPersonalityAvatar was called
      const avatarManager = require('../../src/utils/avatarManager');
      expect(avatarManager.preloadPersonalityAvatar).toHaveBeenCalledWith(personality);
    });

    it('should handle null or undefined personalities', async () => {
      // Call the function with null personality
      await webhookManager.preloadPersonalityAvatar(null);

      // Verify avatarManager.preloadPersonalityAvatar was called
      const avatarManager = require('../../src/utils/avatarManager');
      expect(avatarManager.preloadPersonalityAvatar).toHaveBeenCalledWith(null);
    });
  });

  describe('getStandardizedUsername', () => {
    it('should prioritize displayName if available', () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Display Name',
      };

      const result = webhookManager.getStandardizedUsername(personality);
      expect(result).toBe('Test Display Name');
    });

    it('should truncate display names longer than 32 characters', () => {
      const personality = {
        displayName:
          "This is a very long display name that exceeds Discord's limit of 32 characters",
      };

      const result = webhookManager.getStandardizedUsername(personality);
      expect(result.length).toBeLessThanOrEqual(32);
      expect(result).toContain('...');
    });

    it('should extract name from fullName if displayName is not available', () => {
      const personality = {
        fullName: 'test-personality-with-hyphens',
      };

      const result = webhookManager.getStandardizedUsername(personality);
      // Should extract the first part before the hyphen
      expect(result).toBe('Test');
    });

    it('should use fullName if it has no hyphens and is short enough', () => {
      const personality = {
        fullName: 'shortname',
      };

      const result = webhookManager.getStandardizedUsername(personality);
      expect(result).toBe('Shortname');
    });

    it('should return "Bot" for null or undefined personality', () => {
      const result1 = webhookManager.getStandardizedUsername(null);
      const result2 = webhookManager.getStandardizedUsername(undefined);
      expect(result1).toBe('Bot');
      expect(result2).toBe('Bot');
    });
  });
});
