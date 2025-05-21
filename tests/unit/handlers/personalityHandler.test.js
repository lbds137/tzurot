/**
 * Tests for the personality handler module
 */

const personalityHandler = require('../../../src/handlers/personalityHandler');
const logger = require('../../../src/logger');
const { getAiResponse } = require('../../../src/aiService');
const webhookManager = require('../../../src/webhookManager');
const channelUtils = require('../../../src/utils/channelUtils');
const webhookUserTracker = require('../../../src/utils/webhookUserTracker');
const { MARKERS } = require('../../../src/constants');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/aiService');
jest.mock('../../../src/webhookManager');
jest.mock('../../../src/utils/channelUtils');
jest.mock('../../../src/utils/webhookUserTracker');
jest.mock('../../../src/handlers/referenceHandler');
jest.mock('../../../src/utils/media', () => ({
  detectMedia: jest.fn()
}));
jest.mock('../../../src/auth', () => ({
  isNsfwVerified: jest.fn()
}));

describe('Personality Handler Module', () => {
  let mockMessage;
  let mockPersonality;
  let mockClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock message object
    mockMessage = {
      content: 'Test message',
      author: {
        id: 'user-id',
        username: 'TestUser',
        tag: 'TestUser#1234'
      },
      channel: {
        id: 'channel-id',
        name: 'test-channel',
        isDMBased: jest.fn().mockReturnValue(false),
        isThread: jest.fn().mockReturnValue(false),
        type: 'GUILD_TEXT',
        parent: null,
        sendTyping: jest.fn().mockResolvedValue({}),
        messages: {
          fetch: jest.fn()
        },
        send: jest.fn().mockResolvedValue({
          id: 'direct-message-id'
        })
      },
      reply: jest.fn().mockResolvedValue({}),
      reference: null,
      attachments: new Map(),
      embeds: []
    };
    
    // Mock personality object
    mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      systemPrompt: 'You are Test Personality',
      avatarUrl: 'https://example.com/avatar.jpg'
    };
    
    // Mock client object
    mockClient = {
      user: {
        id: 'bot-user-id'
      },
      guilds: {
        cache: {
          get: jest.fn()
        }
      }
    };
    
    // Mock channelUtils
    channelUtils.isChannelNSFW.mockReturnValue(true);
    
    // Mock webhookUserTracker
    webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);
    
    // Mock auth module
    require('../../../src/auth').isNsfwVerified.mockReturnValue(true);
    
    // Mock AI response
    getAiResponse.mockResolvedValue('Test AI response');
    
    // Mock webhook manager
    webhookManager.sendWebhookMessage.mockResolvedValue({
      messageIds: ['webhook-message-id'],
      message: { id: 'webhook-message-id' }
    });
    
    webhookManager.sendDirectThreadMessage.mockResolvedValue({
      messageIds: ['thread-message-id'],
      message: { id: 'thread-message-id' }
    });
    
    // Clear the activeRequests map
    personalityHandler.activeRequests.clear();
  });
  
  describe('trackRequest', () => {
    it('should track a request and return request key', () => {
      const result = personalityHandler.trackRequest('user-id', 'channel-id', 'test-personality');
      
      expect(result).toBe('user-id-channel-id-test-personality');
      expect(personalityHandler.activeRequests.has('user-id-channel-id-test-personality')).toBe(true);
    });
    
    it('should return null for duplicate requests', () => {
      // First request
      personalityHandler.trackRequest('user-id', 'channel-id', 'test-personality');
      
      // Second request should return null
      const result = personalityHandler.trackRequest('user-id', 'channel-id', 'test-personality');
      
      expect(result).toBeNull();
    });
  });
  
  describe('startTypingIndicator', () => {
    it('should start typing indicator and return interval ID', () => {
      // Mock setInterval
      jest.useFakeTimers();
      
      const channel = {
        sendTyping: jest.fn().mockResolvedValue({})
      };
      
      const result = personalityHandler.startTypingIndicator(channel);
      
      expect(result).toBeDefined();
      expect(channel.sendTyping).toHaveBeenCalled();
      
      // Advance timers to trigger the interval
      jest.advanceTimersByTime(6000);
      
      expect(channel.sendTyping).toHaveBeenCalledTimes(2);
      
      // Clean up
      clearInterval(result);
      jest.useRealTimers();
    });
    
    it('should handle errors when starting typing indicator', () => {
      const channel = {
        sendTyping: jest.fn().mockRejectedValue(new Error('Test error'))
      };
      
      const result = personalityHandler.startTypingIndicator(channel);
      
      expect(result).toBeDefined();
      expect(channel.sendTyping).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });
  
  describe('recordConversationData', () => {
    it('should record conversation data for array of message IDs', () => {
      // Mock recordConversation
      const recordConversation = jest.spyOn(require('../../../src/conversationManager'), 'recordConversation')
        .mockImplementation(() => {});
      
      const result = {
        messageIds: ['msg1', 'msg2']
      };
      
      personalityHandler.recordConversationData('user-id', 'channel-id', result, 'test-personality', false);
      
      expect(recordConversation).toHaveBeenCalledTimes(2);
      expect(recordConversation).toHaveBeenCalledWith('user-id', 'channel-id', 'msg1', 'test-personality', false);
      expect(recordConversation).toHaveBeenCalledWith('user-id', 'channel-id', 'msg2', 'test-personality', false);
      
      // Restore original implementation
      recordConversation.mockRestore();
    });
    
    it('should record conversation data for single message ID', () => {
      // Mock recordConversation
      const recordConversation = jest.spyOn(require('../../../src/conversationManager'), 'recordConversation')
        .mockImplementation(() => {});
      
      const result = {
        messageIds: 'single-msg-id'
      };
      
      personalityHandler.recordConversationData('user-id', 'channel-id', result, 'test-personality', true);
      
      expect(recordConversation).toHaveBeenCalledTimes(1);
      expect(recordConversation).toHaveBeenCalledWith('user-id', 'channel-id', 'single-msg-id', 'test-personality', true);
      
      // Restore original implementation
      recordConversation.mockRestore();
    });
    
    it('should handle empty message IDs array', () => {
      // Mock recordConversation
      const recordConversation = jest.spyOn(require('../../../src/conversationManager'), 'recordConversation')
        .mockImplementation(() => {});
      
      const result = {
        messageIds: []
      };
      
      personalityHandler.recordConversationData('user-id', 'channel-id', result, 'test-personality', false);
      
      expect(recordConversation).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
      
      // Restore original implementation
      recordConversation.mockRestore();
    });
  });
  
  describe('handlePersonalityInteraction', () => {
    it('should check NSFW channel requirements', async () => {
      // Set channel to not be NSFW
      channelUtils.isChannelNSFW.mockReturnValueOnce(false);
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should reply with NSFW requirement message
      expect(mockMessage.reply).toHaveBeenCalled();
      expect(mockMessage.reply.mock.calls[0][0].content).toContain('NSFW');
      
      // Should not proceed with AI call
      expect(getAiResponse).not.toHaveBeenCalled();
    });
    
    it('should check age verification requirements', async () => {
      // Set user to not be verified
      require('../../../src/auth').isNsfwVerified.mockReturnValueOnce(false);
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should reply with verification requirement message
      expect(mockMessage.reply).toHaveBeenCalled();
      expect(mockMessage.reply.mock.calls[0][0]).toContain('Age Verification Required');
      
      // Should not proceed with AI call
      expect(getAiResponse).not.toHaveBeenCalled();
    });
    
    it('should handle duplicate requests', async () => {
      // First request
      personalityHandler.trackRequest('user-id', 'channel-id', 'test-personality');
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should not proceed with AI call due to duplicate request
      expect(getAiResponse).not.toHaveBeenCalled();
    });
    
    it('should start typing indicator', async () => {
      const startTypingSpy = jest.spyOn(personalityHandler, 'startTypingIndicator');
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      expect(startTypingSpy).toHaveBeenCalledWith(mockMessage.channel);
      
      // Restore original
      startTypingSpy.mockRestore();
    });
    
    it('should call getAiResponse with correct parameters', async () => {
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        'Test message', // original message content
        expect.objectContaining({
          userId: 'user-id',
          channelId: 'channel-id',
          message: mockMessage
        })
      );
    });
    
    it('should send response via webhookManager', async () => {
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'Test AI response',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });
    
    it('should handle error response markers', async () => {
      getAiResponse.mockResolvedValueOnce(`${MARKERS.BOT_ERROR_MESSAGE}Test error message`);
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should reply with error message directly, not via webhook
      expect(mockMessage.reply).toHaveBeenCalledWith('Test error message');
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });
    
    it('should handle hard blocked response markers', async () => {
      getAiResponse.mockResolvedValueOnce(MARKERS.HARD_BLOCKED_RESPONSE);
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should not send any response
      expect(mockMessage.reply).not.toHaveBeenCalled();
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });
    
    it('should use direct thread message for threads', async () => {
      // Mock thread channel
      mockMessage.channel.isThread.mockReturnValue(true);
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      expect(webhookManager.sendDirectThreadMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'Test AI response',
        mockPersonality,
        expect.objectContaining({
          threadId: 'channel-id'
        })
      );
      
      // Should not use regular webhook message
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });
    
    it('should fall back to regular webhook if thread message fails', async () => {
      // Mock thread channel
      mockMessage.channel.isThread.mockReturnValue(true);
      
      // Make thread message fail
      webhookManager.sendDirectThreadMessage.mockRejectedValueOnce(new Error('Thread error'));
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should fall back to regular webhook
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalled();
    });
    
    it('should fall back to direct channel.send if all webhook methods fail', async () => {
      // Mock thread channel
      mockMessage.channel.isThread.mockReturnValue(true);
      
      // Make both webhook methods fail
      webhookManager.sendDirectThreadMessage.mockRejectedValueOnce(new Error('Thread error'));
      webhookManager.sendWebhookMessage.mockRejectedValueOnce(new Error('Webhook error'));
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should fall back to direct channel send
      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        `**Test Personality:** Test AI response`
      );
    });
    
    it('should track errors and reply to user on failure', async () => {
      // Force AI response to throw error
      getAiResponse.mockRejectedValueOnce(new Error('AI service error'));
      
      await personalityHandler.handlePersonalityInteraction(
        mockMessage, 
        mockPersonality, 
        null, 
        mockClient
      );
      
      // Should log the error
      expect(logger.error).toHaveBeenCalled();
      
      // Should reply to user with error message
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.stringContaining('Sorry, I encountered an error')
      );
    });
  });
});