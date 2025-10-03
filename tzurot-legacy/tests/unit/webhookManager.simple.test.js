/**
 * Simplified tests for avatar URL handling in webhookManager.js
 * This focuses only on the most essential functionality
 */

// Unmock webhookManager since it's globally mocked in setup.js
jest.unmock('../../src/webhookManager');

// Mock node-fetch
jest.mock('node-fetch', () => {
  return jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: header => (header.toLowerCase() === 'content-type' ? 'image/png' : null),
      },
      buffer: () => Promise.resolve(Buffer.from('fake image data')),
    })
  );
});

// Mock the logger
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
  getProfileAvatarUrl: jest.fn().mockResolvedValue(null), // Return null to simulate no avatar found
  deleteFromCache: jest.fn(),
}));

// Mock avatarManager since webhookManager delegates to it
jest.mock('../../src/utils/avatarManager', () => ({
  validateAvatarUrl: jest.fn(async url => {
    if (!url) return false;
    return true;
  }),
  getValidAvatarUrl: jest.fn(async url => {
    if (!url) return null;
    return url;
  }),
  preloadPersonalityAvatar: jest.fn(async () => {}),
  warmupAvatar: jest.fn(async () => {}),
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

// Constants
const FALLBACK_AVATAR_URL = 'https://cdn.discordapp.com/embed/avatars/0.png';

describe('WebhookManager Avatar URL Handling - Simplified Tests', () => {
  let webhookManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Import webhookManager after resetting modules
    webhookManager = require('../../src/webhookManager');
  });

  test('validateAvatarUrl should return false for invalid URLs', async () => {
    // Test with null URL
    expect(await webhookManager.validateAvatarUrl(null)).toBe(false);

    // Test with empty URL
    expect(await webhookManager.validateAvatarUrl('')).toBe(false);

    // Test with undefined URL
    expect(await webhookManager.validateAvatarUrl(undefined)).toBe(false);
  });

  test('getValidAvatarUrl should return null for null input', async () => {
    // This is the simplest test case that should always work
    expect(await webhookManager.getValidAvatarUrl(null)).toBe(null);
  });

  test('preloadPersonalityAvatar should delegate to avatarManager', async () => {
    // Create a personality without avatarUrl
    const personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
    };

    // Call the function
    await webhookManager.preloadPersonalityAvatar(personality);

    // Verify it delegated to avatarManager
    const avatarManager = require('../../src/utils/avatarManager');
    expect(avatarManager.preloadPersonalityAvatar).toHaveBeenCalledWith(personality);
  });

  test('preloadPersonalityAvatar should handle null personality gracefully', async () => {
    // This should not throw any errors
    await expect(webhookManager.preloadPersonalityAvatar(null)).resolves.not.toThrow();
  });
});
