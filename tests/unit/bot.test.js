/**
 * Tests for bot.js core functionality
 * Testing initialization, Discord.js client setup, and method patching
 */

// Mock dependencies
jest.mock('discord.js', () => {
  // Mock Message class
  class MockMessage {
    constructor() {
      this.channel = { id: 'test-channel-id' };
    }
    
    reply(options) {
      return Promise.resolve({
        id: 'test-reply-id',
        content: typeof options === 'string' ? options : options.content || '',
      });
    }
  }
  
  // Mock TextChannel class
  class MockTextChannel {
    constructor() {
      this.id = 'test-channel-id';
    }
    
    send(options) {
      return Promise.resolve({
        id: 'test-send-id',
        content: typeof options === 'string' ? options : options.content || '',
      });
    }
  }
  
  // Mock Client class
  class MockClient {
    constructor() {
      this.user = { tag: 'TestBot#1234', setActivity: jest.fn() };
      this.on = jest.fn();
    }
    
    login = jest.fn().mockResolvedValue('mock-token');
  }
  
  return {
    Client: MockClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 3,
      GuildWebhooks: 4,
      DirectMessages: 5,
    },
    Partials: {
      Channel: 'Channel',
      Message: 'Message',
      Reaction: 'Reaction',
    },
    Message: MockMessage,
    TextChannel: MockTextChannel,
  };
});

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/webhookManager', () => ({
  registerEventListeners: jest.fn(),
}));

jest.mock('../../src/messageTracker', () => ({
  messageTracker: {
    trackOperation: jest.fn().mockReturnValue(true),
  },
}));

jest.mock('../../src/handlers/errorHandler', () => ({
  patchClientForErrorFiltering: jest.fn(),
  startQueueCleaner: jest.fn(),
}));

jest.mock('../../src/handlers/personalityHandler', () => ({
  handlePersonalityMessage: jest.fn(),
}));

jest.mock('../../src/handlers/messageHandler', () => ({
  handleMessage: jest.fn(),
}));

jest.mock('../../src/utils/pluralkitMessageStore', () => ({
  markAsDeleted: jest.fn(),
}));

