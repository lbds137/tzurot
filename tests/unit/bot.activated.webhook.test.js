/**
 * Tests for activated personality webhook message handling
 * 
 * This test file verifies that activated personalities will:
 * 1. Ignore webhook messages from themselves to prevent infinite loops
 * 2. Still respond to actual user messages
 */

// Mock dependencies
jest.mock('discord.js');
jest.mock('../../src/personalityManager');
jest.mock('../../src/conversationManager');
jest.mock('../../src/aiService');
jest.mock('../../src/webhookManager');
jest.mock('../../src/commands');
jest.mock('../../config');
jest.mock('../../src/logger');

// Import necessary modules
const { Client } = require('discord.js');
const personalityManager = require('../../src/personalityManager');
const conversationManager = require('../../src/conversationManager');
const config = require('../../config');
const logger = require('../../src/logger');

describe('Bot Activated Personality Webhook Handling', () => {
  let mockMessage;
  let mockClient;
  let messageHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset module registry to ensure fresh imports
    jest.resetModules();
    
    // Set up mock config
    config.botPrefix = '!tz';
    
    // Mock discord.js Client
    mockClient = {
      on: jest.fn(),
      login: jest.fn().mockResolvedValue(true),
      user: {
        tag: 'TestBot#1234',
        setActivity: jest.fn(),
        id: 'bot-user-id'
      },
      channels: {
        cache: new Map()
      },
      guilds: {
        cache: {
          size: 5
        }
      }
    };
    
    // Make the client available globally for the bot
    global.tzurotClient = mockClient;
    
    Client.mockImplementation(() => mockClient);
    
    // Mock message
    mockMessage = {
      id: 'test-message-id',
      content: 'This is a test message',
      author: {
        id: 'user-123',
        tag: 'TestUser#1234',
        bot: true, // This is from a bot
        username: 'TestBotUsername'
      },
      channel: {
        id: 'channel-123',
        send: jest.fn().mockResolvedValue({ id: 'sent-message-id' }),
        isThread: jest.fn().mockReturnValue(false)
      },
      reference: null,
      reply: jest.fn().mockResolvedValue({ id: 'reply-id' }),
      guild: {
        id: 'guild-123'
      },
      member: {
        permissions: {
          has: jest.fn().mockReturnValue(true)
        }
      },
      webhookId: 'webhook-123' // This is from a webhook
    };
    
    // Mock personality
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality'
    };
    
    // Set up personality manager mocks
    personalityManager.getPersonality.mockReturnValue(mockPersonality);
    personalityManager.getPersonalityByAlias.mockReturnValue(null);
    
    // Set up conversation manager mocks
    conversationManager.getActivatedPersonality.mockReturnValue('test-personality');
    
    // Import the bot module after mocks are set up
    require('../../src/bot');
    
    // Capture message handler function
    messageHandler = mockClient.on.mock.calls.find(call => call[0] === 'messageCreate')[1];
  });
  
  it('should ignore webhook messages when there is an activated personality in the channel', async () => {
    // Already set up with webhook message from our bot
    
    // Trigger message handler
    await messageHandler(mockMessage);
    
    // Verify the appropriate checks were made
    expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    
    // Check that the message was recognized as a webhook from activated personality that should be ignored
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring own webhook message from activated personality')
    );
    
    // Verify that no attempt was made to process the message with the personality
    expect(personalityManager.getPersonality).not.toHaveBeenCalledWith('test-personality');
  });
  
  it('should process normal user messages when a personality is activated', async () => {
    // Change message to be from a normal user, not a webhook
    mockMessage.author.bot = false;
    mockMessage.webhookId = null;
    
    // Trigger message handler
    await messageHandler(mockMessage);
    
    // Verify the appropriate checks were made
    expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    
    // Verify that personality was retrieved - this means we attempted to respond
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
  });
});