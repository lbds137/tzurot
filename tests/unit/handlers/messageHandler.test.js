// First, mock all dependencies
jest.mock('../../../src/logger');
jest.mock('../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    mentionChar: '@',
    isDevelopment: false,
  },
}));
jest.mock('../../../src/messageTracker');
jest.mock('../../../src/handlers/referenceHandler');
jest.mock('../../../src/handlers/personalityHandler');
jest.mock('../../../src/handlers/messageTrackerHandler');
jest.mock('../../../src/handlers/dmHandler');
jest.mock('../../../src/utils/webhookUserTracker');
jest.mock('../../../src/core/conversation');
jest.mock('../../../src/utils/channelUtils');
jest.mock('../../../src/utils/pluralkitMessageStore', () => ({
  instance: {
    store: jest.fn(),
  },
}));
jest.mock('../../../src/adapters/CommandIntegrationAdapter');
jest.mock('../../../src/application/services/FeatureFlags');
jest.mock('../../../src/utils/aliasResolver');
jest.mock('../../../src/config/MessageHandlerConfig');
// Import config to get the actual bot prefix
const { botPrefix } = require('../../../config');

// IMPORTANT: Import the messageHandler module AFTER mocking all its dependencies
const messageHandler = require('../../../src/handlers/messageHandler');
const { messageTracker } = require('../../../src/messageTracker');
const referenceHandler = require('../../../src/handlers/referenceHandler');
const personalityHandler = require('../../../src/handlers/personalityHandler');
const messageTrackerHandler = require('../../../src/handlers/messageTrackerHandler');
const dmHandler = require('../../../src/handlers/dmHandler');
const webhookUserTracker = require('../../../src/utils/webhookUserTracker');
const {
  getActivePersonality,
  getActivatedPersonality,
  isAutoResponseEnabled,
} = require('../../../src/core/conversation');
const channelUtils = require('../../../src/utils/channelUtils');
const pluralkitMessageStore = require('../../../src/utils/pluralkitMessageStore');
const { getCommandIntegrationAdapter } = require('../../../src/adapters/CommandIntegrationAdapter');
const { createFeatureFlags } = require('../../../src/application/services/FeatureFlags');
const { resolvePersonality } = require('../../../src/utils/aliasResolver');
const messageHandlerConfig = require('../../../src/config/MessageHandlerConfig');

