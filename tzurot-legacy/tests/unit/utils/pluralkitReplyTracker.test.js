describe('PluralKitReplyTracker', () => {
  let tracker;
  let mockLogger;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    jest.doMock('../../../src/logger', () => mockLogger);
    
    // Load the tracker after mocking
    tracker = require('../../../src/utils/pluralkitReplyTracker');
    
    // Stop auto-cleanup for tests
    tracker.stopCleanup();
    
    // Clear any existing data
    tracker.clear();
  });
  
  afterEach(() => {
    tracker.stopCleanup();
  });
  
  describe('trackPendingReply', () => {
    it('should track a pending reply', () => {
      const context = {
        channelId: 'channel-123',
        userId: 'user-456',
        content: 'Lila: Hello personality!',
        personality: { fullName: 'test-personality' },
        referencedMessageId: 'msg-789',
        originalMessageId: 'original-msg-123'
      };
      
      tracker.trackPendingReply(context);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Tracked pending reply in channel channel-123')
      );
    });
  });
  
  describe('findPendingReply', () => {
    it('should find a matching pending reply', () => {
      const context = {
        channelId: 'channel-123',
        userId: 'user-456',
        content: 'Lila: Hello personality!',
        personality: { fullName: 'test-personality' },
        referencedMessageId: 'msg-789',
        originalMessageId: 'original-msg-123'
      };
      
      tracker.trackPendingReply(context);
      
      // Pluralkit strips the proxy tag
      const result = tracker.findPendingReply('channel-123', 'Hello personality!');
      
      expect(result).toBeTruthy();
      expect(result.userId).toBe('user-456');
      expect(result.personality.fullName).toBe('test-personality');
      expect(result.originalMessageId).toBe('original-msg-123');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found matching pending reply')
      );
    });
    
    it('should not find reply from different channel', () => {
      const context = {
        channelId: 'channel-123',
        userId: 'user-456',
        content: 'Lila: Hello personality!',
        personality: { fullName: 'test-personality' },
        referencedMessageId: 'msg-789'
      };
      
      tracker.trackPendingReply(context);
      
      const result = tracker.findPendingReply('channel-999', 'Hello personality!');
      
      expect(result).toBeNull();
    });
    
    it('should not find reply with different content', () => {
      const context = {
        channelId: 'channel-123',
        userId: 'user-456',
        content: 'Lila: Hello personality!',
        personality: { fullName: 'test-personality' },
        referencedMessageId: 'msg-789'
      };
      
      tracker.trackPendingReply(context);
      
      const result = tracker.findPendingReply('channel-123', 'Different message');
      
      expect(result).toBeNull();
    });
    
    it('should remove found reply from pending list', () => {
      const context = {
        channelId: 'channel-123',
        userId: 'user-456',
        content: 'Lila: Hello personality!',
        personality: { fullName: 'test-personality' },
        referencedMessageId: 'msg-789'
      };
      
      tracker.trackPendingReply(context);
      
      // First find should succeed
      const result1 = tracker.findPendingReply('channel-123', 'Hello personality!');
      expect(result1).toBeTruthy();
      
      // Second find should fail (already removed)
      const result2 = tracker.findPendingReply('channel-123', 'Hello personality!');
      expect(result2).toBeNull();
    });
  });
  
  describe('cleanup', () => {
    it('should remove expired replies', () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);
      
      const context = {
        channelId: 'channel-123',
        userId: 'user-456',
        content: 'Lila: Hello personality!',
        personality: { fullName: 'test-personality' },
        referencedMessageId: 'msg-789'
      };
      
      tracker.trackPendingReply(context);
      
      // Advance time past expiration
      jest.setSystemTime(now + 6000); // 6 seconds later
      
      tracker.cleanup();
      
      // Should not find expired reply
      const result = tracker.findPendingReply('channel-123', 'Hello personality!');
      expect(result).toBeNull();
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 1 expired pending replies')
      );
      
      jest.useRealTimers();
    });
  });
});