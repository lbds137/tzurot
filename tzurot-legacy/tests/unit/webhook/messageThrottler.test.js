// Mock dependencies
jest.mock('../../../src/logger');

const logger = require('../../../src/logger');
const {
  createPersonalityChannelKey,
  hasPersonalityPendingMessage,
  registerPendingMessage,
  clearPendingMessage,
  calculateMessageDelay,
  updateChannelLastMessageTime,
  clearAllPendingMessages,
  configureTimers,
} = require('../../../src/webhook/messageThrottler');

describe('messageThrottler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Configure messageThrottler to use fake timers
    configureTimers({
      setTimeout: jest.fn((callback, delay) => global.setTimeout(callback, delay)),
      clearTimeout: jest.fn(id => global.clearTimeout(id)),
    });

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Clear any existing state by advancing time beyond all timeouts
    jest.advanceTimersByTime(60000);
    jest.clearAllTimers();
  });

  afterEach(() => {
    // Clear all pending messages and timers
    clearAllPendingMessages();
    jest.useRealTimers();
  });

  describe('createPersonalityChannelKey', () => {
    it('should create consistent key format', () => {
      const key = createPersonalityChannelKey('test-personality', 'channel-123');
      expect(key).toBe('test-personality_channel-123');
    });

    it('should handle special characters in names', () => {
      const key = createPersonalityChannelKey('personality-with-hyphens', 'channel_456');
      expect(key).toBe('personality-with-hyphens_channel_456');
    });
  });

  describe('pending message management', () => {
    it('should register pending messages', () => {
      registerPendingMessage('personality1', 'channel1', 'message-id-1');

      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Registered pending message')
      );
    });

    it('should track multiple personality-channel combinations', () => {
      registerPendingMessage('personality1', 'channel1', 'msg1');
      registerPendingMessage('personality1', 'channel2', 'msg2');
      registerPendingMessage('personality2', 'channel1', 'msg3');

      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(true);
      expect(hasPersonalityPendingMessage('personality1', 'channel2')).toBe(true);
      expect(hasPersonalityPendingMessage('personality2', 'channel1')).toBe(true);
      expect(hasPersonalityPendingMessage('personality2', 'channel2')).toBe(false);
    });

    it('should clear pending messages', () => {
      registerPendingMessage('personality1', 'channel1', 'msg1');
      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(true);

      clearPendingMessage('personality1', 'channel1');
      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(false);
    });

    it('should not error when clearing non-existent pending message', () => {
      expect(() => {
        clearPendingMessage('non-existent', 'channel1');
      }).not.toThrow();
    });

    it('should schedule timeout for pending messages', () => {
      registerPendingMessage('personality1', 'channel1', 'msg1');

      // Message should exist initially
      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(true);

      // Advance time to just before timeout (15 seconds)
      jest.advanceTimersByTime(14999);
      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(true);

      // Advance past timeout
      jest.advanceTimersByTime(2);
      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(false);
    });

    it('should cancel timeout when message is cleared', () => {
      registerPendingMessage('personality1', 'channel1', 'msg1');
      clearPendingMessage('personality1', 'channel1');

      // Advance past timeout period
      jest.advanceTimersByTime(20000);

      // Logger should show it was cleared, not timed out
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Cleared pending message'));
      expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('timed out'));
    });

    it('should handle registering same personality-channel again', () => {
      registerPendingMessage('personality1', 'channel1', 'msg1');

      // Register again with different message ID
      registerPendingMessage('personality1', 'channel1', 'msg2');

      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(true);
    });
  });

  describe('message delay calculation', () => {
    it('should return 0 delay for first message in channel', () => {
      const delay = calculateMessageDelay('channel1');
      expect(delay).toBe(0);
    });

    it('should calculate delay based on last message time', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      updateChannelLastMessageTime('channel1');

      // Advance time by 1 second
      jest.spyOn(Date, 'now').mockReturnValue(now + 1000);

      const delay = calculateMessageDelay('channel1');
      expect(delay).toBe(2000); // MIN_MESSAGE_DELAY (3000) - 1000
    });

    it('should return 0 if enough time has passed', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      updateChannelLastMessageTime('channel1');

      // Advance time by 4 seconds (more than MIN_MESSAGE_DELAY)
      jest.spyOn(Date, 'now').mockReturnValue(now + 4000);

      const delay = calculateMessageDelay('channel1');
      expect(delay).toBe(0);
    });

    it('should track multiple channels independently', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      updateChannelLastMessageTime('channel1');

      // Advance time by 1 second
      jest.spyOn(Date, 'now').mockReturnValue(now + 1000);
      updateChannelLastMessageTime('channel2');

      // Advance time by another second
      jest.spyOn(Date, 'now').mockReturnValue(now + 2000);

      const delay1 = calculateMessageDelay('channel1');
      const delay2 = calculateMessageDelay('channel2');

      expect(delay1).toBe(1000); // 3000 - 2000
      expect(delay2).toBe(2000); // 3000 - 1000
    });

    it('should update channel last message time', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      updateChannelLastMessageTime('channel1');

      // Should log the delay needed
      jest.spyOn(Date, 'now').mockReturnValue(now + 500);
      const delay = calculateMessageDelay('channel1');

      expect(delay).toBe(2500);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Channel channel1 needs 2500ms delay before next message')
      );
    });
  });

  describe('edge cases', () => {
    it('should handle rapid pending message operations', () => {
      // Register and immediately clear
      registerPendingMessage('personality1', 'channel1', 'msg1');
      clearPendingMessage('personality1', 'channel1');

      expect(hasPersonalityPendingMessage('personality1', 'channel1')).toBe(false);
    });

    it('should handle concurrent registrations', () => {
      // Register multiple messages rapidly
      for (let i = 0; i < 10; i++) {
        registerPendingMessage(`personality${i}`, 'channel1', `msg${i}`);
      }

      // All should be registered
      for (let i = 0; i < 10; i++) {
        expect(hasPersonalityPendingMessage(`personality${i}`, 'channel1')).toBe(true);
      }
    });

    it('should log timeout for uncleared messages', () => {
      registerPendingMessage('personality1', 'channel1', 'msg1');

      // Advance past timeout
      jest.advanceTimersByTime(15001);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Pending message for personality1_channel1 timed out')
      );
    });
  });
});
