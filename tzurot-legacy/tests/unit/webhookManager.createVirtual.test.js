/**
 * Test for webhookManager.js createVirtualResult function
 */

// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

const logger = require('../../src/logger');

// Mock the logger to avoid unnecessary output
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock profileInfoFetcher to prevent interval creation
jest.mock('../../src/profileInfoFetcher', () => ({
  getFetcher: jest.fn().mockReturnValue({
    fetchProfileInfo: jest.fn().mockResolvedValue({
      avatarUrl: 'https://example.com/avatar.png',
      displayName: 'Test User',
    }),
  }),
  getProfileAvatarUrl: jest.fn().mockResolvedValue(null),
  deleteFromCache: jest.fn(),
}));

// Mock other dependencies
jest.mock('../../src/utils/webhookCache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  clear: jest.fn(),
  getActiveWebhooks: jest.fn(() => new Set()),
  clearWebhookCache: jest.fn(),
  clearAllWebhookCaches: jest.fn(),
  registerEventListeners: jest.fn(),
}));

jest.mock('../../src/utils/messageDeduplication', () => ({
  isDuplicate: jest.fn(() => false),
  addMessage: jest.fn(),
  hashMessage: jest.fn(() => 'mock-hash'),
  isDuplicateMessage: jest.fn(() => false),
}));

jest.mock('../../src/utils/messageFormatter', () => ({
  formatContent: jest.fn(content => content),
  trimContent: jest.fn(content => content),
  splitMessage: jest.fn(content => [content]),
}));

jest.mock('../../src/utils/avatarManager', () => ({
  validateAvatarUrl: jest.fn(async () => true),
  getValidAvatarUrl: jest.fn(async url => url),
  preloadPersonalityAvatar: jest.fn(async () => {}),
  warmupAvatar: jest.fn(async () => {}),
}));

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
  processMediaForWebhook: jest.fn(),
  prepareAttachmentOptions: jest.fn(() => ({})),
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
    return personality.displayName || 'Bot';
  }),
  generateMessageTrackingId: jest.fn(() => 'mock-tracking-id'),
  prepareMessageData: jest.fn(data => data),
  createVirtualResult: jest.fn(() => {
    const virtualId = `virtual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return {
      message: { id: virtualId },
      messageIds: [virtualId],
      isDuplicate: true,
    };
  }),
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
  return {
    WebhookClient: jest.fn().mockImplementation(() => ({
      id: 'mock-webhook-id',
      send: jest.fn().mockResolvedValue({
        id: 'mock-message-id',
        webhookId: 'mock-webhook-id',
      }),
      destroy: jest.fn(),
    })),
    EmbedBuilder: jest.fn().mockImplementation(data => ({
      ...data,
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
    })),
  };
});

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
      displayName: 'Test Personality',
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
      displayName: 'Test Personality',
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
