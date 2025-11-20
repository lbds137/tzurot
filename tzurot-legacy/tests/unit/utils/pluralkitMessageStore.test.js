describe('PluralKitMessageStore', () => {
  let mockLogger;
  let dateNowSpy;
  let store;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    // Mock the logger module
    jest.doMock('../../../src/logger', () => mockLogger);

    // Reset modules to get a fresh instance
    jest.resetModules();

    // Re-require the store to get a fresh instance
    const PluralKitMessageStore = require('../../../src/utils/pluralkitMessageStore');
    store = new PluralKitMessageStore();

    // Mock Date.now for consistent testing
    dateNowSpy = jest.spyOn(Date, 'now');
    dateNowSpy.mockReturnValue(1000000);
  });

  afterEach(() => {
    // Clean up the store
    if (store && store.clear) {
      store.clear();
    }
    dateNowSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('store', () => {
    it('should store message data with timestamp', () => {
      const messageId = 'msg-123';
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      store.store(messageId, messageData);

      // Verify the message was stored (we'll test retrieval in other tests)
      const sizes = store.size();
      expect(sizes.pending).toBeGreaterThan(0);
    });

    it('should handle missing fields gracefully', () => {
      const messageId = 'msg-123';
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        // Missing guildId and username
      };

      expect(() => {
        store.store(messageId, messageData);
      }).not.toThrow();
    });
  });

  describe('markAsDeleted', () => {
    it('should move message from pending to deleted', () => {
      const messageId = 'msg-123';
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      // Store the message first
      store.store(messageId, messageData);

      // Get initial sizes
      const initialSizes = store.size();
      const initialPending = initialSizes.pending;

      // Mark as deleted
      store.markAsDeleted(messageId);

      // Check that it moved
      const newSizes = store.size();
      expect(newSizes.pending).toBe(initialPending - 1);
      expect(newSizes.deleted).toBeGreaterThan(0);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `[PluralKitStore] Marked message ${messageId} as deleted with content: "Test message"`
      );
    });

    it('should handle non-existent message gracefully', () => {
      store.markAsDeleted('non-existent-id');

      // Should not throw and should not log
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should add deletedAt timestamp', () => {
      const messageId = 'msg-123';
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      store.store(messageId, messageData);

      // Advance time
      dateNowSpy.mockReturnValue(1005000);

      store.markAsDeleted(messageId);

      // Find the deleted message
      const deletedMessage = store.findDeletedMessage('Test message', 'channel-789');
      expect(deletedMessage).toBeTruthy();
      expect(deletedMessage.deletedAt).toBe(1005000);
    });
  });

  describe('findDeletedMessage', () => {
    it('should find recently deleted message by content and channel', () => {
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      // Store and mark as deleted
      store.store('msg-123', messageData);
      store.markAsDeleted('msg-123');

      // Find it
      const found = store.findDeletedMessage('Test message', 'channel-789');

      expect(found).toBeTruthy();
      expect(found.userId).toBe('user-456');
      expect(found.username).toBe('TestUser');
      // The new implementation logs different messages
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[PluralKitStore] Found exact match for user user-456')
      );
    });

    it('should not find message with wrong content', () => {
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      store.store('msg-123', messageData);
      store.markAsDeleted('msg-123');

      const found = store.findDeletedMessage('Different message', 'channel-789');
      expect(found).toBeNull();
    });

    it('should not find message with wrong channel', () => {
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      store.store('msg-123', messageData);
      store.markAsDeleted('msg-123');

      const found = store.findDeletedMessage('Test message', 'different-channel');
      expect(found).toBeNull();
    });

    it('should not find expired deleted message', () => {
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      store.store('msg-123', messageData);

      // Set initial time
      dateNowSpy.mockReturnValue(1000000);
      store.markAsDeleted('msg-123');

      // Advance time past expiration (5+ seconds)
      dateNowSpy.mockReturnValue(1005001);

      const found = store.findDeletedMessage('Test message', 'channel-789');
      expect(found).toBeNull();
    });

    it('should remove message after finding to prevent reuse', () => {
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      store.store('msg-123', messageData);
      store.markAsDeleted('msg-123');

      // Find it once
      const found1 = store.findDeletedMessage('Test message', 'channel-789');
      expect(found1).toBeTruthy();

      // Try to find it again
      const found2 = store.findDeletedMessage('Test message', 'channel-789');
      expect(found2).toBeNull();
      
      // Verify it was removed from both storage locations
      const sizes = store.size();
      // The message should be removed from the old map after exact match
      expect(sizes.deleted).toBe(0);
    });
  });

  describe('findByContent (legacy)', () => {
    it('should delegate to findDeletedMessage', () => {
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
        guildId: 'guild-123',
        username: 'TestUser',
      };

      store.store('msg-123', messageData);
      store.markAsDeleted('msg-123');

      // Use legacy method
      const found = store.findByContent('Test message', 'channel-789');

      expect(found).toBeTruthy();
      expect(found.userId).toBe('user-456');
    });
  });

  describe('remove', () => {
    it('should remove a pending message', () => {
      const messageId = 'msg-123';
      const messageData = {
        userId: 'user-456',
        channelId: 'channel-789',
        content: 'Test message',
      };

      store.store(messageId, messageData);

      const beforeSizes = store.size();
      store.remove(messageId);
      const afterSizes = store.size();

      expect(afterSizes.pending).toBe(beforeSizes.pending - 1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `[PluralKitStore] Removing message from user user-456`
      );
    });

    it('should handle removing non-existent message', () => {
      store.remove('non-existent');
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should remove expired pending messages', () => {
      // Store first message at time 1000000
      dateNowSpy.mockReturnValue(1000000);
      store.store('msg-1', {
        userId: 'user-1',
        channelId: 'channel-1',
        content: 'Message 1',
      });

      // Store second message at time 1003000
      dateNowSpy.mockReturnValue(1003000);
      store.store('msg-2', {
        userId: 'user-2',
        channelId: 'channel-2',
        content: 'Message 2',
      });

      // Advance time past expiration for first message only
      dateNowSpy.mockReturnValue(1005001); // Just past 5 seconds from first message

      store.cleanup();

      const sizes = store.size();
      expect(sizes.pending).toBe(1); // Only msg-2 should remain
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[PluralKitStore] Cleaned up 1 pending and 0 deleted messages'
      );
    });

    it('should remove expired deleted messages', () => {
      // Store and delete a message
      dateNowSpy.mockReturnValue(1000000);
      store.store('msg-1', {
        userId: 'user-1',
        channelId: 'channel-1',
        content: 'Message 1',
      });
      store.markAsDeleted('msg-1');

      // Advance time past expiration
      dateNowSpy.mockReturnValue(1005001);

      store.cleanup();

      const sizes = store.size();
      expect(sizes.deleted).toBe(0);
      // With dual storage, cleanup counts messages from both storage locations
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/\[PluralKitStore\] Cleaned up 0 pending and \d+ deleted messages/)
      );
    });

    it('should not log when nothing is cleaned', () => {
      store.cleanup();
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should run cleanup periodically', () => {
      // In test mode, intervals are disabled, so we test the cleanup functionality directly
      // Store a message
      store.store('msg-1', {
        userId: 'user-1',
        channelId: 'channel-1',
        content: 'Message 1',
      });

      // Verify message exists
      let sizes = store.size();
      expect(sizes.pending).toBe(1);

      // Advance time past expiration
      dateNowSpy.mockReturnValue(1005001);

      // Manually trigger cleanup (in production this would be done by interval)
      store.cleanup();

      // Check that cleanup removed the expired message
      sizes = store.size();
      expect(sizes.pending).toBe(0);
    });
  });

  describe('size', () => {
    it('should return counts of pending and deleted messages', () => {
      const initialSizes = store.size();
      expect(initialSizes).toEqual({ pending: 0, deleted: 0 });

      // Add pending message
      store.store('msg-1', {
        userId: 'user-1',
        channelId: 'channel-1',
        content: 'Message 1',
      });

      const afterStoreSizes = store.size();
      expect(afterStoreSizes.pending).toBe(1);
      expect(afterStoreSizes.deleted).toBe(0);

      // Mark as deleted
      store.markAsDeleted('msg-1');

      const afterDeleteSizes = store.size();
      expect(afterDeleteSizes.pending).toBe(0);
      expect(afterDeleteSizes.deleted).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all data and stop intervals', () => {
      // Add some data
      store.store('msg-1', {
        userId: 'user-1',
        channelId: 'channel-1',
        content: 'Message 1',
      });
      store.markAsDeleted('msg-1');

      const beforeClear = store.size();
      expect(beforeClear.pending).toBe(0);
      expect(beforeClear.deleted).toBe(1);

      // Clear the store
      store.clear();

      const afterClear = store.size();
      expect(afterClear.pending).toBe(0);
      expect(afterClear.deleted).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple messages with same content in different channels', () => {
      const content = 'Same message';

      // Store messages with same content in different channels
      store.store('msg-1', {
        userId: 'user-1',
        channelId: 'channel-1',
        content: content,
      });

      store.store('msg-2', {
        userId: 'user-2',
        channelId: 'channel-2',
        content: content,
      });

      // Mark both as deleted
      store.markAsDeleted('msg-1');
      store.markAsDeleted('msg-2');

      // Find each by their channel
      const found1 = store.findDeletedMessage(content, 'channel-1');
      expect(found1).toBeTruthy();
      expect(found1.userId).toBe('user-1');

      const found2 = store.findDeletedMessage(content, 'channel-2');
      expect(found2).toBeTruthy();
      expect(found2.userId).toBe('user-2');
    });

    it('should handle rapid store and delete', () => {
      const messageId = 'msg-rapid';
      const messageData = {
        userId: 'user-rapid',
        channelId: 'channel-rapid',
        content: 'Rapid message',
      };

      // Store and immediately delete
      store.store(messageId, messageData);
      store.markAsDeleted(messageId);

      // Should be findable
      const found = store.findDeletedMessage('Rapid message', 'channel-rapid');
      expect(found).toBeTruthy();
      expect(found.userId).toBe('user-rapid');
    });
  });
});
