/**
 * Tests for the deduplication middleware
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');

describe('Deduplication Middleware', () => {
  let deduplicationMiddleware;
  let mockMessage;
  let mockMessageTracker;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock message
    mockMessage = helpers.createMockMessage();

    // Create mock messageTracker instance
    mockMessageTracker = {
      isProcessed: jest.fn().mockReturnValue(false),
      markAsProcessed: jest.fn(),
      isRecentCommand: jest.fn().mockReturnValue(false),
      isAddCommandProcessed: jest.fn().mockReturnValue(false),
      markAddCommandAsProcessed: jest.fn(),
    };

    // Import module after mock setup
    deduplicationMiddleware = require('../../../../src/commands/middleware/deduplication');
  });

  it('should block already processed messages', () => {
    // Mock the message as already processed
    mockMessageTracker.isProcessed.mockReturnValue(true);

    const result = deduplicationMiddleware(mockMessage, 'ping', [], mockMessageTracker);

    expect(result.shouldProcess).toBe(false);
    expect(mockMessageTracker.isProcessed).toHaveBeenCalledWith(mockMessage.id);
    expect(mockMessageTracker.markAsProcessed).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('already processed, skipping duplicate command')
    );
  });

  it('should mark messages as processed', () => {
    // Mock the message as not processed
    mockMessageTracker.isProcessed.mockReturnValue(false);

    deduplicationMiddleware(mockMessage, 'ping', [], mockMessageTracker);

    expect(mockMessageTracker.markAsProcessed).toHaveBeenCalledWith(mockMessage.id);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('will be processed'));
  });

  it('should block recent duplicate commands', () => {
    // Mock the message as a recent duplicate command
    mockMessageTracker.isRecentCommand.mockReturnValue(true);

    const result = deduplicationMiddleware(mockMessage, 'ping', [], mockMessageTracker);

    expect(result.shouldProcess).toBe(false);
    expect(mockMessageTracker.isRecentCommand).toHaveBeenCalledWith(
      mockMessage.author.id,
      'ping',
      []
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Detected duplicate command execution')
    );
  });

  it('should allow non-duplicate commands', () => {
    // Mock the message as not a duplicate
    mockMessageTracker.isProcessed.mockReturnValue(false);
    mockMessageTracker.isRecentCommand.mockReturnValue(false);

    const result = deduplicationMiddleware(mockMessage, 'ping', [], mockMessageTracker);

    expect(result.shouldProcess).toBe(true);
  });

  it('should handle add command special case', () => {
    // Test add command that hasn't been processed
    mockMessageTracker.isAddCommandProcessed.mockReturnValue(false);

    const result = deduplicationMiddleware(
      mockMessage,
      'add',
      ['test-personality'],
      mockMessageTracker
    );

    expect(result.shouldProcess).toBe(true);
    expect(mockMessageTracker.isAddCommandProcessed).toHaveBeenCalledWith(mockMessage.id);
    // We removed markAddCommandAsProcessed from middleware - it's now done in the handler
    expect(mockMessageTracker.markAddCommandAsProcessed).not.toHaveBeenCalled();
  });

  it('should handle create command as alias for add', () => {
    // Test create command (alias for add)
    mockMessageTracker.isAddCommandProcessed.mockReturnValue(false);

    const result = deduplicationMiddleware(
      mockMessage,
      'create',
      ['test-personality'],
      mockMessageTracker
    );

    expect(result.shouldProcess).toBe(true);
    expect(mockMessageTracker.isAddCommandProcessed).toHaveBeenCalledWith(mockMessage.id);
    // We removed markAddCommandAsProcessed from middleware - it's now done in the handler
    expect(mockMessageTracker.markAddCommandAsProcessed).not.toHaveBeenCalled();
  });

  it('should block already processed add commands', () => {
    // Test add command that has already been processed
    mockMessageTracker.isAddCommandProcessed.mockReturnValue(true);

    const result = deduplicationMiddleware(
      mockMessage,
      'add',
      ['test-personality'],
      mockMessageTracker
    );

    expect(result.shouldProcess).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('already been processed by add command handler')
    );
  });
});
