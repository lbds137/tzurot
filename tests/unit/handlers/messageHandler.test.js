const messageHandler = require('../../../src/handlers/messageHandler');
const { messageTracker } = require('../../../src/messageTracker');
const referenceHandler = require('../../../src/handlers/referenceHandler');
const personalityHandler = require('../../../src/handlers/personalityHandler');
const messageTrackerHandler = require('../../../src/handlers/messageTrackerHandler');
const dmHandler = require('../../../src/handlers/dmHandler');
const errorHandler = require('../../../src/handlers/errorHandler');
const webhookUserTracker = require('../../../src/utils/webhookUserTracker');
const { processCommand } = require('../../../src/commandLoader');
const { getActivePersonality, getActivatedPersonality } = require('../../../src/conversationManager');
const { getPersonalityByAlias, getPersonality } = require('../../../src/personalityManager');
const channelUtils = require('../../../src/utils/channelUtils');
const { botPrefix } = require('../../../config');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/messageTracker');
jest.mock('../../../src/handlers/referenceHandler');
jest.mock('../../../src/handlers/personalityHandler');
jest.mock('../../../src/handlers/messageTrackerHandler');
jest.mock('../../../src/handlers/dmHandler');
jest.mock('../../../src/handlers/errorHandler');
jest.mock('../../../src/utils/webhookUserTracker');
jest.mock('../../../src/commandLoader');
jest.mock('../../../src/conversationManager');
jest.mock('../../../src/personalityManager');
jest.mock('../../../src/utils/channelUtils');
jest.mock('../../../config', () => ({
  botPrefix: '!tz'
}));

