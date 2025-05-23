const { MessageTracker, createMessageTracker } = require('../../src/messageTracker');
const logger = require('../../src/logger');

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('MessageTracker', () => {
  let messageTracker;
  let mockScheduler;
  let mockIntervalScheduler;
  let scheduledCallbacks;
  let intervalCallbacks;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    
    // Setup mock schedulers
    scheduledCallbacks = [];
    intervalCallbacks = [];
    
    mockScheduler = jest.fn((callback, delay) => {
      const id = scheduledCallbacks.length;
      scheduledCallbacks.push({ callback, delay, id });
      return id;
    });
    
    mockIntervalScheduler = jest.fn((callback, interval) => {
      const id = intervalCallbacks.length;
      intervalCallbacks.push({ callback, interval, id });
      return { 
        id, 
        unref: jest.fn() 
      };
    });
  });

  describe('constructor and initialization', () => {
    it('should initialize with default options', () => {
      messageTracker = new MessageTracker();
      
      expect(messageTracker.processedMessages).toEqual(new Map());
      expect(messageTracker.enableCleanupTimers).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('MessageTracker initialized');
    });

    it('should initialize with custom options', () => {
      messageTracker = createMessageTracker({
        enableCleanupTimers: false,
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
      
      expect(messageTracker.enableCleanupTimers).toBe(false);
      expect(messageTracker.scheduler).toBe(mockScheduler);
      expect(messageTracker.intervalScheduler).toBe(mockIntervalScheduler);
    });

    it('should set up periodic cleanup when timers are enabled', () => {
      messageTracker = new MessageTracker({
        intervalScheduler: mockIntervalScheduler
      });
      
      expect(mockIntervalScheduler).toHaveBeenCalledWith(
        expect.any(Function),
        10 * 60 * 1000 // 10 minutes
      );
      expect(intervalCallbacks[0].callback).toBeDefined();
    });

    it('should not set up periodic cleanup when timers are disabled', () => {
      messageTracker = new MessageTracker({
        enableCleanupTimers: false,
        intervalScheduler: mockIntervalScheduler
      });
      
      expect(mockIntervalScheduler).not.toHaveBeenCalled();
    });

    it('should handle interval.unref when available', () => {
      const mockUnref = jest.fn();
      const mockIntervalWithUnref = jest.fn(() => ({ unref: mockUnref }));
      
      messageTracker = new MessageTracker({
        intervalScheduler: mockIntervalWithUnref
      });
      
      expect(mockUnref).toHaveBeenCalled();
    });

    it('should handle missing unref gracefully', () => {
      const mockIntervalNoUnref = jest.fn(() => ({ id: 1 }));
      
      expect(() => {
        messageTracker = new MessageTracker({
          intervalScheduler: mockIntervalNoUnref
        });
      }).not.toThrow();
    });
  });

  describe('track method', () => {
    beforeEach(() => {
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
    });

    it('should track new messages successfully', () => {
      const result = messageTracker.track('12345');
      
      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('message-12345')).toBe(true);
    });

    it('should detect duplicate messages', () => {
      messageTracker.track('12345');
      const result = messageTracker.track('12345');
      
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('DUPLICATE DETECTION: message-12345')
      );
    });

    it('should track messages with custom types', () => {
      const result1 = messageTracker.track('12345', 'command');
      const result2 = messageTracker.track('12345', 'bot-message');
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(messageTracker.processedMessages.has('command-12345')).toBe(true);
      expect(messageTracker.processedMessages.has('bot-message-12345')).toBe(true);
    });

    it('should track the same ID with different types separately', () => {
      const result1 = messageTracker.track('12345', 'command');
      const result2 = messageTracker.track('12345', 'reply');
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(messageTracker.size).toBe(2);
    });
  });

  describe('trackOperation method', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.restoreAllMocks();
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
    });

    it('should track new operations successfully', () => {
      const result = messageTracker.trackOperation('channel123', 'reply', 'sig123');
      
      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('reply-channel123-sig123')).toBe(true);
    });

    it('should detect duplicate operations within 5 seconds', () => {
      jest.spyOn(Date, 'now')
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(3000); // 2 seconds later
      
      messageTracker.trackOperation('channel123', 'reply', 'sig123');
      const result = messageTracker.trackOperation('channel123', 'reply', 'sig123');
      
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('DUPLICATE OPERATION: reply-channel123-sig123')
      );
    });

    it('should allow duplicate operations after 5 seconds', () => {
      // First operation at time 1000
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      messageTracker.trackOperation('channel123', 'reply', 'sig123');
      
      // Second operation at time 7000 (6 seconds later)
      Date.now.mockReturnValue(7000);
      const result = messageTracker.trackOperation('channel123', 'reply', 'sig123');
      
      expect(result).toBe(true);
      
      Date.now.mockRestore();
    });

    it('should schedule cleanup for operations', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      
      messageTracker.trackOperation('channel123', 'send', 'sig456');
      
      expect(mockScheduler).toHaveBeenCalledWith(expect.any(Function), 10000);
      
      // Execute the scheduled callback
      scheduledCallbacks[0].callback();
      
      expect(messageTracker.processedMessages.has('send-channel123-sig456')).toBe(false);
    });

    it('should not schedule cleanup when timers are disabled', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      
      messageTracker = new MessageTracker({
        enableCleanupTimers: false,
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
      
      messageTracker.trackOperation('channel123', 'send', 'sig456');
      
      expect(mockScheduler).not.toHaveBeenCalled();
    });
  });

  describe('periodic cleanup', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now');
    });

    afterEach(() => {
      Date.now.mockRestore();
    });

    it('should clean up old entries during periodic cleanup', () => {
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
      
      // Add some entries with different timestamps
      Date.now.mockReturnValue(1000);
      messageTracker.track('old1');
      messageTracker.track('old2');
      
      Date.now.mockReturnValue(5 * 60 * 1000); // 5 minutes later
      messageTracker.track('recent1');
      
      Date.now.mockReturnValue(12 * 60 * 1000); // 12 minutes from start
      
      // Execute the periodic cleanup
      intervalCallbacks[0].callback();
      
      expect(messageTracker.processedMessages.has('message-old1')).toBe(false);
      expect(messageTracker.processedMessages.has('message-old2')).toBe(false);
      expect(messageTracker.processedMessages.has('message-recent1')).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('MessageTracker cleanup removed 2 entries');
    });

    it('should not log when no entries are removed', () => {
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
      
      Date.now.mockReturnValue(1000);
      messageTracker.track('recent');
      
      Date.now.mockReturnValue(2000); // Only 1 second later
      
      // Execute the periodic cleanup
      intervalCallbacks[0].callback();
      
      expect(messageTracker.processedMessages.has('message-recent')).toBe(true);
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('MessageTracker cleanup removed')
      );
    });
  });

  describe('utility methods', () => {
    beforeEach(() => {
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
    });

    it('should return correct size', () => {
      expect(messageTracker.size).toBe(0);
      
      messageTracker.track('msg1');
      messageTracker.track('msg2');
      messageTracker.trackOperation('ch1', 'reply', 'sig1');
      
      expect(messageTracker.size).toBe(3);
    });

    it('should clear all tracked messages', () => {
      messageTracker.track('msg1');
      messageTracker.track('msg2');
      messageTracker.trackOperation('ch1', 'reply', 'sig1');
      
      expect(messageTracker.size).toBe(3);
      
      messageTracker.clear();
      
      expect(messageTracker.size).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith('MessageTracker cleared');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler
      });
    });

    it('should handle null or undefined messageId', () => {
      const result1 = messageTracker.track(null);
      const result2 = messageTracker.track(undefined);
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(messageTracker.processedMessages.has('message-null')).toBe(true);
      expect(messageTracker.processedMessages.has('message-undefined')).toBe(true);
    });

    it('should handle empty string IDs', () => {
      const result = messageTracker.track('');
      
      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('message-')).toBe(true);
    });

    it('should handle very long signatures', () => {
      const longSig = 'a'.repeat(1000);
      const result = messageTracker.trackOperation('ch1', 'send', longSig);
      
      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has(`send-ch1-${longSig}`)).toBe(true);
    });
  });
});