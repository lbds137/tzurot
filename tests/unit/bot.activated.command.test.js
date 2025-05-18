/**
 * Tests for activated personality command handling
 * 
 * This test file verifies that activated personalities will:
 * 1. Ignore messages that are commands (start with the bot prefix)
 * 2. Respond to all other non-command messages
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

describe('Bot Activated Personality Command Handling', () => {
  let mockMessage;
  let mockClient;
  let messageHandler;
  let handlePersonalityInteraction;
  
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
        setActivity: jest.fn()
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
        bot: false
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
      webhookId: null
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
    
    // Create a spy for handlePersonalityInteraction
    // Since we can't directly access it from the bot module, we'll check if the implementation
    // calls the correct functions after processing the message
  });
  
  it('should ignore command messages when a personality is activated', async () => {
    // Set message to be a deactivate command
    mockMessage.content = '!tz deactivate';
    
    // Trigger message handler
    await messageHandler(mockMessage);
    
    // Verify that the appropriate checks were made
    expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    
    // Check that the message was recognized as a command that should be ignored
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('ignoring command message'));
    
    // Most importantly, verify that no attempt was made to get the personality for response
    // This check is our way of verifying handlePersonalityInteraction wasn't called
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
  });
  
  it('should respond to non-command messages when a personality is activated', async () => {
    // Set message to be a regular message, not a command
    mockMessage.content = 'Hello personality!';
    
    // Trigger message handler
    await messageHandler(mockMessage);
    
    // Verify the appropriate checks were made
    expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    
    // Verify that personality was retrieved - this means we attempted to respond
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
  });
  
  it('should treat !tz by itself as a command and ignore it', async () => {
    // Set message to be just the command prefix
    mockMessage.content = '!tz';
    
    // Trigger message handler
    await messageHandler(mockMessage);
    
    // Check that the message was recognized as a command
    // We can tell by the fact that getPersonality should not be called
    // even though getActivatedPersonality should return a value
    expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
  });
  
  it('should only consider messages starting with the exact prefix as commands', async () => {
    // Set message with text that contains but doesn't start with the prefix
    mockMessage.content = 'This message has !tz in the middle';
    
    // Trigger message handler
    await messageHandler(mockMessage);
    
    // Verify the appropriate checks were made
    expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    
    // Verify that personality was retrieved - this means we attempted to respond
    // because this is NOT recognized as a command
    expect(personalityManager.getPersonality).toHaveBeenCalledWith('test-personality');
  });
  
  it('should ignore commands without a space after prefix (bug fix)', async () => {
    // This test specifically verifies the fix for the issue where commands like "!tzhelp" were not being ignored
    
    // Set message to be a command without a space after prefix
    mockMessage.content = '!tzhelp';
    
    // Trigger message handler
    await messageHandler(mockMessage);
    
    // Verify the appropriate checks were made
    expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    
    // Check that the message was recognized as a command that should be ignored
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('ignoring command message'));
    
    // Verify that no attempt was made to get the personality for response
    expect(personalityManager.getPersonality).not.toHaveBeenCalled();
  });
});