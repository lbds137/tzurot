/**
 * Tests for messageDeduplication.js
 */

// Mock logger
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../../src/logger');
const messageDeduplication = require('../../../src/utils/messageDeduplication');

describe('messageDeduplication', () => {
  // Store original Date.now
  const originalDateNow = Date.now;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the cache before each test
    messageDeduplication.clearCache();
    // Reset Date.now
    Date.now = originalDateNow;
  });

  afterEach(() => {
    // Restore Date.now
    Date.now = originalDateNow;
  });

  describe('hashMessage', () => {
    it('should create consistent hashes for the same input', () => {
      const content = 'Test message content';
      const username = 'TestUser';
      const channelId = 'channel-123';

      const hash1 = messageDeduplication.hashMessage(content, username, channelId);
      const hash2 = messageDeduplication.hashMessage(content, username, channelId);

      expect(hash1).toBe(hash2);
    });

    it('should create different hashes for different content', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      const hash1 = messageDeduplication.hashMessage('Content 1', username, channelId);
      const hash2 = messageDeduplication.hashMessage('Content 2', username, channelId);

      expect(hash1).not.toBe(hash2);
    });

    it('should create different hashes for different usernames', () => {
      const content = 'Test message';
      const channelId = 'channel-123';

      const hash1 = messageDeduplication.hashMessage(content, 'User1', channelId);
      const hash2 = messageDeduplication.hashMessage(content, 'User2', channelId);

      expect(hash1).not.toBe(hash2);
    });

    it('should create different hashes for different channels', () => {
      const content = 'Test message';
      const username = 'TestUser';

      const hash1 = messageDeduplication.hashMessage(content, username, 'channel-1');
      const hash2 = messageDeduplication.hashMessage(content, username, 'channel-2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty or null content', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      const hash1 = messageDeduplication.hashMessage('', username, channelId);
      const hash2 = messageDeduplication.hashMessage(null, username, channelId);
      const hash3 = messageDeduplication.hashMessage(undefined, username, channelId);

      // All should produce valid hashes
      expect(hash1).toBeTruthy();
      expect(hash2).toBeTruthy();
      expect(hash3).toBeTruthy();

      // All should be the same since they're all empty
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should create different hashes for messages with different endings', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      const longContent1 = 'A'.repeat(100) + 'different ending 1';
      const longContent2 = 'A'.repeat(100) + 'different ending 2';

      const hash1 = messageDeduplication.hashMessage(longContent1, username, channelId);
      const hash2 = messageDeduplication.hashMessage(longContent2, username, channelId);

      // Should be different since we now check multiple parts of the message
      expect(hash1).not.toBe(hash2);
    });

    it('should remove spaces from content when hashing', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      const hash1 = messageDeduplication.hashMessage('Test Message', username, channelId);
      const hash2 = messageDeduplication.hashMessage('TestMessage', username, channelId);

      expect(hash1).toBe(hash2);
    });
  });

  describe('isDuplicateMessage', () => {
    it('should return false for empty content', () => {
      expect(messageDeduplication.isDuplicateMessage('', 'user', 'channel')).toBe(false);
      expect(messageDeduplication.isDuplicateMessage(null, 'user', 'channel')).toBe(false);
      expect(messageDeduplication.isDuplicateMessage(undefined, 'user', 'channel')).toBe(false);
    });

    it('should return false for first occurrence of a message', () => {
      const result = messageDeduplication.isDuplicateMessage(
        'Test message',
        'TestUser',
        'channel-123'
      );

      expect(result).toBe(false);
      expect(messageDeduplication.getCacheSize()).toBe(1);
    });

    it('should return true for duplicate message within timeout', () => {
      const content = 'Test message';
      const username = 'TestUser';
      const channelId = 'channel-123';

      // First message
      expect(messageDeduplication.isDuplicateMessage(content, username, channelId)).toBe(false);

      // Duplicate message immediately after
      expect(messageDeduplication.isDuplicateMessage(content, username, channelId)).toBe(true);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Detected duplicate message')
      );
    });

    it('should return false for same message after timeout', () => {
      const content = 'Test message';
      const username = 'TestUser';
      const channelId = 'channel-123';

      // Mock time
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);

      // First message
      expect(messageDeduplication.isDuplicateMessage(content, username, channelId)).toBe(false);

      // Advance time beyond duplicate timeout (5 seconds)
      currentTime += 6000;

      // Same message should not be considered duplicate
      expect(messageDeduplication.isDuplicateMessage(content, username, channelId)).toBe(false);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('have passed'));
    });

    it('should handle multiple different messages', () => {
      const username = 'TestUser';
      const channelId = 'channel-123';

      expect(messageDeduplication.isDuplicateMessage('Message 1', username, channelId)).toBe(false);
      expect(messageDeduplication.isDuplicateMessage('Message 2', username, channelId)).toBe(false);
      expect(messageDeduplication.isDuplicateMessage('Message 3', username, channelId)).toBe(false);

      expect(messageDeduplication.getCacheSize()).toBe(3);
    });

    it('should clean up old entries automatically', () => {
      // Mock time
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);

      // Add some messages
      messageDeduplication.isDuplicateMessage('Old message 1', 'user', 'channel');
      messageDeduplication.isDuplicateMessage('Old message 2', 'user', 'channel');

      expect(messageDeduplication.getCacheSize()).toBe(2);

      // Advance time beyond cleanup timeout (10 seconds)
      currentTime += 11000;

      // Add a new message which should trigger cleanup
      messageDeduplication.isDuplicateMessage('New message', 'user', 'channel');

      // Old messages should be cleaned up
      expect(messageDeduplication.getCacheSize()).toBe(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 2 old cache entries')
      );
    });
  });

  describe('utility functions', () => {
    it('clearCache should remove all entries', () => {
      // Add some messages
      messageDeduplication.isDuplicateMessage('Message 1', 'user', 'channel');
      messageDeduplication.isDuplicateMessage('Message 2', 'user', 'channel');

      expect(messageDeduplication.getCacheSize()).toBe(2);

      messageDeduplication.clearCache();

      expect(messageDeduplication.getCacheSize()).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleared message cache (2 entries)')
      );
    });

    it('addToCache should manually add entries', () => {
      const content = 'Test message';
      const username = 'TestUser';
      const channelId = 'channel-123';

      messageDeduplication.addToCache(content, username, channelId);

      // Should now be detected as duplicate
      expect(messageDeduplication.isDuplicateMessage(content, username, channelId)).toBe(true);
    });

    it('addToCache should accept custom timestamp', () => {
      const content = 'Test message';
      const username = 'TestUser';
      const channelId = 'channel-123';
      const customTime = 12345;

      messageDeduplication.addToCache(content, username, channelId, customTime);

      const hash = messageDeduplication.hashMessage(content, username, channelId);
      expect(messageDeduplication._recentMessageCache.get(hash)).toBe(customTime);
    });

    it('hasHash should check for specific hash', () => {
      const content = 'Test message';
      const username = 'TestUser';
      const channelId = 'channel-123';

      const hash = messageDeduplication.hashMessage(content, username, channelId);

      expect(messageDeduplication.hasHash(hash)).toBe(false);

      messageDeduplication.addToCache(content, username, channelId);

      expect(messageDeduplication.hasHash(hash)).toBe(true);
    });

    it('getAllHashes should return all cached hashes', () => {
      messageDeduplication.isDuplicateMessage('Message 1', 'user1', 'channel1');
      messageDeduplication.isDuplicateMessage('Message 2', 'user2', 'channel2');

      const hashes = messageDeduplication.getAllHashes();

      expect(hashes).toHaveLength(2);
      expect(hashes).toContain('channel1_user1_Message1');
      expect(hashes).toContain('channel2_user2_Message2');
    });

    it('cleanupOldEntries should be callable directly', () => {
      // Mock time
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);

      // Add an old message
      messageDeduplication.addToCache('Old message', 'user', 'channel', currentTime - 15000);

      expect(messageDeduplication.getCacheSize()).toBe(1);

      // Manual cleanup
      messageDeduplication.cleanupOldEntries();

      expect(messageDeduplication.getCacheSize()).toBe(0);
    });
  });

  describe('constants', () => {
    it('should export expected timeout values', () => {
      expect(messageDeduplication.DUPLICATE_DETECTION_TIMEOUT).toBe(5000);
      expect(messageDeduplication.CLEANUP_TIMEOUT).toBe(10000);
    });
  });
});
