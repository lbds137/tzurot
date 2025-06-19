const messageTrackerHandler = require('../../../src/handlers/messageTrackerHandler');
const contentSimilarity = require('../../../src/utils/contentSimilarity');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/contentSimilarity', () => ({
  getProxyDelayTime: jest.fn().mockReturnValue(500),
  areContentsSimilar: jest.fn().mockReturnValue(false),
}));

describe('messageTrackerHandler', () => {
  let mockMessage;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Enable fake timers
    jest.useFakeTimers();

    // Reset the internal state and create a clean handler for tests
    messageTrackerHandler.createMessageTrackerHandler({ enableCleanup: false });

    // Mock message
    mockMessage = {
      id: 'message-123',
      content: 'Test message content',
      channel: {
        id: 'channel-456',
        messages: {
          fetch: jest.fn().mockResolvedValue({ id: 'message-123' }),
        },
      },
    };

    // Mock client
    mockClient = {
      user: {
        id: 'client-789',
      },
    };
  });

  afterEach(() => {
    // Clean up fake timers
    jest.useRealTimers();
  });

  afterAll(() => {
    // Stop interval to prevent memory leaks
    messageTrackerHandler.stopCleanupInterval();
  });

  describe('trackMessageInChannel', () => {
    it('should track a message in the channel', () => {
      messageTrackerHandler.trackMessageInChannel(mockMessage);

      // Check if message was tracked by checking for similar messages
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(mockMessage);

      expect(hasSimilar).toBe(false);
    });

    it('should not track empty messages', () => {
      const emptyMessage = { ...mockMessage, content: '' };
      messageTrackerHandler.trackMessageInChannel(emptyMessage);

      // No messages should be tracked
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(mockMessage);

      expect(hasSimilar).toBe(false);
      expect(contentSimilarity.areContentsSimilar).not.toHaveBeenCalled();
    });
  });

  describe('hasSimilarRecentMessage', () => {
    it('should return false if no similar messages exist', () => {
      messageTrackerHandler.trackMessageInChannel(mockMessage);

      // Mark the message as handled
      messageTrackerHandler.markMessageAsHandled(mockMessage);

      // Create a different message
      const differentMessage = {
        ...mockMessage,
        id: 'different-message',
        content: 'Different content',
      };

      // No similarity
      contentSimilarity.areContentsSimilar.mockReturnValue(false);

      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(differentMessage);
      expect(hasSimilar).toBe(false);
      expect(contentSimilarity.areContentsSimilar).toHaveBeenCalled();
    });

    it('should return true if a similar message exists and was handled', () => {
      // Create a test message
      const handledMessage = {
        id: 'message-handled',
        content: 'Test message content for handled case',
        channel: {
          id: 'channel-test-handled',
        },
      };

      // Need to reset the internal map first
      messageTrackerHandler.stopCleanupInterval();

      // Track and mark as handled
      messageTrackerHandler.trackMessageInChannel(handledMessage);
      messageTrackerHandler.markMessageAsHandled(handledMessage);

      // Create a similar message with different ID
      const similarMessage = {
        ...handledMessage,
        id: 'similar-to-handled',
      };

      // Setup for this test
      contentSimilarity.areContentsSimilar.mockReturnValue(true);

      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarMessage);
      expect(hasSimilar).toBe(true);
      expect(contentSimilarity.areContentsSimilar).toHaveBeenCalled();

      // Clean up
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      messageTrackerHandler.stopCleanupInterval();
    });

    it('should return false if a similar message exists but was not handled', () => {
      // Create a completely different test message for this test
      const unhandledMessage = {
        id: 'message-unhandled',
        content: 'Test message content for unhandled case',
        channel: {
          id: 'channel-test-unhandled',
        },
      };

      // Need to reset the internal map first
      messageTrackerHandler.stopCleanupInterval();

      // Track but DON'T mark as handled
      messageTrackerHandler.trackMessageInChannel(unhandledMessage);

      // Create a similar message with different ID
      const similarUnhandledMessage = {
        ...unhandledMessage,
        id: 'similar-to-unhandled',
      };

      // Setup for this test only
      contentSimilarity.areContentsSimilar.mockImplementation((a, b) => {
        // Only return true for our specific content
        if (a === unhandledMessage.content || b === unhandledMessage.content) {
          return true;
        }
        return false;
      });

      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarUnhandledMessage);
      expect(hasSimilar).toBe(false);
      expect(contentSimilarity.areContentsSimilar).toHaveBeenCalled();

      // Clean up
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      messageTrackerHandler.stopCleanupInterval();
    });
  });

  describe('markMessageAsHandled', () => {
    it('should mark a message as handled', () => {
      // Reset internal state completely first
      messageTrackerHandler.stopCleanupInterval();

      // Create a fresh test message with unique channel and content
      const markedMessage = {
        id: 'test-marking-handled',
        content: 'Message content for marking handled test',
        channel: {
          id: 'channel-test-marking',
        },
      };

      // Track the message (initially not handled)
      messageTrackerHandler.trackMessageInChannel(markedMessage);

      // Create a similar message with different ID
      const similarToMarked = {
        ...markedMessage,
        id: 'similar-to-marked',
      };

      // Setup the similarity checker specifically for this test
      contentSimilarity.areContentsSimilar.mockImplementation((a, b) => {
        // Only match our specific test message content
        if (
          (a === markedMessage.content || b === markedMessage.content) &&
          (a === similarToMarked.content || b === similarToMarked.content)
        ) {
          return true;
        }
        return false;
      });

      // First check: should return false because not marked as handled yet
      let hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarToMarked);
      expect(hasSimilar).toBe(false);

      // Mark the message as handled
      messageTrackerHandler.markMessageAsHandled(markedMessage);

      // Second check: should return true because it's now handled
      hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarToMarked);
      expect(hasSimilar).toBe(true);

      // Cleanup for other tests
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      messageTrackerHandler.stopCleanupInterval();
    });

    it('should handle non-existent messages gracefully', () => {
      // Should not throw when trying to mark a message that wasn't tracked
      expect(() => {
        messageTrackerHandler.markMessageAsHandled({
          id: 'not-tracked',
          channel: { id: 'wrong-channel' },
        });
      }).not.toThrow();
    });
  });

  describe('delayedProcessing', () => {
    it('should process message after delay if not a duplicate', async () => {
      // Reset all mocks and state
      jest.clearAllMocks();
      messageTrackerHandler.stopCleanupInterval();

      // Mock handler function that resolves immediately
      const mockHandlerFunction = jest.fn().mockImplementation(async () => {
        return Promise.resolve();
      });

      // Mock personality
      const mockPersonality = { fullName: 'test-personality' };

      // Set up for no similar messages
      contentSimilarity.areContentsSimilar.mockReturnValue(false);

      // Setup message fetch to succeed
      mockMessage.channel.messages.fetch.mockResolvedValue(mockMessage);

      // Call delayed processing - need to await it
      const processPromise = messageTrackerHandler.delayedProcessing(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        mockHandlerFunction
      );

      // Fast-forward time and run all pending timers
      jest.advanceTimersByTime(contentSimilarity.getProxyDelayTime());

      // Flush all resolved promises
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Wait for the entire processing to complete
      await processPromise;

      // Verify the message was fetched
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith(mockMessage.id);

      // Handler should have been called with the right arguments
      expect(mockHandlerFunction).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockMessage.id }),
        mockPersonality,
        null,
        mockClient
      );
    });

    it('should not process message if a similar message was already handled', async () => {
      // Mock handler function
      const mockHandlerFunction = jest.fn().mockResolvedValue(undefined);

      // Mock personality
      const mockPersonality = { fullName: 'test-personality' };

      // Track an existing message and mark it as handled
      const existingMessage = { ...mockMessage, id: 'existing-message' };
      messageTrackerHandler.trackMessageInChannel(existingMessage);
      messageTrackerHandler.markMessageAsHandled(existingMessage);

      // Set up for similar messages
      contentSimilarity.areContentsSimilar.mockReturnValue(true);

      // Call delayed processing
      const processPromise = messageTrackerHandler.delayedProcessing(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        mockHandlerFunction
      );

      // Wait for the delayedProcessing promise to resolve
      await processPromise;

      // Handler should not have been called
      expect(mockHandlerFunction).not.toHaveBeenCalled();
    });

    it('should not process if message no longer exists after delay', async () => {
      // Reset all mocks
      jest.clearAllMocks();
      messageTrackerHandler.stopCleanupInterval();

      // Mock handler function
      const mockHandlerFunction = jest.fn().mockResolvedValue(undefined);

      // Mock personality
      const mockPersonality = { fullName: 'test-personality' };

      // Set up for no similar messages
      contentSimilarity.areContentsSimilar.mockReturnValue(false);

      // Mock fetch to simulate message being deleted
      mockMessage.channel.messages.fetch.mockRejectedValueOnce(new Error('Unknown Message'));

      // Call delayed processing
      const processPromise = messageTrackerHandler.delayedProcessing(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        mockHandlerFunction
      );

      // Fast-forward timers - need to run pending timers to execute the setTimeout
      jest.advanceTimersByTime(contentSimilarity.getProxyDelayTime());

      // Flush all promises
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Wait for the full processing to complete
      await processPromise;

      // Fetch should have been called
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith(mockMessage.id);

      // Handler should not have been called
      expect(mockHandlerFunction).not.toHaveBeenCalled();
    });
  });
});
