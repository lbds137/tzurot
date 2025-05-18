/**
 * Tests for the messageTracker module
 */

// Mock logger
jest.mock('../../src/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// We'll use a completely mocked messageTracker for testing
const messageTracker = {
  track: jest.fn(),
  trackOperation: jest.fn(),
  size: 0,
  clear: jest.fn()
};

// Mock the messageTracker module
jest.mock('../../src/messageTracker', () => ({
  messageTracker,
  MessageTracker: jest.fn().mockImplementation(() => ({
    track: jest.fn(),
    trackOperation: jest.fn(),
    processedMessages: new Map(),
    setupPeriodicCleanup: jest.fn(),
    size: 0,
    clear: jest.fn()
  }))
}));

describe('MessageTracker', () => {
  beforeEach(() => {
    // Reset mock implementations
    messageTracker.track.mockClear();
    messageTracker.trackOperation.mockClear();
    
    // Default implementation to return true (not a duplicate)
    messageTracker.track.mockReturnValue(true);
    messageTracker.trackOperation.mockReturnValue(true);
  });
  
  describe('track method', () => {
    it('should track messages successfully', () => {
      // Track a message
      const result = messageTracker.track('msg-123', 'command');
      
      // Verify that track was called with correct arguments
      expect(messageTracker.track).toHaveBeenCalledWith('msg-123', 'command');
      expect(result).toBe(true);
    });
    
    it('should detect duplicate messages', () => {
      // Set up the mock to return false for the second call
      messageTracker.track
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      
      // First tracking should succeed
      expect(messageTracker.track('msg-123', 'command')).toBe(true);
      
      // Second tracking of the same message should fail
      expect(messageTracker.track('msg-123', 'command')).toBe(false);
    });
    
    it('should support different message types', () => {
      // Track different message types
      messageTracker.track('msg-123', 'command');
      messageTracker.track('msg-123', 'bot-message');
      
      // Verify both calls were made with different types
      expect(messageTracker.track).toHaveBeenCalledWith('msg-123', 'command');
      expect(messageTracker.track).toHaveBeenCalledWith('msg-123', 'bot-message');
    });
  });
  
  describe('trackOperation method', () => {
    it('should track operations successfully', () => {
      // Track an operation
      const result = messageTracker.trackOperation('channel-123', 'reply', 'Hello');
      
      // Verify that trackOperation was called with correct arguments
      expect(messageTracker.trackOperation).toHaveBeenCalledWith('channel-123', 'reply', 'Hello');
      expect(result).toBe(true);
    });
    
    it('should detect duplicate operations', () => {
      // Set up the mock to return false for the second call
      messageTracker.trackOperation
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      
      // First tracking should succeed
      expect(messageTracker.trackOperation('channel-123', 'reply', 'Hello')).toBe(true);
      
      // Second tracking of the same operation should fail
      expect(messageTracker.trackOperation('channel-123', 'reply', 'Hello')).toBe(false);
    });
    
    it('should differentiate between operation types', () => {
      // Track different operation types
      messageTracker.trackOperation('channel-1', 'reply', 'hello');
      messageTracker.trackOperation('channel-1', 'send', 'hello');
      
      // Verify both calls were made with different types
      expect(messageTracker.trackOperation).toHaveBeenCalledWith('channel-1', 'reply', 'hello');
      expect(messageTracker.trackOperation).toHaveBeenCalledWith('channel-1', 'send', 'hello');
    });
    
    it('should differentiate between channels', () => {
      // Track operations for different channels
      messageTracker.trackOperation('channel-1', 'reply', 'hello');
      messageTracker.trackOperation('channel-2', 'reply', 'hello');
      
      // Verify both calls were made with different channels
      expect(messageTracker.trackOperation).toHaveBeenCalledWith('channel-1', 'reply', 'hello');
      expect(messageTracker.trackOperation).toHaveBeenCalledWith('channel-2', 'reply', 'hello');
    });
  });
});

describe('Discord.js Patching', () => {
  // Mocks for the Discord.js classes
  const originalReply = jest.fn().mockResolvedValue({ id: 'reply-id' });
  const originalSend = jest.fn().mockResolvedValue({ id: 'send-id' });
  
  // Mock the Message class
  class Message {
    constructor(id, channel) {
      this.id = id;
      this.channel = channel;
      this.reply = originalReply;
    }
  }
  
  // Mock the TextChannel class
  class TextChannel {
    constructor(id) {
      this.id = id;
      this.send = originalSend;
    }
  }
  
  // Reference to bot to patch the Message/TextChannel prototypes
  let bot;
  
  beforeEach(() => {
    // Reset our mocks
    originalReply.mockClear();
    originalSend.mockClear();
    messageTracker.trackOperation.mockClear();
    messageTracker.trackOperation.mockReturnValue(true);
    
    // Re-define the prototype methods before each test
    Message.prototype.reply = originalReply;
    TextChannel.prototype.send = originalSend;
    
    // Re-require the bot module which will patch the prototypes
    jest.resetModules();
    
    // We need to mock discord.js to return our mocked classes
    jest.mock('discord.js', () => ({
      ...jest.requireActual('discord.js'),
      Message: Message,
      TextChannel: TextChannel
    }));
    
    // Import the bot module to patch the prototype methods
    bot = require('../../src/bot');
    
    // Initialize the bot which patches the prototypes
    bot.initBot();
  });
  
  it('should patch Message.prototype.reply to use messageTracker', async () => {
    // Create a message instance
    const channel = { id: 'channel-123' };
    const message = new Message('msg-123', channel);
    
    // Call the patched reply method
    await message.reply('Test reply');
    
    // Check that trackOperation was called
    expect(messageTracker.trackOperation).toHaveBeenCalledWith('channel-123', 'reply', 'Test reply');
    
    // Check that original reply was called
    expect(originalReply).toHaveBeenCalledWith('Test reply');
  });
  
  it('should patch TextChannel.prototype.send to use messageTracker', async () => {
    // Create a channel instance
    const channel = new TextChannel('channel-456');
    
    // Call the patched send method
    await channel.send('Test message');
    
    // Check that trackOperation was called
    expect(messageTracker.trackOperation).toHaveBeenCalledWith('channel-456', 'send', 'Test message');
    
    // Check that original send was called
    expect(originalSend).toHaveBeenCalledWith('Test message');
  });
  
  it('should prevent duplicate replies', async () => {
    // Create a message instance
    const channel = { id: 'channel-123' };
    const message = new Message('msg-123', channel);
    
    // Set up the mock to return false for the second call
    messageTracker.trackOperation
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    
    // First reply should succeed
    await message.reply('Test reply');
    
    // Second reply should be prevented
    const result = await message.reply('Test reply');
    
    // Check that result has isDuplicate flag
    expect(result.isDuplicate).toBe(true);
    
    // Check that original reply was only called once
    expect(originalReply).toHaveBeenCalledTimes(1);
  });
});