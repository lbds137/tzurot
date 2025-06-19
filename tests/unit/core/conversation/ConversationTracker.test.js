const ConversationTracker = require('../../../../src/core/conversation/ConversationTracker');

// Mock logger
jest.mock('../../../../src/logger');

describe('ConversationTracker', () => {
  let tracker;
  let originalDateNow;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create a new tracker instance with disabled cleanup
    tracker = new ConversationTracker({ enableCleanup: false });

    // Save original Date.now
    originalDateNow = Date.now;
  });

  afterEach(() => {
    // Clean up
    tracker.stopCleanup();

    // Restore timers
    jest.useRealTimers();

    // Restore Date.now
    Date.now = originalDateNow;
  });

  describe('recordConversation', () => {
    it('should record a conversation with single message ID', () => {
      const conversationData = {
        userId: 'user123',
        channelId: 'channel456',
        messageIds: 'msg789',
        personalityName: 'TestPersonality',
        isDM: false,
        isMentionOnly: false,
      };

      tracker.recordConversation(conversationData);

      // Verify conversation is recorded
      const key = `${conversationData.userId}-${conversationData.channelId}`;
      const recorded = tracker.activeConversations.get(key);

      expect(recorded).toBeDefined();
      expect(recorded.personalityName).toBe('TestPersonality');
      expect(recorded.messageIds).toEqual(['msg789']);
      expect(recorded.isDM).toBe(false);
      expect(recorded.isMentionOnly).toBe(false);

      // Verify message mapping
      const messageData = tracker.messageIdMap.get('msg789');
      expect(messageData).toBeDefined();
      expect(messageData.personalityName).toBe('TestPersonality');
    });

    it('should record a conversation with multiple message IDs', () => {
      const conversationData = {
        userId: 'user123',
        channelId: 'channel456',
        messageIds: ['msg1', 'msg2', 'msg3'],
        personalityName: 'TestPersonality',
        isDM: true,
        isMentionOnly: false,
      };

      tracker.recordConversation(conversationData);

      // Verify all message IDs are mapped
      expect(tracker.messageIdMap.get('msg1')).toBeDefined();
      expect(tracker.messageIdMap.get('msg2')).toBeDefined();
      expect(tracker.messageIdMap.get('msg3')).toBeDefined();

      // All should point to same personality
      expect(tracker.messageIdMap.get('msg1').personalityName).toBe('TestPersonality');
      expect(tracker.messageIdMap.get('msg2').personalityName).toBe('TestPersonality');
      expect(tracker.messageIdMap.get('msg3').personalityName).toBe('TestPersonality');
    });
  });

  describe('getActivePersonality', () => {
    beforeEach(() => {
      // Record a test conversation
      tracker.recordConversation({
        userId: 'user123',
        channelId: 'channel456',
        messageIds: 'msg789',
        personalityName: 'TestPersonality',
        isDM: false,
        isMentionOnly: false,
      });
    });

    it('should return personality for active conversation with auto-response enabled', () => {
      const personality = tracker.getActivePersonality('user123', 'channel456', false, true);
      expect(personality).toBe('TestPersonality');
    });

    it('should return null for guild channel without auto-response', () => {
      const personality = tracker.getActivePersonality('user123', 'channel456', false, false);
      expect(personality).toBeNull();
    });

    it('should return personality for DM channel regardless of auto-response', () => {
      // Record a DM conversation
      tracker.recordConversation({
        userId: 'dmuser',
        channelId: 'dmchannel',
        messageIds: 'dmmsg',
        personalityName: 'DMPersonality',
        isDM: true,
        isMentionOnly: false,
      });

      const personality = tracker.getActivePersonality('dmuser', 'dmchannel', true, false);
      expect(personality).toBe('DMPersonality');
    });

    it('should return null for mention-only conversation in guild channel', () => {
      // Record a mention-only conversation
      tracker.recordConversation({
        userId: 'mentionuser',
        channelId: 'mentionchannel',
        messageIds: 'mentionmsg',
        personalityName: 'MentionPersonality',
        isDM: false,
        isMentionOnly: true,
      });

      const personality = tracker.getActivePersonality(
        'mentionuser',
        'mentionchannel',
        false,
        true
      );
      expect(personality).toBeNull();
    });

    it('should return null for stale conversation', () => {
      // Mock time to make conversation stale
      Date.now = jest.fn().mockReturnValueOnce(Date.now() + 31 * 60 * 1000); // 31 minutes later

      const personality = tracker.getActivePersonality('user123', 'channel456', false, true);
      expect(personality).toBeNull();
    });

    it('should use extended timeout for DM conversations', () => {
      // Record a DM conversation
      tracker.recordConversation({
        userId: 'dmuser2',
        channelId: 'dmchannel2',
        messageIds: 'dmmsg2',
        personalityName: 'DMPersonality2',
        isDM: true,
        isMentionOnly: false,
      });

      // Mock time to 90 minutes later (within DM timeout)
      const currentTime = originalDateNow();
      Date.now = jest.fn().mockReturnValueOnce(currentTime + 90 * 60 * 1000);

      const personality = tracker.getActivePersonality('dmuser2', 'dmchannel2', true, false);
      expect(personality).toBe('DMPersonality2');

      // Mock time to 121 minutes later (beyond DM timeout)
      const baseTime = originalDateNow();
      Date.now = jest.fn().mockReturnValueOnce(baseTime + 121 * 60 * 1000);

      const personality2 = tracker.getActivePersonality('dmuser2', 'dmchannel2', true, false);
      expect(personality2).toBeNull();
    });
  });

  describe('getConversationByMessageId', () => {
    it('should find conversation by message ID', () => {
      tracker.recordConversation({
        userId: 'user123',
        channelId: 'channel456',
        messageIds: 'msg789',
        personalityName: 'TestPersonality',
        isDM: false,
        isMentionOnly: false,
      });

      const data = tracker.getConversationByMessageId('msg789');
      expect(data).toBeDefined();
      expect(data.personalityName).toBe('TestPersonality');
    });

    it('should support legacy lastMessageId', () => {
      // Manually add a legacy conversation
      tracker.activeConversations.set('legacy-key', {
        personalityName: 'LegacyPersonality',
        lastMessageId: 'legacy123',
        timestamp: Date.now(),
      });

      const data = tracker.getConversationByMessageId('legacy123');
      expect(data).toBeDefined();
      expect(data.personalityName).toBe('LegacyPersonality');
    });

    it('should return null for unknown message ID', () => {
      const data = tracker.getConversationByMessageId('unknown-id');
      expect(data).toBeNull();
    });
  });

  describe('clearConversation', () => {
    it('should clear an existing conversation', () => {
      // Record a conversation with multiple messages
      tracker.recordConversation({
        userId: 'user123',
        channelId: 'channel456',
        messageIds: ['msg1', 'msg2', 'msg3'],
        personalityName: 'TestPersonality',
        isDM: false,
        isMentionOnly: false,
      });

      // Verify it exists
      expect(tracker.activeConversations.size).toBe(1);
      expect(tracker.messageIdMap.size).toBe(3);

      // Clear it
      const result = tracker.clearConversation('user123', 'channel456');
      expect(result).toBe(true);

      // Verify it's gone
      expect(tracker.activeConversations.size).toBe(0);
      expect(tracker.messageIdMap.size).toBe(0);
    });

    it('should handle legacy conversations with lastMessageId', () => {
      // Manually add a legacy conversation
      const key = 'user123-channel456';
      tracker.activeConversations.set(key, {
        personalityName: 'LegacyPersonality',
        lastMessageId: 'legacy123',
        timestamp: Date.now(),
      });
      tracker.messageIdMap.set('legacy123', {
        personalityName: 'LegacyPersonality',
      });

      const result = tracker.clearConversation('user123', 'channel456');
      expect(result).toBe(true);
      expect(tracker.messageIdMap.has('legacy123')).toBe(false);
    });

    it('should return false for non-existent conversation', () => {
      const result = tracker.clearConversation('unknown-user', 'unknown-channel');
      expect(result).toBe(false);
    });
  });

  describe('getAllConversations and getAllMessageMappings', () => {
    it('should return all conversations as plain object', () => {
      tracker.recordConversation({
        userId: 'user1',
        channelId: 'channel1',
        messageIds: 'msg1',
        personalityName: 'Personality1',
      });

      tracker.recordConversation({
        userId: 'user2',
        channelId: 'channel2',
        messageIds: 'msg2',
        personalityName: 'Personality2',
      });

      const conversations = tracker.getAllConversations();
      expect(Object.keys(conversations)).toHaveLength(2);
      expect(conversations['user1-channel1']).toBeDefined();
      expect(conversations['user2-channel2']).toBeDefined();
    });

    it('should return all message mappings as plain object', () => {
      tracker.recordConversation({
        userId: 'user1',
        channelId: 'channel1',
        messageIds: ['msg1', 'msg2', 'msg3'],
        personalityName: 'Personality1',
      });

      const mappings = tracker.getAllMessageMappings();
      expect(Object.keys(mappings)).toHaveLength(3);
      expect(mappings['msg1']).toBeDefined();
      expect(mappings['msg2']).toBeDefined();
      expect(mappings['msg3']).toBeDefined();
    });
  });

  describe('loadFromData', () => {
    it('should load conversations and message mappings from data', () => {
      const conversationData = {
        'user1-channel1': {
          personalityName: 'Personality1',
          messageIds: ['msg1'],
          timestamp: Date.now(),
        },
      };

      const mappingData = {
        msg1: {
          userId: 'user1',
          channelId: 'channel1',
          personalityName: 'Personality1',
          timestamp: Date.now(),
        },
      };

      tracker.loadFromData(conversationData, mappingData);

      expect(tracker.activeConversations.size).toBe(1);
      expect(tracker.messageIdMap.size).toBe(1);
      expect(tracker.activeConversations.get('user1-channel1').personalityName).toBe(
        'Personality1'
      );
    });

    it('should handle null data gracefully', () => {
      tracker.loadFromData(null, null);
      expect(tracker.activeConversations.size).toBe(0);
      expect(tracker.messageIdMap.size).toBe(0);
    });
  });

  describe('cleanup interval', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should clean up stale conversations periodically', () => {
      const now = Date.now();
      Date.now = jest.fn().mockReturnValue(now);

      // Record some conversations
      tracker.recordConversation({
        userId: 'user1',
        channelId: 'channel1',
        messageIds: 'msg1',
        personalityName: 'Personality1',
      });

      // Make time pass beyond timeout
      Date.now = jest.fn().mockReturnValue(now + 35 * 60 * 1000); // 35 minutes

      // Manually trigger cleanup
      tracker._cleanupStaleConversations();

      // Verify conversation was cleaned up
      expect(tracker.activeConversations.size).toBe(0);
      expect(tracker.messageIdMap.size).toBe(0);
    });

    it('should clean up orphaned message mappings', () => {
      const now = Date.now();
      Date.now = jest.fn().mockReturnValue(now);

      // Manually add an orphaned message mapping
      tracker.messageIdMap.set('orphan-msg', {
        userId: 'user1',
        channelId: 'channel1',
        personalityName: 'Personality1',
        timestamp: now - 40 * 60 * 1000, // 40 minutes ago
      });

      // Make current time beyond timeout
      Date.now = jest.fn().mockReturnValue(now);

      // Manually trigger cleanup
      tracker._cleanupStaleConversations();

      // Verify orphaned mapping was cleaned up
      expect(tracker.messageIdMap.size).toBe(0);
    });

    it('should use DM timeout for DM conversations', () => {
      const now = Date.now();
      Date.now = jest.fn().mockReturnValue(now);

      // Record a DM conversation
      tracker.recordConversation({
        userId: 'dmuser',
        channelId: 'dmchannel',
        messageIds: 'dmmsg',
        personalityName: 'DMPersonality',
        isDM: true,
      });

      // Make time pass 90 minutes (within DM timeout)
      Date.now = jest.fn().mockReturnValue(now + 90 * 60 * 1000);

      // Manually trigger cleanup
      tracker._cleanupStaleConversations();

      // Verify DM conversation is still there
      expect(tracker.activeConversations.size).toBe(1);

      // Make time pass 130 minutes (beyond DM timeout)
      Date.now = jest.fn().mockReturnValue(now + 130 * 60 * 1000);

      // Manually trigger cleanup
      tracker._cleanupStaleConversations();

      // Verify DM conversation was cleaned up
      expect(tracker.activeConversations.size).toBe(0);
    });
  });

  describe('stopCleanup', () => {
    it('should stop the cleanup interval', () => {
      // Create a new tracker with cleanup enabled
      const trackerWithCleanup = new ConversationTracker({ enableCleanup: true });

      // Spy on clearInterval
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      // Verify interval was created
      expect(trackerWithCleanup.cleanupInterval).toBeDefined();

      // Stop cleanup
      trackerWithCleanup.stopCleanup();

      // Verify interval was cleared
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(trackerWithCleanup.cleanupInterval).toBeNull();

      // Cleanup
      clearIntervalSpy.mockRestore();
    });
  });
});