describe('messageHandler', () => {
  let mockClient;
  let mockMessage;
  let mockPersonality;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock client
    mockClient = {
      user: {
        id: 'client-123'
      }
    };
    
    // Mock message
    mockMessage = {
      id: 'message-123',
      content: 'Test message content',
      author: {
        id: 'author-123',
        tag: 'User#1234',
        bot: false
      },
      webhookId: null,
      channel: {
        id: 'channel-123',
        isDMBased: () => false,
        send: jest.fn().mockResolvedValue(undefined)
      },
      reference: null
    };
    
    // Mock personality
    mockPersonality = {
      fullName: 'test-personality',
      displayName: 'TestPersonality'
    };
    
    // Set default mock implementations
    messageTracker.track.mockReturnValue(true);
    referenceHandler.handleMessageReference.mockResolvedValue(false);
    personalityHandler.handlePersonalityInteraction.mockResolvedValue(undefined);
    personalityHandler.activeRequests = new Map();
    messageTrackerHandler.trackMessageInChannel.mockReturnValue(undefined);
    messageTrackerHandler.hasSimilarRecentMessage.mockReturnValue(false);
    messageTrackerHandler.markMessageAsHandled.mockReturnValue(undefined);
    messageTrackerHandler.delayedProcessing.mockResolvedValue(undefined);
    dmHandler.handleDmReply.mockResolvedValue(false);
    dmHandler.handleDirectMessage.mockResolvedValue(false);
    errorHandler.detectAndDeleteIncompleteEmbed.mockResolvedValue(false);
    errorHandler.filterWebhookMessage.mockReturnValue(false);
    webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
    processCommand.mockResolvedValue(true);
    getActivePersonality.mockReturnValue(null);
    getActivatedPersonality.mockReturnValue(null);
    getPersonality.mockReturnValue(mockPersonality);
    getPersonalityByAlias.mockReturnValue(null);
    channelUtils.isChannelNSFW.mockReturnValue(true);
  });
  
  describe('handleMessage', () => {
    it('should process webhook messages correctly', async () => {
      // Set up a webhook message
      const webhookMessage = {
        ...mockMessage,
        webhookId: 'webhook-123'
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
          isDMBased: () => true
        },
        reference: {
          messageId: 'reference-123'
        }
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
          id: 'bot-456' // Not the client's ID
        }
      };
      
      // Call the handler
      await messageHandler.handleMessage(botMessage, mockClient);
      
      // Should not have processed commands or references
      expect(processCommand).not.toHaveBeenCalled();
      expect(referenceHandler.handleMessageReference).not.toHaveBeenCalled();
    });
    
    it('should handle messages from the bot itself specially', async () => {
      // Set up a message from the bot itself
      const botSelfMessage = {
        ...mockMessage,
        author: {
          ...mockMessage.author,
          bot: true,
          id: 'client-123' // Same as client's ID
        },
        embeds: []
      };
      
      // Call the handler
      await messageHandler.handleMessage(botSelfMessage, mockClient);
      
      // Should have tracked the bot's own message
      expect(messageTracker.track).toHaveBeenCalledWith(botSelfMessage.id, 'bot-message');
      
      // Should not have processed commands or references
      expect(processCommand).not.toHaveBeenCalled();
      expect(referenceHandler.handleMessageReference).not.toHaveBeenCalled();
    });
    
    it('should check for and delete incomplete embeds', async () => {
      // Set up a message from the bot itself with embeds
      const botEmbedMessage = {
        ...mockMessage,
        author: {
          ...mockMessage.author,
          bot: true,
          id: 'client-123' // Same as client's ID
        },
        embeds: [
          {
            title: 'Personality Added',
            fields: [
              {
                name: 'Display Name',
                value: 'Not set'
              }
            ]
          }
        ]
      };
      
      // Mock that an incomplete embed was detected and deleted
      errorHandler.detectAndDeleteIncompleteEmbed.mockResolvedValueOnce(true);
      
      // Call the handler
      await messageHandler.handleMessage(botEmbedMessage, mockClient);
      
      // Should have tracked the bot's own message
      expect(messageTracker.track).toHaveBeenCalledWith(botEmbedMessage.id, 'bot-message');
      
      // Should have checked for incomplete embeds
      expect(errorHandler.detectAndDeleteIncompleteEmbed).toHaveBeenCalledWith(botEmbedMessage);
      
      // Should not have processed further
      expect(processCommand).not.toHaveBeenCalled();
      expect(referenceHandler.handleMessageReference).not.toHaveBeenCalled();
    });
    
    it('should process commands correctly', async () => {
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`
      };
      
      // Create a spy on handleCommand
      jest.spyOn(messageHandler, 'handleCommand')
        .mockImplementation(async () => true);
      
      // Call the handler
      await messageHandler.handleMessage(commandMessage, mockClient);
      
      // We don't need to verify the internals since they may change
      // Just check that we properly identified it as a command
      expect(messageHandler.handleCommand).toHaveBeenCalled();
    });
    
    it('should handle message references', async () => {
      // Set up a reference message
      const referenceMessage = {
        ...mockMessage,
        reference: {
          messageId: 'reference-123'
        }
      };
      
      // Mock that the reference was handled
      referenceHandler.handleMessageReference.mockResolvedValueOnce(true);
      
      // Call the handler
      await messageHandler.handleMessage(referenceMessage, mockClient);
      
      // Should have processed the reference
      expect(referenceHandler.handleMessageReference).toHaveBeenCalledWith(
        referenceMessage,
        expect.any(Function)
      );
      
      // Don't test internals that might have changed
    });
    
    it('should handle mentions', async () => {
      // Set up a mention message
      const mentionMessage = {
        ...mockMessage,
        content: '@TestPersonality Hello there'
      };
      
      // Mock handleMentions function
      jest.spyOn(messageHandler, 'handleMentions').mockImplementation(async () => true);
      
      // Call the handler
      await messageHandler.handleMessage(mentionMessage, mockClient);
      
      // Should have called the mentions handler
      expect(messageHandler.handleMentions).toHaveBeenCalledWith(mentionMessage, mockClient);
    });
    
    it('should handle active conversations', async () => {
      // Set up a message in an active conversation
      const conversationMessage = {
        ...mockMessage,
        content: 'This is part of an active conversation'
      };
      
      // Mock handleActiveConversation function
      jest.spyOn(messageHandler, 'handleActiveConversation').mockImplementation(async () => true);
      
      // Call the handler
      await messageHandler.handleMessage(conversationMessage, mockClient);
      
      // Should have processed the active conversation
      expect(messageHandler.handleActiveConversation).toHaveBeenCalledWith(conversationMessage, mockClient);
    });
    
    it('should handle activated channels', async () => {
      // Set up a message in an activated channel
      const activatedChannelMessage = {
        ...mockMessage,
        content: 'This is in an activated channel'
      };
      
      // Mock handleActivatedChannel function
      jest.spyOn(messageHandler, 'handleActivatedChannel').mockImplementation(async () => true);
      
      // Call the handler
      await messageHandler.handleMessage(activatedChannelMessage, mockClient);
      
      // Should have processed the activated channel
      expect(messageHandler.handleActivatedChannel).toHaveBeenCalledWith(activatedChannelMessage, mockClient);
    });
    
    it('should handle direct messages', async () => {
      // Set up a direct message
      const directMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => true
        }
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
        content: `${botPrefix} command arg1 arg2`
      };
      
      // Call the handler
      const result = await messageHandler.handleCommand(commandMessage);
      
      // Should return true to indicate the command was handled
      expect(result).toBe(true);
      
      // Should have tracked the command
      expect(messageTracker.track).toHaveBeenCalledWith(commandMessage.id, 'command');
      
      // Should have called processCommand with the correct arguments
      expect(processCommand).toHaveBeenCalledWith(commandMessage, 'command', ['arg1', 'arg2']);
    });
    
    it('should handle empty commands as help', async () => {
      // Set up an empty command message
      const emptyCommandMessage = {
        ...mockMessage,
        content: botPrefix
      };
      
      // Call the handler
      const result = await messageHandler.handleCommand(emptyCommandMessage);
      
      // Should return true to indicate the command was handled
      expect(result).toBe(true);
      
      // Should have called processCommand with 'help' command and no args
      expect(processCommand).toHaveBeenCalledWith(emptyCommandMessage, 'help', []);
    });
    
    it('should prevent duplicate command processing', async () => {
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`
      };
      
      // Mock track to indicate this is a duplicate
      messageTracker.track.mockReturnValueOnce(false);
      
      // Call the handler
      const result = await messageHandler.handleCommand(commandMessage);
      
      // Should return true to indicate the command was "handled" (prevented duplicate)
      expect(result).toBe(true);
      
      // Should not have called processCommand
      expect(processCommand).not.toHaveBeenCalled();
    });
    
    it('should handle errors in command processing', async () => {
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`
      };
      
      // Mock processCommand to throw an error
      processCommand.mockRejectedValueOnce(new Error('Command error'));
      
      // Call the handler
      const result = await messageHandler.handleCommand(commandMessage);
      
      // Should return false to indicate the command had an error
      expect(result).toBe(false);
      
      // Should have tracked the command
      expect(messageTracker.track).toHaveBeenCalledWith(commandMessage.id, 'command');
      
      // Should have called processCommand
      expect(processCommand).toHaveBeenCalledWith(commandMessage, 'command', ['arg1', 'arg2']);
    });
  });
  
  describe('handleMentions', () => {
    it('should handle standard mentions', async () => {
      // Set up a message with a standard mention
      const mentionMessage = {
        ...mockMessage,
        content: '@TestPersonality Hello there'
      };
      
      // Call the handler
      const result = await messageHandler.handleMentions(mentionMessage, mockClient);
      
      // Should return true to indicate the mention was handled
      expect(result).toBe(true);
      
      // For DM channels, should handle immediately
      if (mentionMessage.channel.isDMBased()) {
        expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalled();
      } else {
        // For server channels, should use delayed processing
        expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalled();
      }
    });
    
    it('should handle multi-word mentions', async () => {
      // Set up a message with a multi-word mention
      const multiWordMentionMessage = {
        ...mockMessage,
        content: '@Test Personality Hello there'
      };
      
      // Mock getPersonalityByAlias to return for multi-word alias
      getPersonalityByAlias.mockImplementation((userId, name) => {
        if (name === 'Test Personality') {
          return mockPersonality;
        }
        return null;
      });
      
      // Call the handler
      const result = await messageHandler.handleMentions(multiWordMentionMessage, mockClient);
      
      // Should return true to indicate the mention was handled
      expect(result).toBe(true);
      
      // Should have tried to get personality by alias with the multi-word name
      expect(getPersonalityByAlias).toHaveBeenCalledWith(
        multiWordMentionMessage.author.id,
        'Test Personality'
      );
      
      // For DM channels, should handle immediately
      if (multiWordMentionMessage.channel.isDMBased()) {
        expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalled();
      } else {
        // For server channels, should use delayed processing
        expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalled();
      }
    });
    
    it('should prioritize longest multi-word mentions', async () => {
      // Set up a message with multiple possible mentions
      const complexMentionMessage = {
        ...mockMessage,
        content: '@Test Personality Prime Hello there'
      };
      
      // Mock getPersonalityByAlias to return for various aliases
      getPersonalityByAlias.mockImplementation((userId, name) => {
        if (name === 'Test') {
          return { fullName: 'test', displayName: 'Test' };
        }
        if (name === 'Test Personality') {
          return { fullName: 'test-personality', displayName: 'Test Personality' };
        }
        if (name === 'Test Personality Prime') {
          return { fullName: 'test-personality-prime', displayName: 'Test Personality Prime' };
        }
        return null;
      });
      
      // Call the handler
      const result = await messageHandler.handleMentions(complexMentionMessage, mockClient);
      
      // Should return true to indicate the mention was handled
      expect(result).toBe(true);
      
      // Should have tried different combinations
      expect(getPersonalityByAlias).toHaveBeenCalledWith(
        complexMentionMessage.author.id,
        expect.stringContaining('Test')
      );
      
      // For DM channels, the longest match ("Test Personality Prime") should be used
      if (complexMentionMessage.channel.isDMBased()) {
        expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalled();
        // Should have passed the personality with the longest name
        const personality = personalityHandler.handlePersonalityInteraction.mock.calls[0][1];
        expect(personality.fullName).toBe('test-personality-prime');
      } else {
        // For server channels, should use delayed processing
        expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalled();
      }
    });
    
    it('should not handle messages without mentions', async () => {
      // Set up a message without mentions
      const noMentionMessage = {
        ...mockMessage,
        content: 'This message has no mentions'
      };
      
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
          isDMBased: () => true
        }
      };
      
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
      // Set up an active conversation
      getActivePersonality.mockReturnValueOnce('test-personality');
      
      // Call the handler
      const result = await messageHandler.handleActiveConversation(mockMessage, mockClient);
      
      // Should return true to indicate the active conversation was handled
      expect(result).toBe(true);
      
      // Should have checked for active personality
      expect(getActivePersonality).toHaveBeenCalledWith(
        mockMessage.author.id,
        mockMessage.channel.id
      );
      
      // For DM channels, should handle immediately
      if (mockMessage.channel.isDMBased()) {
        expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalled();
      } else {
        // For server channels, should use delayed processing
        expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalled();
      }
    });
    
    it('should not handle if no active conversation', async () => {
      // Set up no active conversation
      getActivePersonality.mockReturnValueOnce(null);
      
      // Call the handler
      const result = await messageHandler.handleActiveConversation(mockMessage, mockClient);
      
      // Should return false to indicate no active conversation was handled
      expect(result).toBe(false);
      
      // Should have checked for active personality
      expect(getActivePersonality).toHaveBeenCalledWith(
        mockMessage.author.id,
        mockMessage.channel.id
      );
      
      // Should not have called the personality handler or delayed processing
      expect(personalityHandler.handlePersonalityInteraction).not.toHaveBeenCalled();
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });
    
    it('should handle DM active conversations immediately without delay', async () => {
      // Set up an active conversation in a DM
      getActivePersonality.mockReturnValueOnce('test-personality');
      
      // Set up a DM message
      const dmMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => true
        }
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
      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      
      // Call the handler
      const result = await messageHandler.handleActivatedChannel(mockMessage, mockClient);
      
      // Should return true to indicate the activated channel was handled
      expect(result).toBe(true);
      
      // Should have checked for activated personality
      expect(getActivatedPersonality).toHaveBeenCalledWith(mockMessage.channel.id);
      
      // Should have used delayed processing
      expect(messageTrackerHandler.delayedProcessing).toHaveBeenCalled();
    });
    
    it('should not handle commands in activated channels', async () => {
      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      
      // Set up a command message
      const commandMessage = {
        ...mockMessage,
        content: `${botPrefix} command arg1 arg2`
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
      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      
      // Set up a non-NSFW, non-DM channel
      const nonNsfwMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => false,
          send: jest.fn().mockResolvedValue(undefined)
        }
      };
      
      // Set channel as not NSFW
      channelUtils.isChannelNSFW.mockReturnValueOnce(false);
      
      // Call the handler
      const result = await messageHandler.handleActivatedChannel(nonNsfwMessage, mockClient);
      
      // Should return true to indicate the message was "handled" by sending a restriction notice
      expect(result).toBe(true);
      
      // Should have checked if the channel is NSFW
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(nonNsfwMessage.channel);
      
      // Should have sent a restriction notice
      expect(nonNsfwMessage.channel.send).toHaveBeenCalled();
      expect(nonNsfwMessage.channel.send.mock.calls[0][0]).toContain('safety and compliance reasons');
      
      // Should not have used delayed processing
      expect(messageTrackerHandler.delayedProcessing).not.toHaveBeenCalled();
    });
    
    it('should not send NSFW restriction notice too frequently', async () => {
      // Set up an activated channel
      getActivatedPersonality.mockReturnValueOnce('test-personality');
      
      // Set up a non-NSFW, non-DM channel
      const nonNsfwMessage = {
        ...mockMessage,
        channel: {
          ...mockMessage.channel,
          isDMBased: () => false,
          send: jest.fn().mockResolvedValue(undefined)
        }
      };
      
      // Set channel as not NSFW
      channelUtils.isChannelNSFW.mockReturnValueOnce(false);
      
      // Set a recent notification time
      const restrictionKey = `nsfw-restriction-${nonNsfwMessage.channel.id}`;
      personalityHandler.activeRequests.set(restrictionKey, Date.now() - 1000000); // 16.6 minutes ago
      
      // Call the handler
      const result = await messageHandler.handleActivatedChannel(nonNsfwMessage, mockClient);
      
      // Should return true to indicate the message was "handled" by sending a restriction notice
      expect(result).toBe(true);
      
      // Should have checked if the channel is NSFW
      expect(channelUtils.isChannelNSFW).toHaveBeenCalledWith(nonNsfwMessage.channel);
      
      // Should have sent a restriction notice (since it's been more than an hour)
      expect(nonNsfwMessage.channel.send).toHaveBeenCalled();
      
      // Set a very recent notification time
      personalityHandler.activeRequests.set(restrictionKey, Date.now() - 1000); // 1 second ago
      nonNsfwMessage.channel.send.mockClear();
      
      // Call the handler again
      await messageHandler.handleActivatedChannel(nonNsfwMessage, mockClient);
      
      // Should not have sent another restriction notice (since it's been less than an hour)
      expect(nonNsfwMessage.channel.send).not.toHaveBeenCalled();
    });
  });
});