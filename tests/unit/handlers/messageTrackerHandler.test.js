const messageTrackerHandler = require('../../../src/handlers/messageTrackerHandler');
const contentSimilarity = require('../../../src/utils/contentSimilarity');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/contentSimilarity', () => ({
  getProxyDelayTime: jest.fn().mockReturnValue(500),
  areContentsSimilar: jest.fn()
}));

describe('messageTrackerHandler', () => {
  let mockMessage;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the internal state
    messageTrackerHandler.stopCleanupInterval();
    
    // Mock message
    mockMessage = {
      id: 'message-123',
      content: 'Test message content',
      channel: {
        id: 'channel-456',
        messages: {
          fetch: jest.fn().mockResolvedValue({ id: 'message-123' })
        }
      }
    };
    
    // Mock client
    mockClient = {
      user: {
        id: 'client-789'
      }
    };
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
        content: 'Different content'
      };
      
      // No similarity
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      
      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(differentMessage);
      expect(hasSimilar).toBe(false);
      expect(contentSimilarity.areContentsSimilar).toHaveBeenCalled();
    });
    
    it('should return true if a similar message exists and was handled', () => {
      messageTrackerHandler.trackMessageInChannel(mockMessage);
      
      // Mark the message as handled
      messageTrackerHandler.markMessageAsHandled(mockMessage);
      
      // Create a similar message with different ID
      const similarMessage = {
        ...mockMessage,
        id: 'similar-message'
      };
      
      // Mock similarity check to return true
      contentSimilarity.areContentsSimilar.mockReturnValue(true);
      
      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarMessage);
      expect(hasSimilar).toBe(true);
      expect(contentSimilarity.areContentsSimilar).toHaveBeenCalled();
    });
    
    it('should return false if a similar message exists but was not handled', () => {
      messageTrackerHandler.trackMessageInChannel(mockMessage);
      
      // Do NOT mark the message as handled
      
      // Create a similar message with different ID
      const similarMessage = {
        ...mockMessage,
        id: 'similar-message'
      };
      
      // Mock similarity check to return true
      contentSimilarity.areContentsSimilar.mockReturnValue(true);
      
      const hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarMessage);
      expect(hasSimilar).toBe(false);
      expect(contentSimilarity.areContentsSimilar).toHaveBeenCalled();
    });
  });
  
  describe('markMessageAsHandled', () => {
    it('should mark a message as handled', () => {
      messageTrackerHandler.trackMessageInChannel(mockMessage);
      
      // Create a similar message with different ID
      const similarMessage = {
        ...mockMessage,
        id: 'similar-message'
      };
      
      // Initially not similar (not marked as handled)
      contentSimilarity.areContentsSimilar.mockReturnValue(true);
      let hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarMessage);
      expect(hasSimilar).toBe(false);
      
      // Mark the message as handled
      messageTrackerHandler.markMessageAsHandled(mockMessage);
      
      // Now should be detected as similar
      hasSimilar = messageTrackerHandler.hasSimilarRecentMessage(similarMessage);
      expect(hasSimilar).toBe(true);
    });
    
    it('should handle non-existent messages gracefully', () => {
      // Should not throw when trying to mark a message that wasn't tracked
      expect(() => {
        messageTrackerHandler.markMessageAsHandled({ id: 'not-tracked', channel: { id: 'wrong-channel' } });
      }).not.toThrow();
    });
  });
  
  describe('delayedProcessing', () => {
    it('should process message after delay if not a duplicate', async () => {
      // Mock handler function
      const mockHandlerFunction = jest.fn().mockResolvedValue(undefined);
      
      // Mock personality
      const mockPersonality = { fullName: 'test-personality' };
      
      // Set up for no similar messages
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      
      // Call delayed processing
      await messageTrackerHandler.delayedProcessing(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        mockHandlerFunction
      );
      
      // Fast-forward timers
      jest.advanceTimersByTime(contentSimilarity.getProxyDelayTime() + 10);
      
      // Handler should have been called
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
      await messageTrackerHandler.delayedProcessing(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        mockHandlerFunction
      );
      
      // Fast-forward timers
      jest.advanceTimersByTime(contentSimilarity.getProxyDelayTime() + 10);
      
      // Handler should not have been called
      expect(mockHandlerFunction).not.toHaveBeenCalled();
    });
    
    it('should not process if message no longer exists after delay', async () => {
      // Mock handler function
      const mockHandlerFunction = jest.fn().mockResolvedValue(undefined);
      
      // Mock personality
      const mockPersonality = { fullName: 'test-personality' };
      
      // Set up for no similar messages
      contentSimilarity.areContentsSimilar.mockReturnValue(false);
      
      // Mock fetch to simulate message being deleted
      mockMessage.channel.messages.fetch.mockRejectedValueOnce(new Error('Unknown Message'));
      
      // Call delayed processing
      await messageTrackerHandler.delayedProcessing(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        mockHandlerFunction
      );
      
      // Fast-forward timers
      jest.advanceTimersByTime(contentSimilarity.getProxyDelayTime() + 10);
      
      // Fetch should have been called
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith(mockMessage.id);
      
      // Handler should not have been called
      expect(mockHandlerFunction).not.toHaveBeenCalled();
    });
  });
});