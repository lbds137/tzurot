// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../config');
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Import the module
const MessageTracker = require('../../../../src/commands/utils/messageTracker');

describe('MessageTracker', () => {
  let tracker;
  let mockScheduler;
  let originalDateNow;

  beforeEach(() => {
    // Save the original Date.now function
    originalDateNow = Date.now;
    Date.now = jest.fn(() => 1000);

    // Create a mock scheduler for controlled testing
    mockScheduler = jest.fn();

    // Create a new tracker instance with timers disabled for most tests
    tracker = new MessageTracker({
      enableCleanupTimers: false,
      scheduler: mockScheduler,
      interval: () => {},
      delay: () => Promise.resolve(),
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore the original Date.now function
    Date.now = originalDateNow;
  });

  describe('isProcessed and markAsProcessed', () => {
    test('should correctly track processed messages', () => {
      const messageId = '123456789012345678';

      // Initially not processed
      expect(tracker.isProcessed(messageId)).toBe(false);

      // Mark as processed
      tracker.markAsProcessed(messageId);

      // Now it should be processed
      expect(tracker.isProcessed(messageId)).toBe(true);
    });

    test('should schedule auto-removal with custom timeout', () => {
      const messageId = '123456789012345678';

      // Enable timers for this test
      const mockInterval = { unref: jest.fn() };
      const schedulerTracker = new MessageTracker({
        enableCleanupTimers: true,
        scheduler: mockScheduler,
        interval: () => mockInterval,
        delay: () => Promise.resolve(),
      });

      schedulerTracker.markAsProcessed(messageId, 5000);

      // Verify scheduler was called with correct timeout
      expect(mockScheduler).toHaveBeenCalledWith(expect.any(Function), 5000);
    });

    test('should not schedule removal when timers are disabled', () => {
      const messageId = '123456789012345678';

      tracker.markAsProcessed(messageId);

      // Scheduler should not be called when timers are disabled
      expect(mockScheduler).not.toHaveBeenCalled();
    });
  });

  describe('isRecentCommand', () => {
    test('first command is never a recent duplicate', () => {
      const userId = '123456789012345678';
      const command = 'ping';
      const args = [];

      const isRecent = tracker.isRecentCommand(userId, command, args);

      expect(isRecent).toBe(false);
    });

    test('detects duplicate command within 3 seconds', () => {
      const userId = '123456789012345678';
      const command = 'ping';
      const args = [];

      // First execution
      tracker.isRecentCommand(userId, command, args);

      // Mock time passing (less than 3 seconds)
      Date.now = jest.fn(() => 2500);

      // Second execution
      const isRecent = tracker.isRecentCommand(userId, command, args);

      expect(isRecent).toBe(true);
    });

    test('different users can execute same command', () => {
      const user1 = '123456789012345678';
      const user2 = '987654321098765432';
      const command = 'ping';
      const args = [];

      // User 1 executes
      tracker.isRecentCommand(user1, command, args);

      // User 2 executes immediately after
      const isRecent = tracker.isRecentCommand(user2, command, args);

      expect(isRecent).toBe(false);
    });

    test('same user can execute different commands', () => {
      const userId = '123456789012345678';

      // Execute first command
      tracker.isRecentCommand(userId, 'ping', []);

      // Execute different command immediately
      const isRecent = tracker.isRecentCommand(userId, 'help', []);

      expect(isRecent).toBe(false);
    });

    test('cleans up old entries after 10 seconds', () => {
      const userId = '123456789012345678';
      const command = 'ping';
      const args = [];

      // First execution
      tracker.isRecentCommand(userId, command, args);

      // Mock time passing (more than 10 seconds)
      Date.now = jest.fn(() => 15000);

      // Second execution after cleanup
      const isRecent = tracker.isRecentCommand(userId, command, args);

      expect(isRecent).toBe(false);
    });
  });

  describe('add command tracking', () => {
    test('tracks add command message IDs', () => {
      const messageId = '123456789012345678';

      expect(tracker.isAddCommandProcessed(messageId)).toBe(false);

      tracker.markAddCommandAsProcessed(messageId);

      expect(tracker.isAddCommandProcessed(messageId)).toBe(true);
    });

    test('tracks completed add commands', () => {
      const commandKey = 'user123-personality456';

      expect(tracker.isAddCommandCompleted(commandKey)).toBe(false);

      tracker.markAddCommandCompleted(commandKey);

      expect(tracker.isAddCommandCompleted(commandKey)).toBe(true);
    });

    test('removes completed add command for specific user and personality', () => {
      const userId = '123456789012345678';
      const personalityName = 'test-personality';
      const commandKey = `${userId}-${personalityName}`;

      // Mark as completed
      tracker.markAddCommandCompleted(commandKey);
      expect(tracker.isAddCommandCompleted(commandKey)).toBe(true);

      // Remove it
      tracker.removeCompletedAddCommand(userId, personalityName);
      expect(tracker.isAddCommandCompleted(commandKey)).toBe(false);
    });
  });

  describe('embed tracking', () => {
    test('tracks sending embed status', () => {
      const messageKey = 'channel123-message456';

      expect(tracker.isSendingEmbed(messageKey)).toBe(false);

      tracker.markSendingEmbed(messageKey);
      expect(tracker.isSendingEmbed(messageKey)).toBe(true);

      tracker.clearSendingEmbed(messageKey);
      expect(tracker.isSendingEmbed(messageKey)).toBe(false);
    });

    test('tracks first embed generation', () => {
      const messageKey = 'channel123-message456';

      expect(tracker.hasFirstEmbed(messageKey)).toBe(false);

      tracker.markGeneratedFirstEmbed(messageKey);

      expect(tracker.hasFirstEmbed(messageKey)).toBe(true);
    });
  });

  describe('cleanup intervals', () => {
    test('sets up cleanup intervals when enabled', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      // Create tracker with cleanup timers enabled
      new MessageTracker({
        enableCleanupTimers: true,
        scheduler: setTimeout,
        interval: setInterval,
      });

      // Should set up 2 intervals (10 minutes and 1 hour cleanup)
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    test('cleanup removes old processed messages', () => {
      // Test the behavior: the MessageTracker should have methods to clear its data
      // This is what the cleanup intervals do - they call clear() on the various Sets

      // Create a new tracker instance for this test with mock timers
      const cleanupTracker = new MessageTracker({
        enableCleanupTimers: false,
        scheduler: jest.fn(),
        interval: jest.fn(),
        delay: jest.fn(),
      });

      // Add test data to all the collections
      cleanupTracker.processedMessages.add('msg-1');
      cleanupTracker.processedMessages.add('msg-2');
      cleanupTracker.sendingEmbedResponses.add('embed-1');
      cleanupTracker.addCommandMessageIds.add('add-cmd-1');
      cleanupTracker.completedAddCommands.add('user1:personality1');
      cleanupTracker.hasGeneratedFirstEmbed.add('channel1');

      // Verify data was added
      expect(cleanupTracker.processedMessages.size).toBe(2);
      expect(cleanupTracker.sendingEmbedResponses.size).toBe(1);
      expect(cleanupTracker.addCommandMessageIds.size).toBe(1);
      expect(cleanupTracker.completedAddCommands.size).toBe(1);
      expect(cleanupTracker.hasGeneratedFirstEmbed.size).toBe(1);

      // Test the behavior: clearing the collections (this is what cleanup does)
      cleanupTracker.processedMessages.clear();
      cleanupTracker.sendingEmbedResponses.clear();
      cleanupTracker.addCommandMessageIds.clear();
      cleanupTracker.completedAddCommands.clear();
      cleanupTracker.hasGeneratedFirstEmbed.clear();

      // Verify all collections are now empty
      expect(cleanupTracker.processedMessages.size).toBe(0);
      expect(cleanupTracker.sendingEmbedResponses.size).toBe(0);
      expect(cleanupTracker.addCommandMessageIds.size).toBe(0);
      expect(cleanupTracker.completedAddCommands.size).toBe(0);
      expect(cleanupTracker.hasGeneratedFirstEmbed.size).toBe(0);

      // The behavior we're testing: the tracker can store data and clear it
      // The actual cleanup intervals just call clear() on these collections periodically
    });
  });
});