describe('messageHandler', () => {
  let mockClient;
  let mockMessage;
  let mockPersonality;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Configure messageTrackerHandler to disable cleanup for tests
    messageTrackerHandler.createMessageTrackerHandler({ enableCleanup: false });

    // Mock client
    mockClient = {
      user: {
        id: 'client-123',
      },
    };

    // Mock message
    mockMessage = {
      id: 'message-123',
      content: 'Test message content',
      author: {
        id: 'author-123',
        tag: 'User#1234',
        username: 'User',
        bot: false,
      },
      webhookId: null,
      channel: {
        id: 'channel-123',
        isDMBased: () => false,
        send: jest.fn().mockResolvedValue(undefined),
      },
      reference: null,
      reply: jest.fn().mockResolvedValue(undefined),
    };

    // Mock personality
    mockPersonality = {
      fullName: 'test-personality',
      displayName: 'TestPersonality',
    };


    // Set default mock implementations
    messageTracker.track.mockReturnValue(true);
    referenceHandler.handleMessageReference.mockResolvedValue({ processed: false });
    personalityHandler.handlePersonalityInteraction.mockResolvedValue(undefined);
    personalityHandler.activeRequests = new Map();
    messageTrackerHandler.trackMessageInChannel.mockReturnValue(undefined);
    messageTrackerHandler.hasSimilarRecentMessage.mockReturnValue(false);
    messageTrackerHandler.markMessageAsHandled.mockReturnValue(undefined);
    messageTrackerHandler.delayedProcessing.mockResolvedValue(undefined);
    dmHandler.handleDmReply.mockResolvedValue(false);
    dmHandler.handleDirectMessage.mockResolvedValue(false);
    webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
    getActivePersonality.mockReturnValue(null);
    getActivatedPersonality.mockReturnValue(null);
    isAutoResponseEnabled.mockReturnValue(undefined);
    resolvePersonality.mockResolvedValue(null); // Default to no personality found
    channelUtils.isChannelNSFW.mockReturnValue(true);
    
    // Mock message handler config
    messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(5); // Default to 5 words

    // Mock feature flags - DDD commands are always enabled now
    createFeatureFlags.mockReturnValue({
      isEnabled: jest.fn().mockReturnValue(true),
    });

    // Mock command integration adapter
    getCommandIntegrationAdapter.mockReturnValue({
      processCommand: jest.fn().mockResolvedValue({ success: true }),
    });

    // Command integration adapter is already mocked above
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('handleMessage', () => {
    it('should process webhook messages correctly', async () => {
      // Set up a webhook message
      const webhookMessage = {
        ...mockMessage,
        webhookId: 'webhook-123',
      };

      // Call the handler
      await messageHandler.handleMessage(webhookMessage, mockClient);

      // Should have checked if it's a proxy system webhook
      expect(webhookUserTracker.isProxySystemWebhook).toHaveBeenCalledWith(webhookMessage);

      // Should have tracked the message in the channel
      expect(messageTrackerHandler.trackMessageInChannel).toHaveBeenCalledWith(webhookMessage);
    });

    it('should handle DM replies', async () => {
      // Set up a DM reply message
      const dmReplyMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => true,
        },
        reference: {
          messageId: 'reference-123',
        },
      };

      // Mock DM reply handler to indicate it handled the message
      dmHandler.handleDmReply.mockResolvedValueOnce(true);

      // Call the handler
      await messageHandler.handleMessage(dmReplyMessage, mockClient);

      // Should have called the DM reply handler
      expect(dmHandler.handleDmReply).toHaveBeenCalledWith(dmReplyMessage, mockClient);

      // Should not have processed further
      expect(referenceHandler.handleMessageReference).not.toHaveBeenCalled();
    });

    it('should filter messages from bots', async () => {
      // Set up a bot message
      const botMessage = {
        ...mockMessage,
        author: {
          ...mockMessage.author,
          bot: true,
          id: 'bot-456', // Not the client's ID
        },
      };

      // Call the handler
      await messageHandler.handleMessage(botMessage, mockClient);

      // Should not have processed commands or references
      expect(getCommandIntegrationAdapter().processCommand).not.toHaveBeenCalled();
      expect(referenceHandler.handleMessageReference).not.toHaveBeenCalled();
    });

    it('should handle messages from the bot itself specially', async () => {
      // Set up a message from the bot itself
      const botSelfMessage = {
        ...mockMessage,
        author: {
          ...mockMessage.author,
          bot: true,
          id: 'client-123', // Same as client's ID
        },
        embeds: [],
      };

      // Call the handler
      await messageHandler.handleMessage(botSelfMessage, mockClient);

      // Should have tracked the bot's own message
      expect(messageTracker.track).toHaveBeenCalledWith(botSelfMessage.id, 'bot-message');

      // Should not have processed commands or references
      expect(getCommandIntegrationAdapter().processCommand).not.toHaveBeenCalled();
      expect(referenceHandler.handleMessageReference).not.toHaveBeenCalled();
    });

    it('should process commands correctly', async () => {
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`,
      };

      // Setup mocks
      getCommandIntegrationAdapter().processCommand.mockResolvedValueOnce({ success: true });
      messageTracker.track.mockReturnValueOnce(true);

      // Call the handler directly
      await messageHandler.handleMessage(commandMessage, mockClient);

      // Verify that processCommand was called with the expected arguments
      // This indirectly verifies that handleCommand was called internally
      expect(getCommandIntegrationAdapter().processCommand).toHaveBeenCalledWith(commandMessage, 'command', ['arg1', 'arg2']);
    });

    it('should handle message references', async () => {
      // Set up a reference message
      const referenceMessage = {
        ...mockMessage,
        reference: {
          messageId: 'reference-123',
        },
      };

      // Mock that the reference was handled
      referenceHandler.handleMessageReference.mockResolvedValueOnce(true);

      // Call the handler
      await messageHandler.handleMessage(referenceMessage, mockClient);

      // Should have processed the reference
      expect(referenceHandler.handleMessageReference).toHaveBeenCalledWith(
        referenceMessage,
        expect.any(Function),
        mockClient
      );

      // Don't test internals that might have changed
    });

    it('should handle mentions', async () => {
      // Set up a mention message
      const mentionMessage = {
        ...mockMessage,
        content: '@TestPersonality Hello there',
      };

      // Reset and setup mocks
      jest.clearAllMocks();
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);

      // Make sure the other handlers return false to get to mentions
      referenceHandler.handleMessageReference.mockResolvedValueOnce({ processed: false });

      // Call the handler
      await messageHandler.handleMessage(mentionMessage, mockClient);

      // Verify that the personality was looked up
      expect(resolvePersonality).toHaveBeenCalledWith('TestPersonality');

      // Verify that delayedProcessing was called with the right arguments
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        mentionMessage,
        mockPersonality,
        'TestPersonality',
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should handle active conversations', async () => {
      // Set up a message in an active conversation
      const conversationMessage = {
        ...mockMessage,
        content: 'This is part of an active conversation',
      };

      // Reset and setup mocks
      jest.clearAllMocks();
      getActivePersonality.mockReturnValueOnce('test-personality');
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);

      // Make sure handlers before this one return false
      referenceHandler.handleMessageReference.mockResolvedValueOnce(false);

      // Mock handleMentions internal function to return false so we get to handleActiveConversation
      // This is done by setting up the test environment so no mentions are found
      resolvePersonality.mockResolvedValue(null);

      // Call the handler
      await messageHandler.handleMessage(conversationMessage, mockClient);

      // Verify that active personality was checked
      expect(getActivePersonality).toHaveBeenCalledWith(
        conversationMessage.author.id,
        conversationMessage.channel.id,
        false, // isDM
        undefined // autoResponseEnabled (from isAutoResponseEnabled mock)
      );

      // Verify that delayedProcessing was called with the right arguments
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        conversationMessage,
        mockPersonality,
        null,
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should handle activated channels', async () => {
      // Set up a message in an activated channel
      const activatedChannelMessage = {
        ...mockMessage,
        content: 'This is in an activated channel',
      };

      // Reset and setup mocks
      jest.clearAllMocks();

      // Set up the test to get to the activated channel handler
      // Returns for previous handlers
      referenceHandler.handleMessageReference.mockResolvedValueOnce(false);
      resolvePersonality.mockResolvedValue(null); // No mention matches
      getActivePersonality.mockReturnValueOnce(null); // No active conversation

      // Setup for activated channel handling
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      channelUtils.isChannelNSFW.mockReturnValueOnce(true); // NSFW channel
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);

      // Call the handler
      await messageHandler.handleMessage(activatedChannelMessage, mockClient);

      // Verify that activated personality was checked
      expect(getActivatedPersonality).toHaveBeenCalledWith(activatedChannelMessage.channel.id);

      // Verify that delayedProcessing was called with the right arguments
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        activatedChannelMessage,
        mockPersonality,
        null,
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should handle direct messages', async () => {
      // Set up a direct message
      const directMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => true,
        },
      };

      // Call the handler
      await messageHandler.handleMessage(directMessage, mockClient);

      // Should have processed the direct message
      expect(dmHandler.handleDirectMessage).toHaveBeenCalledWith(directMessage, mockClient);
    });
  });

  describe('handleCommand', () => {
    it('should process valid commands', async () => {
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`,
      };

      // Make sure processCommand returns true for this test
      getCommandIntegrationAdapter().processCommand.mockResolvedValueOnce({ success: true });

      // Call the handler
      const result = await messageHandler.handleCommand(commandMessage);

      // Should return true to indicate the command was handled
      expect(result).toBe(true);

      // Should have tracked the command
      expect(messageTracker.track).toHaveBeenCalledWith(commandMessage.id, 'command');

      // Should have called processCommand with the correct arguments
      expect(getCommandIntegrationAdapter().processCommand).toHaveBeenCalledWith(commandMessage, 'command', ['arg1', 'arg2']);
    });

    it('should handle empty commands as help', async () => {
      // Set up an empty command message
      const emptyCommandMessage = {
        ...mockMessage,
        content: botPrefix,
      };

      // Make sure processCommand returns true for this test
      getCommandIntegrationAdapter().processCommand.mockResolvedValueOnce({ success: true });

      // Call the handler
      const result = await messageHandler.handleCommand(emptyCommandMessage);

      // Should return true to indicate the command was handled
      expect(result).toBe(true);

      // Should have called processCommand with 'help' command and no args
      expect(getCommandIntegrationAdapter().processCommand).toHaveBeenCalledWith(emptyCommandMessage, 'help', []);
    });

    it('should prevent duplicate command processing', async () => {
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`,
      };

      // Mock track to indicate this is a duplicate
      messageTracker.track.mockReturnValueOnce(false);

      // Call the handler
      const result = await messageHandler.handleCommand(commandMessage);

      // Should return true to indicate the command was "handled" (prevented duplicate)
      expect(result).toBe(true);

      // Should not have called processCommand
      expect(getCommandIntegrationAdapter().processCommand).not.toHaveBeenCalled();
    });

    it('should handle errors in command processing', async () => {
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`,
      };

      // Make sure track returns true for this test
      messageTracker.track.mockReturnValueOnce(true);

      // Mock processCommand to throw an error
      getCommandIntegrationAdapter().processCommand.mockResolvedValueOnce({ 
        success: false, 
        error: 'Command error' 
      });

      // Call the handler
      const result = await messageHandler.handleCommand(commandMessage);

      // Should return true - command was handled (just with an error response)
      expect(result).toBe(true);

      // Should have tracked the command
      expect(messageTracker.track).toHaveBeenCalledWith(commandMessage.id, 'command');

      // Should have called processCommand
      expect(getCommandIntegrationAdapter().processCommand).toHaveBeenCalledWith(commandMessage, 'command', ['arg1', 'arg2']);
    });
  });

  describe('handleMentions', () => {
    it('should handle standard mentions', async () => {
      // Set up a message with a standard mention
      const mentionMessage = {
        ...mockMessage,
        content: '@TestPersonality Hello there',
      };

      // Set up mocks for this test
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);

      // Call the handler
      const result = await messageHandler.handleMentions(mentionMessage, mockClient);

      // Should return true to indicate the mention was handled
      expect(result).toBe(true);

      // For server channels (default mock), should use delayed processing
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        mentionMessage,
        mockPersonality,
        'TestPersonality',
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should handle multi-word mentions', async () => {
      // Set up a message with a multi-word mention
      const multiWordMentionMessage = {
        ...mockMessage,
        content: '@Test Personality Hello there',
      };

      // Set max word count to allow multi-word aliases
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(2);

      // Mock resolvePersonality to return for multi-word alias
      resolvePersonality.mockImplementation(async name => {
        if (name === 'Test Personality') {
          return mockPersonality;
        }
        return null;
      });

      // Set up mocks for this test
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);

      // Call the handler
      const result = await messageHandler.handleMentions(multiWordMentionMessage, mockClient);

      // Should return true to indicate the mention was handled
      expect(result).toBe(true);

      // Should have tried to resolve personality with the multi-word name
      expect(resolvePersonality).toHaveBeenCalledWith('Test Personality');

      // For server channels (default mock), should use delayed processing
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        multiWordMentionMessage,
        mockPersonality,
        'Test Personality',
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should prioritize longest multi-word mentions', async () => {
      // Set up a message with multiple possible mentions
      const complexMentionMessage = {
        ...mockMessage,
        content: '@Test Personality Prime Hello there',
      };

      // Set max word count to allow 3-word aliases
      messageHandlerConfig.getMaxAliasWordCount.mockReturnValue(3);

      // Custom personality for this test
      const testPersonalityPrime = {
        fullName: 'test-personality-prime',
        displayName: 'Test Personality Prime',
      };

      // Mock resolvePersonality to return for various aliases
      resolvePersonality.mockImplementation(async name => {
        if (name === 'Test') {
          return { fullName: 'test', displayName: 'Test' };
        }
        if (name === 'Test Personality') {
          return { fullName: 'test-personality', displayName: 'Test Personality' };
        }
        if (name === 'Test Personality Prime') {
          return testPersonalityPrime;
        }
        return null;
      });

      // Set up mocks for this test
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);

      // Call the handler
      const result = await messageHandler.handleMentions(complexMentionMessage, mockClient);

      // Should return true to indicate the mention was handled
      expect(result).toBe(true);

      // Should have tried different combinations
      expect(resolvePersonality).toHaveBeenCalledWith(expect.stringContaining('Test'));

      // For server channels, should use delayed processing with the longest match
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        complexMentionMessage,
        testPersonalityPrime,
        'Test Personality Prime',
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should not handle messages without mentions', async () => {
      // Set up a message without mentions
      const noMentionMessage = {
        ...mockMessage,
        content: 'This message has no mentions',
      };

      // Reset mocks for this test to ensure clean state
      jest.clearAllMocks();

      // Call the handler
      const result = await messageHandler.handleMentions(noMentionMessage, mockClient);

      // Should return false to indicate no mention was handled
      expect(result).toBe(false);

      // Should not have called the personality handler or delayed processing
      expect(personalityHandler.handlePersonalityInteraction).not.toHaveBeenCalled();
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });

    it('should handle DM mentions immediately without delay', async () => {
      // Set up a DM message with a mention
      const dmMentionMessage = {
        ...mockMessage,
        content: '@TestPersonality Hello there',
        channel: {
          ...mockMessage.channel,
          isDMBased: () => true,
        },
      };

      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up mocks for this test
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      personalityHandler.handlePersonalityInteraction.mockResolvedValueOnce(undefined);

      // Call the handler
      const result = await messageHandler.handleMentions(dmMentionMessage, mockClient);

      // Should return true to indicate the mention was handled
      expect(result).toBe(true);

      // Should have handled the interaction immediately
      expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalledWith(
        dmMentionMessage,
        mockPersonality,
        'TestPersonality',
        mockClient
      );

      // Should not have used delayed processing
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });
  });

  describe('handleActiveConversation', () => {
    it('should handle active conversations', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up an active conversation
      getActivePersonality.mockReturnValueOnce('test-personality');
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);

      // Call the handler
      const result = await messageHandler.handleActiveConversation(mockMessage, mockClient);

      // Should return true to indicate the active conversation was handled
      expect(result).toBe(true);

      // Should have checked for active personality
      expect(getActivePersonality).toHaveBeenCalledWith(
        mockMessage.author.id,
        mockMessage.channel.id,
        false, // isDM
        undefined // autoResponseEnabled
      );

      // For server channels (default mock), should use delayed processing
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should not handle if no active conversation', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up no active conversation
      getActivePersonality.mockReturnValueOnce(null);

      // Call the handler
      const result = await messageHandler.handleActiveConversation(mockMessage, mockClient);

      // Should return false to indicate no active conversation was handled
      expect(result).toBe(false);

      // Should have checked for active personality
      expect(getActivePersonality).toHaveBeenCalledWith(
        mockMessage.author.id,
        mockMessage.channel.id,
        false, // isDM
        undefined // autoResponseEnabled
      );

      // Should not have called the personality handler or delayed processing
      expect(personalityHandler.handlePersonalityInteraction).not.toHaveBeenCalled();
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });

    it('should handle DM active conversations immediately without delay', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up an active conversation in a DM
      getActivePersonality.mockReturnValueOnce('test-personality');
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      personalityHandler.handlePersonalityInteraction.mockResolvedValueOnce(undefined);

      // Set up a DM message
      const dmMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => true,
        },
      };

      // Call the handler
      const result = await messageHandler.handleActiveConversation(dmMessage, mockClient);

      // Should return true to indicate the active conversation was handled
      expect(result).toBe(true);

      // Should have handled the interaction immediately
      expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalledWith(
        dmMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Should not have used delayed processing
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });
  });

  describe('handleActivatedChannel', () => {
    it('should handle activated channels', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      resolvePersonality.mockResolvedValueOnce(mockPersonality);
      messageTrackerHandler.delayedProcessing.mockResolvedValueOnce(undefined);
      channelUtils.isChannelNSFW.mockReturnValueOnce(true); // Channel is NSFW

      // Call the handler
      const result = await messageHandler.handleActivatedChannel(mockMessage, mockClient);

      // Should return true to indicate the activated channel was handled
      expect(result).toBe(true);

      // Should have checked for activated personality
      expect(getActivatedPersonality).toHaveBeenCalledWith(mockMessage.channel.id);

      // Should have used delayed processing
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalledWith(
        mockMessage,
        mockPersonality,
        null,
        mockClient,
        personalityHandler.handlePersonalityInteraction
      );
    });

    it('should not handle commands in activated channels', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');

      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`,
      };

      // Call the handler
      const result = await messageHandler.handleActivatedChannel(commandMessage, mockClient);

      // Should return false to indicate no activated channel was handled
      expect(result).toBe(false);

      // Should have checked for activated personality
      expect(getActivatedPersonality).toHaveBeenCalledWith(commandMessage.channel.id);

      // Should not have used delayed processing
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });

    it('should enforce NSFW requirements for activated channels', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      resolvePersonality.mockResolvedValueOnce(mockPersonality);

      // Set up a non-NSFW, non-DM channel
      const nonNsfwMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => false,
          send: jest.fn().mockResolvedValue(undefined),
        },
      };

      // Set channel as not NSFW
      channelUtils.isChannelNSFW.mockReturnValueOnce(false);

      // Make sure the Map for tracking notifications is empty
      personalityHandler.activeRequests = new Map();

      // Call the handler
      const result = await messageHandler.handleActivatedChannel(nonNsfwMessage, mockClient);

      // Should return true to indicate the message was "handled" by sending a restriction notice
      expect(result).toBe(true);

      // Should have checked if the channel is NSFW
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(nonNsfwMessage.channel);

      // Should have sent a restriction notice
      expect(nonNsfwMessage.channel.send).toHaveBeenCalled();
      expect(nonNsfwMessage.channel.send.mock.calls[0][0]).toContain(
        'safety and compliance reasons'
      );

      // Should not have used delayed processing
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });

    it('should not send NSFW restriction notice too frequently', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      resolvePersonality.mockResolvedValueOnce(mockPersonality);

      // Set up a non-NSFW, non-DM channel
      const nonNsfwMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => false,
          send: jest.fn().mockResolvedValue(undefined),
        },
      };

      // Set channel as not NSFW
      channelUtils.isChannelNSFW.mockReturnValueOnce(false);

      // Use actual Map and mock Date.now for consistent testing
      personalityHandler.activeRequests = new Map();
      const mockTime = Date.now();
      const oldDateNow = Date.now;

      try {
        // First test: Notice should be sent (time > 1 hour ago)
        Date.now = jest.fn().mockReturnValue(mockTime);

        // Set a recent notification time
        const restrictionKey = `nsfw-restriction-${nonNsfwMessage.channel.id}`;
        personalityHandler.activeRequests.set(restrictionKey, mockTime - 3700000); // 1 hour + 100 seconds ago

        // Call the handler
        const result = await messageHandler.handleActivatedChannel(nonNsfwMessage, mockClient);

        // Should return true to indicate the message was "handled" by sending a restriction notice
        expect(result).toBe(true);

        // Should have checked if the channel is NSFW
        expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(nonNsfwMessage.channel);

        // Should have sent a restriction notice (since it's been more than an hour)
        expect(nonNsfwMessage.channel.send).toHaveBeenCalled();

        // Second test: Notice should not be sent (time < 1 hour ago)
        // First clear the send mock to check if it's called again
        nonNsfwMessage.channel.send.mockClear();
        channelUtils.isChannelNSFW.mockReturnValueOnce(false);
        getActivatedPersonality.mockReturnValueOnce('test-personality');

        // Set a very recent notification time
        personalityHandler.activeRequests.set(restrictionKey, mockTime - 1000); // 1 second ago

        // Call the handler again
        await messageHandler.handleActivatedChannel(nonNsfwMessage, mockClient);

        // Should not have sent another restriction notice (since it's been less than an hour)
        expect(nonNsfwMessage.channel.send).not.toHaveBeenCalled();
      } finally {
        // Restore original Date.now
        Date.now = oldDateNow;
      }
    });
  });

  describe('handleMessage with activated channels and replies', () => {
    it('should still process messages in activated channels when replying to other users', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // Set up an activated channel
      getActivatedPersonality.mockReturnValue('TestPersonality');
      resolvePersonality.mockResolvedValue(mockPersonality);
      channelUtils.isChannelNSFW.mockReturnValue(true);

      // Set up a reply to another user (not a personality)
      const replyMessage = {
        ...mockMessage,
        reference: { messageId: 'other-user-msg-id' },
      };

      // Mock the reference handler to indicate this is a reply to a non-personality
      referenceHandler.handleMessageReference.mockResolvedValue({
        processed: false,
        wasReplyToNonPersonality: true,
        containsMessageLinks: false,
      });

      // Make messageTrackerHandler.ensureInitialized a no-op
      messageTrackerHandler.ensureInitialized = jest.fn();

      // Process the message
      await messageHandler.handleMessage(replyMessage, mockClient);

      // Verify that despite being a reply to a non-personality,
      // the message was still processed because of the activated channel
      expect(getActivatedPersonality).toHaveBeenCalledWith(replyMessage.channel.id);
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalled();
    });

    it('should not process replies to other users when no personality is activated', async () => {
      // Reset mocks for this test
      jest.clearAllMocks();

      // No activated personality
      getActivatedPersonality.mockReturnValue(null);

      // Set up a reply to another user
      const replyMessage = {
        ...mockMessage,
        reference: { messageId: 'other-user-msg-id' },
      };

      // Mock the reference handler to indicate this is a reply to a non-personality
      referenceHandler.handleMessageReference.mockResolvedValue({
        processed: false,
        wasReplyToNonPersonality: true,
        containsMessageLinks: false,
      });

      // Make messageTrackerHandler.ensureInitialized a no-op
      messageTrackerHandler.ensureInitialized = jest.fn();

      // Process the message
      await messageHandler.handleMessage(replyMessage, mockClient);

      // Verify that the message was not processed (no personality interaction)
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });
  });

  describe('PluralKit message storage', () => {
    beforeEach(() => {
      // Reset pluralkitMessageStore mocks
      pluralkitMessageStore.instance.store = jest.fn();
    });

    it('should store user messages in pluralkitMessageStore', async () => {
      const userMessage = {
        ...mockMessage,
        author: {
          id: 'user-123',
          bot: false,
          tag: 'User#1234',
          username: 'User',
        },
        webhookId: null,
        guild: { id: 'guild-123' },
      };

      await messageHandler.handleMessage(userMessage, mockClient);

      // Verify the message was stored
      expect(pluralkitMessageStore.instance.store).toHaveBeenCalledWith('message-123', {
        userId: 'user-123',
        channelId: 'channel-123',
        content: 'Test message content',
        guildId: 'guild-123',
        username: 'User',
      });
    });

    it('should store DM messages in pluralkitMessageStore', async () => {
      const dmMessage = {
        ...mockMessage,
        author: {
          id: 'user-123',
          bot: false,
          tag: 'User#1234',
          username: 'User',
        },
        webhookId: null,
        guild: null,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => true,
        },
      };

      await messageHandler.handleMessage(dmMessage, mockClient);

      // Verify the message was stored with null guildId for DMs
      expect(pluralkitMessageStore.instance.store).toHaveBeenCalledWith('message-123', {
        userId: 'user-123',
        channelId: 'channel-123',
        content: 'Test message content',
        guildId: undefined,
        username: 'User',
      });
    });

    it('should not store bot messages in pluralkitMessageStore', async () => {
      const botMessage = {
        ...mockMessage,
        author: {
          id: 'bot-123',
          bot: true,
          tag: 'Bot#0000',
        },
        webhookId: null,
      };

      await messageHandler.handleMessage(botMessage, mockClient);

      // Verify the message was NOT stored
      expect(pluralkitMessageStore.instance.store).not.toHaveBeenCalled();
    });

    it('should not store webhook messages in pluralkitMessageStore', async () => {
      const webhookMessage = {
        ...mockMessage,
        webhookId: 'webhook-123',
        author: {
          id: 'webhook-123',
          bot: true,
          discriminator: '0000',
        },
      };

      await messageHandler.handleMessage(webhookMessage, mockClient);

      // Verify the message was NOT stored
      expect(pluralkitMessageStore.instance.store).not.toHaveBeenCalled();
    });

    it('should handle messages with missing author tag', async () => {
      const messageWithoutTag = {
        ...mockMessage,
        author: {
          id: 'user-123',
          bot: false,
          username: 'JustUsername',
          // tag is missing
        },
        webhookId: null,
        guild: { id: 'guild-123' },
      };

      await messageHandler.handleMessage(messageWithoutTag, mockClient);

      // Verify the message was stored with username instead of tag
      expect(pluralkitMessageStore.instance.store).toHaveBeenCalledWith('message-123', {
        userId: 'user-123',
        channelId: 'channel-123',
        content: 'Test message content',
        guildId: 'guild-123',
        username: 'JustUsername',
      });
    });
  });
});
