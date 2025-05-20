/**
 * Test script for the add command deduplication fix
 * 
 * IMPORTANT: This test uses a mock message tracker to avoid affecting real data
 */
const logger = require('../src/logger');

// Mock message tracker to avoid affecting real data
class MockMessageTracker {
  constructor() {
    this.processedMessages = new Set();
    this.addCommandMessageIds = new Set();
    this.sendingEmbedResponses = new Set();
    this.hasGeneratedFirstEmbed = new Set();
    this.completedAddCommands = new Set();
    this.recentCommands = new Map();
  }
  
  isProcessed(messageId) {
    return this.processedMessages.has(messageId);
  }
  
  markAsProcessed(messageId) {
    this.processedMessages.add(messageId);
    logger.debug(`[MockTracker] Message ${messageId} marked as processed`);
  }
  
  isAddCommandProcessed(messageId) {
    return this.addCommandMessageIds.has(messageId);
  }
  
  markAddCommandAsProcessed(messageId) {
    this.addCommandMessageIds.add(messageId);
    logger.debug(`[MockTracker] Add command message ${messageId} marked as processed`);
  }
  
  isRecentCommand(userId, command, args) {
    const commandKey = `${userId}-${command}-${args.join('-')}`;
    const timestamp = this.recentCommands.get(commandKey);
    
    if (timestamp && Date.now() - timestamp < 3000) {
      logger.info(`[MockTracker] Detected duplicate command execution: ${command} from ${userId}`);
      return true;
    }
    
    // Mark this command as recent
    this.recentCommands.set(commandKey, Date.now());
    return false;
  }
}

// Create a mock tracker instance
const mockMessageTracker = new MockMessageTracker();

// Mock deduplication middleware using our mock tracker
function mockDeduplicationMiddleware(message, command, args) {
  // Check if message was already processed
  if (mockMessageTracker.isProcessed(message.id)) {
    logger.info(`[Deduplication] Message ${message.id} already processed, skipping duplicate command`);
    return {
      shouldProcess: false,
      error: null
    };
  }
  
  // Mark the message as processed
  mockMessageTracker.markAsProcessed(message.id);
  logger.info(`[Deduplication] Message ${message.id} will be processed`);
  
  // Check if this is a duplicate command based on user, command, and args
  if (mockMessageTracker.isRecentCommand(message.author.id, command, args)) {
    logger.info(`[Deduplication] Detected duplicate command execution: ${command} from ${message.author.tag}, ignoring`);
    return {
      shouldProcess: false,
      error: null
    };
  }
  
  // Special case for add command
  if (command === 'add' || command === 'create') {
    if (mockMessageTracker.isAddCommandProcessed(message.id)) {
      logger.warn(`[Deduplication] This message (${message.id}) has already been processed by add command handler`);
      return {
        shouldProcess: false,
        error: null
      };
    }
    
    // IMPORTANT: We do NOT mark the command as processed here
    // This is done in the handler to avoid double-marking issues
  }
  
  // Command should be processed
  return {
    shouldProcess: true
  };
}

// Mock the add command handler's behavior
function mockAddCommandHandler(messageId) {
  const isProcessed = mockMessageTracker.isAddCommandProcessed(messageId);
  if (isProcessed) {
    logger.warn(`[AddCommand] This message (${messageId}) has already been processed by add command handler`);
    return false;
  }
  
  // Mark the message as processed
  mockMessageTracker.markAddCommandAsProcessed(messageId);
  logger.info(`[AddCommand] Message ${messageId} marked as processed`);
  return true;
}

// Mock a message
function createMockMessage(id) {
  return {
    id,
    author: { id: '123', tag: 'testUser#1234' },
    content: '!tz add testpersonality',
    channel: {
      send: () => Promise.resolve({ id: 'response-' + id }),
      sendTyping: () => Promise.resolve()
    }
  };
}

// Test the fix
async function runTest() {
  logger.info('Starting add command deduplication test (USING MOCKS)');
  
  // Test case 1: First-time message - should process normally
  const mockMessage1 = createMockMessage('test-message-1');
  
  // Apply middleware
  logger.info('Test Case 1: First-time message processing');
  const middlewareResult1 = mockDeduplicationMiddleware(mockMessage1, 'add', ['testpersonality']);
  logger.info(`Middleware result: shouldProcess=${middlewareResult1.shouldProcess}`);
  
  // Process command if middleware allows
  if (middlewareResult1.shouldProcess) {
    const handlerResult1 = mockAddCommandHandler(mockMessage1.id);
    logger.info(`Handler processed message: ${handlerResult1}`);
  }
  
  // Test case 2: Same message ID again - should be blocked by middleware
  logger.info('\nTest Case 2: Same message ID processed again');
  const middlewareResult2 = mockDeduplicationMiddleware(mockMessage1, 'add', ['testpersonality']);
  logger.info(`Middleware result: shouldProcess=${middlewareResult2.shouldProcess}`);
  
  if (middlewareResult2.shouldProcess) {
    const handlerResult2 = mockAddCommandHandler(mockMessage1.id);
    logger.info(`Handler processed message: ${handlerResult2}`);
  } else {
    logger.info('Correctly blocked by middleware');
  }
  
  // Test case 3: New message ID - should process normally
  const mockMessage3 = createMockMessage('test-message-3');
  
  logger.info('\nTest Case 3: New message ID');
  const middlewareResult3 = mockDeduplicationMiddleware(mockMessage3, 'add', ['testpersonality']);
  logger.info(`Middleware result: shouldProcess=${middlewareResult3.shouldProcess}`);
  
  if (middlewareResult3.shouldProcess) {
    const handlerResult3 = mockAddCommandHandler(mockMessage3.id);
    logger.info(`Handler processed message: ${handlerResult3}`);
  }
  
  logger.info('\nTest completed - verify the logs above show correct behavior');
}

// Run the test
runTest();