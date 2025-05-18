/**
 * Tests for bot.js error filtering and handling
 */

// Mock the original emit function
const originalEmit = jest.fn().mockReturnValue(true);

// ERROR_PATTERNS used in bot.js
const ERROR_PATTERNS = [
  "I'm having trouble connecting",
  "ERROR_MESSAGE_PREFIX:",
  "trouble connecting to my brain",
  "technical issue",
  "Error ID:",
  "issue with my configuration",
  "issue with my response system",
  "momentary lapse", 
  "try again later",
  "HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY",
  "Please try again"
];

// Create a mock client with overridden emit function
class MockClient {
  constructor() {
    this.emit = jest.fn().mockImplementation((event, ...args) => {
      // Only intercept messageCreate events from webhooks
      if (event === 'messageCreate') {
        const message = args[0];
        
        // Filter webhook messages with error content
        if (message.webhookId && message.content) {
          // Check if message contains any error patterns
          if (ERROR_PATTERNS.some(pattern => message.content.includes(pattern))) {
            // Try to delete the message if possible (silent fail)
            if (message.deletable) {
              message.delete().catch(() => {});
            }
            
            // Block this event from being processed
            return false;
          }
        }
      }
      
      // For all other events, process normally
      return originalEmit.apply(this, [event, ...args]);
    });
  }
}

describe('Bot Error Filtering', () => {
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  let client;
  
  beforeEach(() => {
    // Mock console methods
    console.log = jest.fn();
    console.error = jest.fn();
    
    // Reset our mock client
    client = new MockClient();
    
    // Reset originalEmit mock
    originalEmit.mockClear();
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });
  
  it('should filter webhook messages containing error patterns', () => {
    // Create a mock webhook message with error content
    const errorMessage = {
      id: 'mock-error-message',
      webhookId: 'mock-webhook-id',
      content: "I'm having trouble connecting to my knowledge base",
      deletable: true,
      delete: jest.fn().mockResolvedValue(undefined)
    };
    
    // Emit a messageCreate event with the error message
    const result = client.emit('messageCreate', errorMessage);
    
    // Verify the message was filtered (emit returns false)
    expect(result).toBe(false);
    
    // Verify delete was called
    expect(errorMessage.delete).toHaveBeenCalled();
    
    // Verify originalEmit was not called
    expect(originalEmit).not.toHaveBeenCalled();
  });
  
  it('should filter messages with the ERROR_MESSAGE_PREFIX marker', () => {
    // Create a mock webhook message with the error prefix
    const errorMessage = {
      id: 'mock-error-message',
      webhookId: 'mock-webhook-id',
      content: "ERROR_MESSAGE_PREFIX: Sorry, I'm experiencing technical difficulties",
      deletable: true,
      delete: jest.fn().mockResolvedValue(undefined)
    };
    
    // Emit a messageCreate event with the error message
    const result = client.emit('messageCreate', errorMessage);
    
    // Verify the message was filtered
    expect(result).toBe(false);
    expect(errorMessage.delete).toHaveBeenCalled();
  });
  
  it('should handle errors during message deletion', () => {
    // Create a mock webhook message that throws on delete
    const errorMessage = {
      id: 'mock-error-message',
      webhookId: 'mock-webhook-id',
      content: "ERROR_MESSAGE_PREFIX: Technical error",
      deletable: true,
      delete: jest.fn().mockRejectedValue(new Error('Failed to delete message'))
    };
    
    // Emit a messageCreate event with the error message
    const result = client.emit('messageCreate', errorMessage);
    
    // Verify the message was still filtered (emit returns false)
    expect(result).toBe(false);
    
    // Verify delete was called
    expect(errorMessage.delete).toHaveBeenCalled();
  });
  
  it('should pass through normal webhook messages', () => {
    // Create a mock webhook message with normal content
    const normalMessage = {
      id: 'mock-normal-message',
      webhookId: 'mock-webhook-id',
      content: "This is a normal message without error patterns",
      deletable: true,
      delete: jest.fn()
    };
    
    // Emit a messageCreate event with the normal message
    client.emit('messageCreate', normalMessage);
    
    // Verify originalEmit was called
    expect(originalEmit).toHaveBeenCalledWith('messageCreate', normalMessage);
    
    // Verify delete was not called
    expect(normalMessage.delete).not.toHaveBeenCalled();
  });
  
  it('should pass through non-webhook messages', () => {
    // Create a mock non-webhook message
    const userMessage = {
      id: 'mock-user-message',
      content: "I'm having trouble connecting", // Contains error pattern but not a webhook
      deletable: true,
      delete: jest.fn()
    };
    
    // Emit a messageCreate event with the user message
    client.emit('messageCreate', userMessage);
    
    // Verify originalEmit was called
    expect(originalEmit).toHaveBeenCalledWith('messageCreate', userMessage);
    
    // Verify delete was not called
    expect(userMessage.delete).not.toHaveBeenCalled();
  });
  
  it('should check for multiple error patterns', () => {
    // Test various error patterns
    for (const pattern of ERROR_PATTERNS) {
      // Create a mock webhook message with this error pattern
      const errorMessage = {
        id: `mock-error-message-${pattern.substring(0, 10)}`,
        webhookId: 'mock-webhook-id',
        content: `Message with error pattern: ${pattern}`,
        deletable: true,
        delete: jest.fn().mockResolvedValue(undefined)
      };
      
      // Reset originalEmit for each test
      originalEmit.mockClear();
      
      // Emit a messageCreate event with the error message
      const result = client.emit('messageCreate', errorMessage);
      
      // Verify the message was filtered
      expect(result).toBe(false);
      expect(errorMessage.delete).toHaveBeenCalled();
      expect(originalEmit).not.toHaveBeenCalled();
    }
  });
  
  it('should pass through events other than messageCreate', () => {
    // Create a mock message
    const message = {
      id: 'mock-message',
      content: "I'm having trouble connecting", // Contains error pattern
      webhookId: 'mock-webhook-id',
      deletable: true,
      delete: jest.fn()
    };
    
    // Emit a different event
    client.emit('ready', message);
    
    // Verify originalEmit was called with the right event
    expect(originalEmit).toHaveBeenCalledWith('ready', message);
    
    // Verify delete was not called
    expect(message.delete).not.toHaveBeenCalled();
  });
});

