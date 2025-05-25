/**
 * Tests for the deduplication middleware
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../src/commands/utils/messageTracker', () => ({
  isProcessed: jest.fn(),
  markAsProcessed: jest.fn(),
  isRecentCommand: jest.fn(),
  isAddCommandProcessed: jest.fn(),
  markAddCommandAsProcessed: jest.fn()
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const messageTracker = require('../../../../src/commands/utils/messageTracker');

describe('Deduplication Middleware', () => {
  let deduplicationMiddleware;
  let mockMessage;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock message
    mockMessage = helpers.createMockMessage();
    
    // Set up default mock behavior
    messageTracker.isProcessed.mockReturnValue(false);
    messageTracker.isRecentCommand.mockReturnValue(false);
    messageTracker.isAddCommandProcessed.mockReturnValue(false);
    
    // Import module after mock setup
    deduplicationMiddleware = require('../../../../src/commands/middleware/deduplication');
  });
  
  it('should block already processed messages', () => {
    // Mock the message as already processed
    messageTracker.isProcessed.mockReturnValue(true);
    
    const result = deduplicationMiddleware(mockMessage, 'ping', []);
    
    expect(result.shouldProcess).toBe(false);
    expect(messageTracker.isProcessed).toHaveBeenCalledWith(mockMessage.id);
    expect(messageTracker.markAsProcessed).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('already processed, skipping duplicate command')
    );
  });
  
  it('should mark messages as processed', () => {
    // Mock the message as not processed
    messageTracker.isProcessed.mockReturnValue(false);
    
    deduplicationMiddleware(mockMessage, 'ping', []);
    
    expect(messageTracker.markAsProcessed).toHaveBeenCalledWith(mockMessage.id);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('will be processed')
    );
  });
  
  it('should block recent duplicate commands', () => {
    // Mock the message as a recent duplicate command
    messageTracker.isRecentCommand.mockReturnValue(true);
    
    const result = deduplicationMiddleware(mockMessage, 'ping', []);
    
    expect(result.shouldProcess).toBe(false);
    expect(messageTracker.isRecentCommand).toHaveBeenCalledWith(
      mockMessage.author.id, 'ping', []
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Detected duplicate command execution')
    );
  });
  
  it('should allow non-duplicate commands', () => {
    // Mock the message as not a duplicate
    messageTracker.isProcessed.mockReturnValue(false);
    messageTracker.isRecentCommand.mockReturnValue(false);
    
    const result = deduplicationMiddleware(mockMessage, 'ping', []);
    
    expect(result.shouldProcess).toBe(true);
  });
  
  it('should handle add command special case', () => {
    // Test add command that hasn't been processed
    messageTracker.isAddCommandProcessed.mockReturnValue(false);
    
    const result = deduplicationMiddleware(mockMessage, 'add', ['test-personality']);
    
    expect(result.shouldProcess).toBe(true);
    expect(messageTracker.isAddCommandProcessed).toHaveBeenCalledWith(mockMessage.id);
    // We removed markAddCommandAsProcessed from middleware - it's now done in the handler
    expect(messageTracker.markAddCommandAsProcessed).not.toHaveBeenCalled();
  });
  
  it('should handle create command as alias for add', () => {
    // Test create command (alias for add)
    messageTracker.isAddCommandProcessed.mockReturnValue(false);
    
    const result = deduplicationMiddleware(mockMessage, 'create', ['test-personality']);
    
    expect(result.shouldProcess).toBe(true);
    expect(messageTracker.isAddCommandProcessed).toHaveBeenCalledWith(mockMessage.id);
    // We removed markAddCommandAsProcessed from middleware - it's now done in the handler
    expect(messageTracker.markAddCommandAsProcessed).not.toHaveBeenCalled();
  });
  
  it('should block already processed add commands', () => {
    // Test add command that has already been processed
    messageTracker.isAddCommandProcessed.mockReturnValue(true);
    
    const result = deduplicationMiddleware(mockMessage, 'add', ['test-personality']);
    
    expect(result.shouldProcess).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already been processed by add command handler')
    );
  });
});