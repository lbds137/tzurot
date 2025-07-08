const { MessageTracker, createMessageTracker } = require('../../src/messageTracker');
const logger = require('../../src/logger');

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
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
        unref: jest.fn(),
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
        intervalScheduler: mockIntervalScheduler,
      });

      expect(messageTracker.enableCleanupTimers).toBe(false);
      expect(messageTracker.scheduler).toBe(mockScheduler);
      expect(messageTracker.intervalScheduler).toBe(mockIntervalScheduler);
    });

    it('should set up periodic cleanup when timers are enabled', () => {
      messageTracker = new MessageTracker({
        intervalScheduler: mockIntervalScheduler,
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
        intervalScheduler: mockIntervalScheduler,
      });

      expect(mockIntervalScheduler).not.toHaveBeenCalled();
    });

    it('should handle interval.unref when available', () => {
      const mockUnref = jest.fn();
      const mockIntervalWithUnref = jest.fn(() => ({ unref: mockUnref }));

      messageTracker = new MessageTracker({
        intervalScheduler: mockIntervalWithUnref,
      });

      expect(mockUnref).toHaveBeenCalled();
    });

    it('should handle missing unref gracefully', () => {
      const mockIntervalNoUnref = jest.fn(() => ({ id: 1 }));

      expect(() => {
        messageTracker = new MessageTracker({
          intervalScheduler: mockIntervalNoUnref,
        });
      }).not.toThrow();
    });
  });

  describe('track method', () => {
    beforeEach(() => {
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler,
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
        intervalScheduler: mockIntervalScheduler,
      });
    });

    it('should track new operations successfully', () => {
      const result = messageTracker.trackOperation('channel123', 'reply', 'sig123');

      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('reply-channel123-sig123')).toBe(true);
    });

    it('should detect duplicate operations within 5 seconds', () => {
      jest
        .spyOn(Date, 'now')
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
        intervalScheduler: mockIntervalScheduler,
      });

      messageTracker.trackOperation('channel123', 'send', 'sig456');

      expect(mockScheduler).not.toHaveBeenCalled();
    });

    it('should handle exactly 5 second difference as duplicate', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      messageTracker.trackOperation('channel123', 'reply', 'sig123');

      // Exactly 5 seconds later
      Date.now.mockReturnValue(6000);
      const result = messageTracker.trackOperation('channel123', 'reply', 'sig123');

      expect(result).toBe(true); // Should allow after exactly 5 seconds

      Date.now.mockRestore();
    });

    it('should handle operations with empty channel ID', () => {
      const result = messageTracker.trackOperation('', 'send', 'sig');

      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('send--sig')).toBe(true);
    });

    it('should handle operations with null values', () => {
      const result = messageTracker.trackOperation(null, null, null);

      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('null-null-null')).toBe(true);
    });

    it('should handle operations with undefined values', () => {
      const result = messageTracker.trackOperation(undefined, undefined, undefined);

      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('undefined-undefined-undefined')).toBe(true);
    });

    it('should warn with correct time difference in duplicate detection', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      messageTracker.trackOperation('ch1', 'reply', 'sig1');

      // 3.5 seconds later
      Date.now.mockReturnValue(4500);
      messageTracker.trackOperation('ch1', 'reply', 'sig1');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('(3500ms ago)')
      );

      Date.now.mockRestore();
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
        intervalScheduler: mockIntervalScheduler,
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
        intervalScheduler: mockIntervalScheduler,
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
        intervalScheduler: mockIntervalScheduler,
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
        intervalScheduler: mockIntervalScheduler,
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

    it('should handle special characters in IDs', () => {
      const specialId = 'test@#$%^&*()_+{}[]|\\:\";<>?,./~`';
      const result = messageTracker.track(specialId);

      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has(`message-${specialId}`)).toBe(true);
    });

    it('should handle numeric IDs', () => {
      const result1 = messageTracker.track(12345);
      const result2 = messageTracker.track(0);
      const result3 = messageTracker.track(-1);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
      expect(messageTracker.processedMessages.has('message-12345')).toBe(true);
      expect(messageTracker.processedMessages.has('message-0')).toBe(true);
      expect(messageTracker.processedMessages.has('message--1')).toBe(true);
    });

    it('should handle object IDs by converting to string', () => {
      const objId = { id: 'test' };
      const result = messageTracker.track(objId);

      expect(result).toBe(true);
      expect(messageTracker.processedMessages.has('message-[object Object]')).toBe(true);
    });
  });

  describe('singleton behavior', () => {
    it('should export a singleton instance', () => {
      const { messageTracker: instance1 } = require('../../src/messageTracker');
      const { messageTracker: instance2 } = require('../../src/messageTracker');

      expect(instance1).toBe(instance2);
    });

    it('should maintain state across imports', () => {
      const { messageTracker: tracker1 } = require('../../src/messageTracker');
      tracker1.track('singleton-test');

      const { messageTracker: tracker2 } = require('../../src/messageTracker');
      const result = tracker2.track('singleton-test');

      expect(result).toBe(false); // Should detect as duplicate
    });
  });

  describe('factory function', () => {
    it('should create new instances with createMessageTracker', () => {
      const tracker1 = createMessageTracker();
      const tracker2 = createMessageTracker();

      expect(tracker1).not.toBe(tracker2);

      // Verify they have independent state
      tracker1.track('factory-test');
      const result = tracker2.track('factory-test');

      expect(result).toBe(true); // Should not be duplicate
    });

    it('should pass options to new instances', () => {
      const customScheduler = jest.fn();
      const tracker = createMessageTracker({
        enableCleanupTimers: false,
        scheduler: customScheduler,
      });

      expect(tracker.enableCleanupTimers).toBe(false);
      expect(tracker.scheduler).toBe(customScheduler);
    });
  });

  describe('timestamp tracking', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now');
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler,
      });
    });

    afterEach(() => {
      Date.now.mockRestore();
    });

    it('should store current timestamp when tracking messages', () => {
      Date.now.mockReturnValue(1234567890);
      messageTracker.track('timestamp-test');

      const timestamp = messageTracker.processedMessages.get('message-timestamp-test');
      expect(timestamp).toBe(1234567890);
    });

    it('should update timestamp on re-track after expiry', () => {
      Date.now.mockReturnValue(1000);
      messageTracker.trackOperation('ch1', 'send', 'sig1');

      Date.now.mockReturnValue(7000); // 6 seconds later
      messageTracker.trackOperation('ch1', 'send', 'sig1');

      const timestamp = messageTracker.processedMessages.get('send-ch1-sig1');
      expect(timestamp).toBe(7000);
    });
  });

  describe('concurrent operations', () => {
    beforeEach(() => {
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler,
      });
    });

    it('should handle rapid concurrent tracks correctly', () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(messageTracker.track('concurrent-test'));
      }

      expect(results[0]).toBe(true);
      expect(results.slice(1).every(r => r === false)).toBe(true);
      expect(logger.warn).toHaveBeenCalledTimes(4);
    });

    it('should track different IDs concurrently without interference', () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(messageTracker.track(`concurrent-${i}`));
      }

      expect(results.every(r => r === true)).toBe(true);
      expect(messageTracker.size).toBe(5);
    });
  });

  describe('memory management', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now');
      messageTracker = new MessageTracker({
        scheduler: mockScheduler,
        intervalScheduler: mockIntervalScheduler,
      });
    });

    afterEach(() => {
      Date.now.mockRestore();
    });

    it('should handle cleanup with no entries gracefully', () => {
      Date.now.mockReturnValue(1000);

      // Run cleanup with empty tracker
      expect(() => {
        intervalCallbacks[0].callback();
      }).not.toThrow();

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('MessageTracker cleanup removed')
      );
    });

    it('should handle cleanup with mix of old and new entries', () => {
      // Add entries at different times
      Date.now.mockReturnValue(1000);
      messageTracker.track('old1');
      
      Date.now.mockReturnValue(5 * 60 * 1000); // 5 min
      messageTracker.track('mid1');
      messageTracker.track('mid2');
      
      Date.now.mockReturnValue(9 * 60 * 1000); // 9 min
      messageTracker.track('recent1');
      
      Date.now.mockReturnValue(11 * 60 * 1000); // 11 min
      
      // Run cleanup
      intervalCallbacks[0].callback();
      
      expect(messageTracker.processedMessages.has('message-old1')).toBe(false);
      expect(messageTracker.processedMessages.has('message-mid1')).toBe(true);
      expect(messageTracker.processedMessages.has('message-mid2')).toBe(true);
      expect(messageTracker.processedMessages.has('message-recent1')).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('MessageTracker cleanup removed 1 entries');
    });

    it('should handle cleanup removing all entries', () => {
      Date.now.mockReturnValue(1000);
      messageTracker.track('old1');
      messageTracker.track('old2');
      messageTracker.track('old3');

      Date.now.mockReturnValue(12 * 60 * 1000); // 12 minutes later

      intervalCallbacks[0].callback();

      expect(messageTracker.size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('MessageTracker cleanup removed 3 entries');
    });
  });
});
