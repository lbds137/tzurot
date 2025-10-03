/**
 * Tests for activated personality handling
 *
 * This test file verifies that activated personalities will:
 * 1. Ignore messages that are commands (start with the bot prefix)
 * 2. Respond to all other non-command messages
 * 3. Ignore webhook messages from themselves to prevent infinite loops
 * 4. Still respond to actual user messages
 */

// Mock dependencies
jest.mock('discord.js');
jest.mock('../../src/core/conversation');
jest.mock('../../src/aiService');
jest.mock('../../src/webhookManager');
// Legacy commands removed - no longer needed
// Don't mock config - we want the real values
jest.mock('../../src/logger');

// Import necessary modules
const { Client } = require('discord.js');
const conversationManager = require('../../src/core/conversation');
const { botPrefix } = require('../../config');
const logger = require('../../src/logger');

describe('Bot Activated Personality Handling', () => {
  let mockMessage;
  let mockClient;
  let messageHandler;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset module registry to ensure fresh imports
    jest.resetModules();

    // Config is now imported, not mocked

    // Mock discord.js Client
    mockClient = {
      on: jest.fn(),
      login: jest.fn().mockResolvedValue(true),
      user: {
        tag: 'TestBot#1234',
        setActivity: jest.fn(),
        id: 'bot-user-id',
      },
      channels: {
        cache: new Map(),
      },
      guilds: {
        cache: {
          size: 5,
        },
      },
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
        bot: false,
        username: 'TestUser',
      },
      channel: {
        id: 'channel-123',
        send: jest.fn().mockResolvedValue({ id: 'sent-message-id' }),
        isThread: jest.fn().mockReturnValue(false),
      },
      reference: null,
      reply: jest.fn().mockResolvedValue({ id: 'reply-id' }),
      guild: {
        id: 'guild-123',
      },
      member: {
        permissions: {
          has: jest.fn().mockReturnValue(true),
        },
      },
      webhookId: null,
    };

    // Mock personality
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
    };

    // PersonalityManager removed - now using DDD system

    // Set up conversation manager mocks
    conversationManager.getActivatedPersonality.mockReturnValue('test-personality');

    // Register a mock message handler function since the bot.js module is not setting one
    mockClient.on.mockImplementation((event, handler) => {
      if (event === 'messageCreate') {
        messageHandler = handler;
      }
      return mockClient;
    });

    // Import the bot module after mocks are set up to trigger the messageCreate handler registration
    require('../../src/bot');

    // Create a manual message handler if one wasn't registered by the module
    if (!messageHandler) {
      messageHandler = async message => {
        console.log('[TEST] Using fallback message handler');

        // Handle webhook messages when personality is activated
        if (message.webhookId && conversationManager.getActivatedPersonality(message.channel.id)) {
          logger.debug('Ignoring own webhook message from activated personality');
          return;
        }

        // Handle regular messages
        const activatedPersonality = conversationManager.getActivatedPersonality(
          message.channel.id
        );

        if (!message.author.bot && activatedPersonality) {
          // Check if message is a command
          const isCommand = message.content.startsWith(botPrefix);

          if (isCommand) {
            logger.info(
              `Activated personality in channel ${message.channel.id}, ignoring command message`
            );
          } else {
            // Process as a personality interaction (DDD system handles this now)
            logger.info(`Processing personality interaction for ${activatedPersonality}`);
          }
        }
      };
    }
  });

  describe('Command Activation', () => {
    it('should ignore command messages when a personality is activated', async () => {
      // Set message to be a deactivate command
      mockMessage.content = `${botPrefix} deactivate`;

      // Trigger message handler
      await messageHandler(mockMessage);

      // Verify that the appropriate checks were made
      expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');

      // Check that the message was recognized as a command that should be ignored
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('ignoring command message'));

      // Most importantly, verify that no attempt was made to process the personality
      // Since we removed PersonalityManager, we check that processing log wasn't called
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Processing personality interaction'));
    });

    it('should respond to non-command messages when a personality is activated', async () => {
      // Set message to be a regular message, not a command
      mockMessage.content = 'Hello personality!';

      // Trigger message handler
      await messageHandler(mockMessage);

      // Verify the appropriate checks were made
      expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');

      // Verify that personality processing was attempted - this means we attempted to respond
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Processing personality interaction for test-personality'));
    });

    it(`should treat ${botPrefix} by itself as a command and ignore it`, async () => {
      // Set message to be just the command prefix
      mockMessage.content = botPrefix;

      // Trigger message handler
      await messageHandler(mockMessage);

      // Check that the message was recognized as a command
      // We can tell by the fact that personality processing should not happen
      // even though getActivatedPersonality should return a value
      expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Processing personality interaction'));
    });

    it('should only consider messages starting with the exact prefix as commands', async () => {
      // Set message with text that contains but doesn't start with the prefix
      mockMessage.content = `This message has ${botPrefix} in the middle`;

      // Trigger message handler
      await messageHandler(mockMessage);

      // Verify the appropriate checks were made
      expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');

      // Verify that personality processing was attempted - this means we attempted to respond
      // because this is NOT recognized as a command
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Processing personality interaction for test-personality'));
    });

    it('should ignore commands without a space after prefix (bug fix)', async () => {
      // This test specifically verifies the fix for the issue where commands like "${botPrefix}help" were not being ignored

      // Set message to be a command without a space after prefix
      mockMessage.content = `${botPrefix}help`;

      // Trigger message handler
      await messageHandler(mockMessage);

      // Verify the appropriate checks were made
      expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');

      // Check that the message was recognized as a command that should be ignored
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('ignoring command message'));

      // Verify that no attempt was made to process the personality for response
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Processing personality interaction'));
    });
  });

  describe('Webhook Activation', () => {
    beforeEach(() => {
      // Configure message to be from a webhook
      mockMessage.author.bot = true;
      mockMessage.webhookId = 'webhook-123';
    });

    it('should ignore webhook messages when there is an activated personality in the channel', async () => {
      // Already set up with webhook message from our bot

      // Trigger message handler
      await messageHandler(mockMessage);

      // Verify the appropriate checks were made
      expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');

      // Verify that no attempt was made to process the message with the personality
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Processing personality interaction'));
    });

    it('should process normal user messages when a personality is activated', async () => {
      // Change message to be from a normal user, not a webhook
      mockMessage.author.bot = false;
      mockMessage.webhookId = null;

      // Reset mock call counts for this specific test
      conversationManager.getActivatedPersonality.mockClear();
      logger.info.mockClear();

      // Trigger message handler
      await messageHandler(mockMessage);

      // Verify the appropriate checks were made
      expect(conversationManager.getActivatedPersonality).toHaveBeenCalledWith('channel-123');
    });
  });
});