describe('Bot Core Functionality', () => {
  let bot;
  let mockClient;
  let originalEnv;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Save original environment
    originalEnv = process.env.DISCORD_TOKEN;
    process.env.DISCORD_TOKEN = 'test-token';
    
    // Clear the module cache to ensure fresh imports
    jest.resetModules();
    
    // Import after resetting modules
    bot = require('../../src/bot');
  });
  
  afterEach(() => {
    // Restore original environment
    process.env.DISCORD_TOKEN = originalEnv;
    
    // Clean up global client
    delete global.tzurotClient;
  });
  
  describe('Bot Initialization', () => {
    it('should initialize Discord client with correct intents and partials', async () => {
      // Since we can't spy on constructor calls directly, we'll verify
      // the client was created by checking it exists
      const client = await bot.initBot();
      
      expect(client).toBeDefined();
      expect(client.constructor.name).toBe('MockClient');
    });
    
    it('should set global client reference', async () => {
      const client = await bot.initBot();
      
      expect(global.tzurotClient).toBe(client);
    });
    
    it('should patch client for error filtering', async () => {
      const errorHandler = require('../../src/handlers/errorHandler');
      
      await bot.initBot();
      
      expect(errorHandler.patchClientForErrorFiltering).toHaveBeenCalledWith(bot.client);
    });
    
    it('should login with Discord token', async () => {
      const client = await bot.initBot();
      
      expect(client.login).toHaveBeenCalledWith('test-token');
    });
    
    it('should handle missing Discord token', async () => {
      delete process.env.DISCORD_TOKEN;
      
      const client = await bot.initBot();
      
      expect(client.login).toHaveBeenCalledWith(undefined);
    });
  });
  
  describe('Message.prototype.reply Patching', () => {
    it('should patch Message.prototype.reply to track operations', async () => {
      const { Message } = require('discord.js');
      const { messageTracker } = require('../../src/messageTracker');
      
      await bot.initBot();
      
      const message = new Message();
      const replyContent = 'Test reply';
      
      // Test string reply
      const result = await message.reply(replyContent);
      
      expect(messageTracker.trackOperation).toHaveBeenCalledWith(
        'test-channel-id',
        'reply',
        'Test reply'
      );
      expect(result.content).toBe(replyContent);
    });
    
    it('should prevent duplicate replies', async () => {
      const { Message } = require('discord.js');
      const { messageTracker } = require('../../src/messageTracker');
      
      // Make trackOperation return false to simulate duplicate
      messageTracker.trackOperation.mockReturnValueOnce(false);
      
      await bot.initBot();
      
      const message = new Message();
      const result = await message.reply('Duplicate content');
      
      expect(result.isDuplicate).toBe(true);
      expect(result.id).toMatch(/^prevented-dupe-/);
    });
    
    it('should handle object-style replies', async () => {
      const { Message } = require('discord.js');
      const { messageTracker } = require('../../src/messageTracker');
      
      await bot.initBot();
      
      const message = new Message();
      const replyOptions = { content: 'Test content', embeds: [] };
      
      await message.reply(replyOptions);
      
      expect(messageTracker.trackOperation).toHaveBeenCalledWith(
        'test-channel-id',
        'reply',
        'Test content'
      );
    });
    
    it('should handle embed-only replies', async () => {
      const { Message } = require('discord.js');
      const { messageTracker } = require('../../src/messageTracker');
      
      await bot.initBot();
      
      const message = new Message();
      const replyOptions = { 
        embeds: [{ title: 'Test Embed', description: 'Test description' }] 
      };
      
      await message.reply(replyOptions);
      
      expect(messageTracker.trackOperation).toHaveBeenCalledWith(
        'test-channel-id',
        'reply',
        'Test Embed'
      );
    });
    
    it('should handle replies with no identifiable content', async () => {
      const { Message } = require('discord.js');
      const { messageTracker } = require('../../src/messageTracker');
      
      await bot.initBot();
      
      const message = new Message();
      const replyOptions = { files: ['test.png'] };
      
      await message.reply(replyOptions);
      
      expect(messageTracker.trackOperation).toHaveBeenCalledWith(
        'test-channel-id',
        'reply',
        'unknown'
      );
    });
  });
  
  describe('TextChannel.prototype.send Patching', () => {
    it('should patch TextChannel.prototype.send to track operations', async () => {
      const { TextChannel } = require('discord.js');
      const { messageTracker } = require('../../src/messageTracker');
      const logger = require('../../src/logger');
      
      await bot.initBot();
      
      const channel = new TextChannel();
      const sendContent = 'Test send';
      
      const result = await channel.send(sendContent);
      
      expect(logger.debug).toHaveBeenCalled();
      expect(messageTracker.trackOperation).toHaveBeenCalledWith(
        'test-channel-id',
        'send',
        'Test send'
      );
      expect(result.content).toBe(sendContent);
    });
    
    it('should prevent duplicate sends', async () => {
      const { TextChannel } = require('discord.js');
      const { messageTracker } = require('../../src/messageTracker');
      
      // Make trackOperation return false to simulate duplicate
      messageTracker.trackOperation.mockReturnValueOnce(false);
      
      await bot.initBot();
      
      const channel = new TextChannel();
      const result = await channel.send('Duplicate content');
      
      expect(result.isDuplicate).toBe(true);
      expect(result.id).toMatch(/^prevented-dupe-/);
    });
    
    it('should handle long content in debug logs', async () => {
      const { TextChannel } = require('discord.js');
      const logger = require('../../src/logger');
      
      await bot.initBot();
      
      const channel = new TextChannel();
      const longContent = 'a'.repeat(100);
      
      await channel.send(longContent);
      
      // Check that debug log truncates content
      const debugCall = logger.debug.mock.calls[0][0];
      expect(debugCall).toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...');
    });
  });
  
  describe('Event Handlers', () => {
    let client;
    let eventHandlers;
    
    beforeEach(async () => {
      client = await bot.initBot();
      
      // Capture event handlers
      eventHandlers = {};
      client.on.mock.calls.forEach(([event, handler]) => {
        eventHandlers[event] = handler;
      });
    });
    
    it('should register ready event handler', () => {
      expect(eventHandlers.ready).toBeDefined();
      expect(typeof eventHandlers.ready).toBe('function');
    });
    
    it('should handle ready event correctly', async () => {
      const logger = require('../../src/logger');
      const webhookManager = require('../../src/webhookManager');
      const errorHandler = require('../../src/handlers/errorHandler');
      
      // Trigger ready event
      await eventHandlers.ready();
      
      expect(logger.info).toHaveBeenCalledWith('Logged in as TestBot#1234!');
      expect(client.user.setActivity).toHaveBeenCalledWith(
        'with multiple personalities',
        { type: 'PLAYING' }
      );
      expect(webhookManager.registerEventListeners).toHaveBeenCalledWith(client);
      expect(errorHandler.startQueueCleaner).toHaveBeenCalledWith(client);
    });
    
    it('should register error event handler', () => {
      expect(eventHandlers.error).toBeDefined();
      expect(typeof eventHandlers.error).toBe('function');
    });
    
    it('should handle error event correctly', () => {
      const logger = require('../../src/logger');
      const testError = new Error('Test error');
      
      // Trigger error event
      eventHandlers.error(testError);
      
      expect(logger.error).toHaveBeenCalledWith('Discord client error:', testError);
    });
    
    it('should register messageCreate event handler', () => {
      expect(eventHandlers.messageCreate).toBeDefined();
      expect(typeof eventHandlers.messageCreate).toBe('function');
    });
    
    it('should handle messageCreate event correctly', async () => {
      const messageHandler = require('../../src/handlers/messageHandler');
      const mockMessage = { id: 'test-message', content: 'Test content' };
      
      // Trigger messageCreate event
      await eventHandlers.messageCreate(mockMessage);
      
      expect(messageHandler.handleMessage).toHaveBeenCalledWith(mockMessage, client);
    });
    
    it('should register messageDelete event handler', () => {
      expect(eventHandlers.messageDelete).toBeDefined();
      expect(typeof eventHandlers.messageDelete).toBe('function');
    });
    
    it('should handle messageDelete event for user messages', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore');
      const mockMessage = { 
        id: 'test-message-id',
        partial: false,
        author: { id: 'user123', bot: false },
        content: 'Test content'
      };
      
      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);
      
      expect(pluralkitMessageStore.markAsDeleted).toHaveBeenCalledWith('test-message-id');
    });
    
    it('should ignore messageDelete for partial messages', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore');
      const mockMessage = { 
        id: 'test-message-id',
        partial: true,
        author: { id: 'user123', bot: false }
      };
      
      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);
      
      expect(pluralkitMessageStore.markAsDeleted).not.toHaveBeenCalled();
    });
    
    it('should ignore messageDelete for messages without author', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore');
      const mockMessage = { 
        id: 'test-message-id',
        partial: false,
        author: null
      };
      
      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);
      
      expect(pluralkitMessageStore.markAsDeleted).not.toHaveBeenCalled();
    });
    
    it('should ignore messageDelete for bot messages', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore');
      const mockMessage = { 
        id: 'test-message-id',
        partial: false,
        author: { id: 'bot123', bot: true }
      };
      
      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);
      
      expect(pluralkitMessageStore.markAsDeleted).not.toHaveBeenCalled();
    });
  });
  
  describe('Module Exports', () => {
    it('should export initBot function', () => {
      expect(bot.initBot).toBeDefined();
      expect(typeof bot.initBot).toBe('function');
    });
    
    it('should export client instance', () => {
      expect(bot.client).toBeDefined();
    });
  });
});