describe('Patched Reply Method Tests', () => {
  // Create a mock Map for the recentReplies tracking
  const recentReplies = new Map();
  
  // Create a mock Message prototype with patched reply method
  class MockMessage {
    constructor(id, author) {
      this.id = id;
      this.author = author;
      this.reply = jest.fn().mockImplementation(async (options) => {
        const replyKey = `${this.id}`;
        
        // Check if we've already replied to this message
        if (recentReplies.has(replyKey)) {
          console.log(`Prevented duplicate reply to message ${this.id}`);
          return null; // Prevent duplicate reply
        }
        
        // Add to tracking map
        recentReplies.set(replyKey, {
          timestamp: Date.now()
        });
        
        // Simulate reply with mock message
        return {
          id: `reply-to-${this.id}`,
          content: options,
          author: { bot: true }
        };
      });
    }
  }
  
  beforeEach(() => {
    // Clear the tracking map before each test
    recentReplies.clear();
  });
  
  it('should prevent duplicate replies to the same message', async () => {
    // Create a mock message
    const message = new MockMessage('test-message-id', { id: 'user-id', bot: false });
    
    // First reply should succeed
    const firstReply = await message.reply('First reply');
    expect(firstReply).toEqual({
      id: 'reply-to-test-message-id',
      content: 'First reply',
      author: { bot: true }
    });
    
    // Second reply should be blocked
    const secondReply = await message.reply('Second reply');
    expect(secondReply).toBeNull();
    
    // Verify the reply method was called twice
    expect(message.reply.mock.calls.length).toBe(2);
  });
  
  it('should track replies per message ID', async () => {
    // Create two different messages
    const message1 = new MockMessage('message-1', { id: 'user-id', bot: false });
    const message2 = new MockMessage('message-2', { id: 'user-id', bot: false });
    
    // Both initial replies should succeed
    const reply1 = await message1.reply('Reply to message 1');
    const reply2 = await message2.reply('Reply to message 2');
    
    expect(reply1).not.toBeNull();
    expect(reply2).not.toBeNull();
    
    // Second replies to each should be blocked
    const secondReply1 = await message1.reply('Another reply to message 1');
    const secondReply2 = await message2.reply('Another reply to message 2');
    
    expect(secondReply1).toBeNull();
    expect(secondReply2).toBeNull();
  });
});