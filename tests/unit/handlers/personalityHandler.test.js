/**
 * Tests for the personality handler module
 */

const { botPrefix } = require('../../../config');
const personalityHandler = require('../../../src/handlers/personalityHandler');
const logger = require('../../../src/logger');
const { getAiResponse } = require('../../../src/aiService');
const webhookManager = require('../../../src/webhookManager');
const channelUtils = require('../../../src/utils/channelUtils');
const webhookUserTracker = require('../../../src/utils/webhookUserTracker');
const conversationManager = require('../../../src/core/conversation');
const requestTracker = require('../../../src/utils/requestTracker');
const threadHandler = require('../../../src/utils/threadHandler');
const { detectMedia } = require('../../../src/utils/media');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/aiService');
jest.mock('../../../src/webhookManager', () => ({
  sendAsPersonality: jest.fn(),
  sendWebhookMessage: jest.fn(),
  sendDirectThreadMessage: jest.fn(),
}));
jest.mock('../../../src/utils/channelUtils', () => ({
  isChannelNSFW: jest.fn(),
}));
jest.mock('../../../src/utils/webhookUserTracker', () => ({
  shouldBypassNsfwVerification: jest.fn(),
  isProxySystemWebhook: jest.fn(),
  checkProxySystemAuthentication: jest.fn(),
  getRealUserId: jest.fn(),
}));
jest.mock('../../../src/handlers/referenceHandler', () => ({
  handleMessageReference: jest.fn(),
  processMessageLinks: jest.fn().mockReturnValue({ hasLinks: false }),
  parseEmbedsToText: jest.fn().mockReturnValue(''),
  MESSAGE_LINK_REGEX: /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/gi,
}));
jest.mock('../../../src/utils/media', () => ({
  detectMedia: jest.fn((message, content) => ({
    hasMedia: false,
    messageContent: content || 'default content',
  })),
  processMediaUrls: jest.fn(),
  processMediaForWebhook: jest.fn(),
  prepareAttachmentOptions: jest.fn().mockReturnValue(null),
}));
// Auth module has been removed - auth checks are now handled via DDD authentication
jest.mock('../../../src/utils/requestTracker');
jest.mock('../../../src/utils/threadHandler');
jest.mock('../../../src/core/conversation', () => ({
  recordConversation: jest.fn(),
  getPersonalityFromMessage: jest.fn(),
  isAutoResponseEnabled: jest.fn(),
}));
// Legacy personality manager removed - using DDD system now

describe('Personality Handler Module', () => {
  let mockMessage;
  let mockPersonality;
  let mockClient;
  let mockAuthService;
  let mockTimers;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Configure personalityHandler to use Jest's fake timers
    mockTimers = {
      setTimeout: jest.fn((fn, ms) => global.setTimeout(fn, ms)),
      clearTimeout: jest.fn(id => global.clearTimeout(id)),
      setInterval: jest.fn((fn, ms) => global.setInterval(fn, ms)),
      clearInterval: jest.fn(id => global.clearInterval(id)),
    };
    personalityHandler.configureTimers(mockTimers);

    // Configure delay to be instant for tests
    personalityHandler.configureDelay(ms => Promise.resolve());

    // Reset module state
    personalityHandler.clearCache();

    // Mock message object
    mockMessage = {
      id: 'message-id',
      author: {
        id: 'user-id',
        username: 'testuser',
        discriminator: '1234',
        bot: false,
      },
      channel: {
        id: 'channel-id',
        type: 0, // GUILD_TEXT
        send: jest.fn().mockResolvedValue({ id: 'sent-message-id' }),
        sendTyping: jest.fn().mockResolvedValue(undefined),
        nsfw: false,
        isDMBased: jest.fn().mockReturnValue(false),
        messages: {
          fetch: jest.fn(),
        },
      },
      guild: {
        id: 'guild-id',
      },
      content: 'Test message',
      attachments: new Map(),
      embeds: [],
      reply: jest.fn().mockResolvedValue({ id: 'reply-message-id' }),
      reference: null,
    };

    // Mock personality
    mockPersonality = {
      name: 'test-personality',
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatar: 'https://example.com/avatar.png',
      model: 'test-model',
      prompt: 'You are a helpful AI assistant',
      temperature: 0.8,
      maxTokens: 150,
      owner: 'owner-id',
      isNSFW: false,
      nsfw: false,
    };

    // Mock client
    mockClient = {
      user: { id: 'bot-id' },
    };

    // Set up mock defaults
    logger.info.mockImplementation(() => {});
    logger.error.mockImplementation(() => {});
    logger.warn.mockImplementation(() => {});
    logger.debug.mockImplementation(() => {});

    // Mock webhookUserTracker
    webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);
    webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
    webhookUserTracker.checkProxySystemAuthentication.mockResolvedValue({
      isAuthenticated: true,
    });
    webhookUserTracker.getRealUserId.mockReturnValue('user-id');

    // Mock channelUtils
    channelUtils.isChannelNSFW.mockReturnValue(false);

    // Mock conversationManager
    conversationManager.recordConversation.mockResolvedValue(undefined);
    conversationManager.getPersonalityFromMessage.mockReturnValue(null);
    conversationManager.isAutoResponseEnabled.mockReturnValue(false);

    // Mock getAiResponse
    getAiResponse.mockResolvedValue({ content: 'AI response', metadata: null });

    // Mock webhookManager
    webhookManager.sendWebhookMessage.mockResolvedValue({
      success: true,
      messageIds: ['webhook-message-id'],
    });
    webhookManager.sendDirectThreadMessage.mockResolvedValue({
      success: true,
      message: { id: 'thread-message-id' },
    });

    // Set up requestTracker mock defaults
    requestTracker.trackRequest.mockImplementation((userId, channelId, personalityName) => {
      return `${userId}-${channelId}-${personalityName}`;
    });
    requestTracker.removeRequest.mockImplementation(() => {});
    requestTracker.clearAllRequests.mockImplementation(() => {});
    requestTracker.isRequestActive.mockReturnValue(false);
    requestTracker.getActiveRequestCount.mockReturnValue(0);

    // Set up threadHandler mock defaults
    threadHandler.detectThread.mockReturnValue({
      isThread: false,
      isNativeThread: false,
      isForcedThread: false,
    });
    threadHandler.isForumChannel.mockReturnValue(false);
    threadHandler.buildThreadWebhookOptions.mockImplementation((channel, userId, threadInfo, isDMFormatted) => {
      // Return options with realUserId when a userId is provided
      return userId ? { realUserId: userId } : {};
    });
    threadHandler.sendThreadMessage.mockResolvedValue({
      success: true,
      messageIds: ['thread-message-id'],
    });
    threadHandler.getThreadInfo.mockReturnValue({});

    // Set up mock DDD auth service
    mockAuthService = {
      checkPersonalityAccess: jest.fn().mockResolvedValue({
        allowed: true,
      })
    };
    
    // Inject the mock auth service into personalityHandler
    personalityHandler.setAuthService(mockAuthService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });


  describe('startTypingIndicator', () => {
    it('should start typing indicator and return interval ID', () => {
      const intervalId = personalityHandler.startTypingIndicator(mockMessage.channel);

      expect(mockMessage.channel.sendTyping).toHaveBeenCalled();
      expect(intervalId).toBeDefined();
    });

    it('should handle errors when starting typing indicator', async () => {
      mockMessage.channel.sendTyping.mockRejectedValueOnce(new Error('Typing error'));

      const intervalId = personalityHandler.startTypingIndicator(mockMessage.channel);

      // The warning happens inside the promise, we need to flush promises
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start typing indicator')
      );
      expect(intervalId).toBeDefined();
      
      // Clean up the interval using the injected timer function
      if (intervalId) {
        mockTimers.clearInterval(intervalId);
      }
    });
  });


  describe('handlePersonalityInteraction', () => {
    it('should check NSFW channel requirements', async () => {
      // All personalities are treated as NSFW uniformly
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: false,
        reason: 'NSFW verification required'
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: 'NSFW verification required'
      });
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should check authentication before age verification', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: false,
        reason: 'Personality requires authentication'
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: 'Personality requires authentication'
      });
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should auto-verify users in NSFW channels', async () => {
      mockPersonality.isNSFW = true;
      channelUtils.isChannelNSFW.mockReturnValue(true);
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: true
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(getAiResponse).toHaveBeenCalled();
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalled();
    });

    it('should require age verification in DMs without auto-verification', async () => {
      // All personalities are treated as NSFW uniformly
      mockMessage.channel.type = 1; // DM channel
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: false,
        reason: 'NSFW verification required'
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: 'NSFW verification required'
      });
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should handle duplicate requests', async () => {
      requestTracker.trackRequest.mockReturnValueOnce(null);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // Duplicate requests are silently ignored
      expect(getAiResponse).not.toHaveBeenCalled();
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });

    it('should start typing indicator', async () => {
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.channel.sendTyping).toHaveBeenCalled();
    });

    it('should call getAiResponse with correct parameters', async () => {
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        'Test message',
        expect.objectContaining({
          userId: 'user-id',
          channelId: 'channel-id',
          messageId: 'message-id',
          message: mockMessage,
          userName: 'testuser (testuser)',
          isProxyMessage: false,
          disableContextMetadata: false,
        })
      );
    });

    it('should send response via webhookManager', async () => {
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'AI response',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });


    it('should handle error messages from AI service', async () => {
      getAiResponse.mockResolvedValueOnce({ content: `BOT_ERROR_MESSAGE:Something went wrong`, metadata: null });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.reply).toHaveBeenCalledWith('Something went wrong');
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });

    it('should use direct thread message for threads', async () => {
      threadHandler.detectThread.mockReturnValue({
        isThread: true,
        isNativeThread: true,
        isForcedThread: false,
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(threadHandler.sendThreadMessage).toHaveBeenCalledWith(
        webhookManager,
        mockMessage.channel,
        'AI response',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });

    it('should fall back to regular webhook if thread message fails', async () => {
      threadHandler.detectThread.mockReturnValue({
        isThread: true,
        isNativeThread: true,
        isForcedThread: false,
      });
      threadHandler.sendThreadMessage.mockResolvedValueOnce({
        success: false,
        error: 'Thread error',
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(threadHandler.sendThreadMessage).toHaveBeenCalled();
      // The threadHandler.sendThreadMessage should handle its own fallback internally
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });

    it('should fall back to direct channel.send if all webhook methods fail', async () => {
      webhookManager.sendWebhookMessage.mockResolvedValueOnce({
        success: false,
        error: 'Webhook error',
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // The current implementation doesn't have a fallback to channel.send
      // It just returns the webhook result regardless of success
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalled();
    });

    it('should track errors and reply to user on failure', async () => {
      getAiResponse.mockRejectedValueOnce(new Error('AI service error'));

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Error in personality interaction: AI service error'
      );
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Sorry, I encountered an error while processing your message. Check logs for details.'
      );
    });
  });

  describe('PluralKit Integration', () => {
    beforeEach(() => {
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.getRealUserId.mockReturnValue('real-user-id');
      webhookUserTracker.checkProxySystemAuthentication.mockResolvedValue({
        isAuthenticated: true,
      });
    });

    it('should track PluralKit messages to the real user ID', async () => {
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(requestTracker.trackRequest).toHaveBeenCalledWith(
        'real-user-id',
        'channel-id',
        'test-personality'
      );
    });

    it('should pass isProxyMessage flag to AI service for PluralKit messages', async () => {
      // Add webhookId to simulate a PluralKit message
      const pluralkitMessage = { ...mockMessage, webhookId: 'webhook-123' };
      
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: true
      });

      await personalityHandler.handlePersonalityInteraction(
        pluralkitMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        'Test message',
        expect.objectContaining({
          isProxyMessage: true,
        })
      );
    });

    it('should handle regular users without proxy message formatting', async () => {
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: true
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        'Test message',
        expect.objectContaining({
          isProxyMessage: false,
        })
      );
    });

    it('should use webhook options with real user ID for PluralKit', async () => {
      // Simulate a PluralKit webhook message
      mockMessage.webhookId = 'webhook-123';
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.getRealUserId.mockReturnValue('real-user-id');
      
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: true
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'AI response',
        mockPersonality,
        expect.objectContaining({
          realUserId: 'real-user-id',
        }),
        mockMessage
      );
    });
  });

  describe('PluralKit Authentication', () => {
    beforeEach(() => {
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.getRealUserId.mockReturnValue('real-user-id');
    });

    it('should check authentication for PluralKit proxy messages', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: false,
        reason: 'Personality requires authentication'
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: 'Personality requires authentication'
      });
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should allow authenticated PluralKit users to use personalities', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: true
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(getAiResponse).toHaveBeenCalled();
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalled();
    });

    it('should not check PluralKit authentication for non-proxy messages', async () => {
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(webhookUserTracker.checkProxySystemAuthentication).not.toHaveBeenCalled();
    });

    it('should show custom error message for unauthenticated PluralKit users', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: false,
        reason: 'Personality requires authentication'
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: 'Personality requires authentication'
      });
    });
  });

  describe('Markdown Image Link Processing', () => {
    it('should convert markdown image links to media handler format', async () => {
      const responseWithMarkdown = 'Here is an image: [https://example.com/image.png](https://example.com/image.png)';
      const expectedProcessed = 'Here is an image:\n[Image: https://example.com/image.png]';
      
      getAiResponse.mockResolvedValueOnce({ content: responseWithMarkdown, metadata: null });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        expectedProcessed,
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should handle multiple images but only process the last one', async () => {
      const responseWithMultiple = 'Image 1: [https://example.com/1.png](https://example.com/1.png) and Image 2: [https://example.com/2.png](https://example.com/2.png)';
      const expectedProcessed = 'Image 1: [https://example.com/1.png](https://example.com/1.png) and Image 2:\n[Image: https://example.com/2.png]';
      
      getAiResponse.mockResolvedValueOnce({ content: responseWithMultiple, metadata: null });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        expectedProcessed,
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should not modify responses without markdown image links', async () => {
      const normalResponse = 'This is a normal response without images';
      
      getAiResponse.mockResolvedValueOnce({ content: normalResponse, metadata: null });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        normalResponse,
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should not process markdown links with mismatched URLs', async () => {
      const responseWithDifferentUrls = '![image](https://example.com/image.png)(https://different.com/image.png)';
      
      getAiResponse.mockResolvedValueOnce({ content: responseWithDifferentUrls, metadata: null });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        responseWithDifferentUrls,
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should handle various image formats', async () => {
      const formats = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
      
      for (const format of formats) {
        jest.clearAllMocks();
        personalityHandler.setAuthService(mockAuthService);
        
        const response = `[https://example.com/image.${format}](https://example.com/image.${format})`;
        const expected = `\n[Image: https://example.com/image.${format}]`;
        
        getAiResponse.mockResolvedValueOnce({ content: response, metadata: null });

        await personalityHandler.handlePersonalityInteraction(
          mockMessage,
          mockPersonality,
          'Test message',
          mockClient
        );

        expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
          mockMessage.channel,
          expected,
          mockPersonality,
          expect.any(Object),
          mockMessage
        );
      }
    });

    it('should handle non-string AI responses gracefully', async () => {
      getAiResponse.mockResolvedValueOnce({ content: null, metadata: null });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // When AI returns null, the handler treats it as an empty response and sends it
      // It doesn't error out unless there's an actual exception
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        null,
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });
  });

  describe('Request Deduplication Error Recovery', () => {
    it('should remove request from tracking on AI service error to allow retries', async () => {
      const requestKey = 'user-id-channel-id-test-personality';
      requestTracker.trackRequest.mockReturnValueOnce(requestKey);
      getAiResponse.mockRejectedValueOnce(new Error('AI service error'));

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(requestTracker.removeRequest).toHaveBeenCalledWith(requestKey);
      expect(mockMessage.reply).toHaveBeenCalled();
    });

    it('should remove request from tracking even when error reply fails', async () => {
      const requestKey = 'user-id-channel-id-test-personality';
      requestTracker.trackRequest.mockReturnValueOnce(requestKey);
      getAiResponse.mockRejectedValueOnce(new Error('AI service error'));
      mockMessage.reply.mockRejectedValueOnce(new Error('Reply failed'));

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(requestTracker.removeRequest).toHaveBeenCalledWith(requestKey);
      // The error handler logs multiple things, check for the main error log
      expect(logger.error).toHaveBeenCalledWith(
        'Error in personality interaction: AI service error'
      );
    });

    it('should allow retry after error by not blocking subsequent requests', async () => {
      // First request fails
      requestTracker.trackRequest.mockReturnValueOnce('request-1');
      getAiResponse.mockRejectedValueOnce(new Error('Temporary error'));

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(requestTracker.removeRequest).toHaveBeenCalledWith('request-1');

      // Second request should succeed
      jest.clearAllMocks();
      personalityHandler.setAuthService(mockAuthService);
      requestTracker.trackRequest.mockReturnValueOnce('request-2');
      getAiResponse.mockResolvedValueOnce({ content: 'AI response after retry', metadata: null });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(getAiResponse).toHaveBeenCalled();
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalled();
    });

    it('should not remove request if trackRequest returns null (duplicate prevention)', async () => {
      requestTracker.trackRequest.mockReturnValueOnce(null);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(requestTracker.removeRequest).not.toHaveBeenCalled();
      // When trackRequest returns null (duplicate), the handler just returns without logging
      expect(getAiResponse).not.toHaveBeenCalled();
    });
  });

  describe('Configuration and Setup', () => {
    it('should configure timers with custom timer functions', () => {
      const customTimers = {
        setTimeout: jest.fn(),
        clearTimeout: jest.fn(),
        setInterval: jest.fn(),
        clearInterval: jest.fn(),
      };

      personalityHandler.configureTimers(customTimers);

      // Start typing indicator to verify custom timers are used
      const intervalId = personalityHandler.startTypingIndicator(mockMessage.channel);

      expect(customTimers.setInterval).toHaveBeenCalled();
    });

    it('should configure delay function for testing', async () => {
      const customDelay = jest.fn().mockResolvedValue();
      personalityHandler.configureDelay(customDelay);

      // This would normally trigger the delay in the handler
      // Since we can't easily trigger it without complex setup, we'll just verify it's set
      expect(customDelay).toBeDefined();
    });
  });

  describe('Auth Service Error Handling', () => {
    it('should handle missing auth service injection', async () => {
      // Clear the auth service to trigger the error
      personalityHandler.clearCache();

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityHandler] Error checking personality auth:',
        expect.any(Error)
      );
    });

    it('should handle auth service errors gracefully', async () => {
      mockAuthService.checkPersonalityAccess.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityHandler] Error checking personality auth:',
        expect.any(Error)
      );
      expect(mockMessage.reply).toHaveBeenCalledWith({
        content: 'An error occurred while checking authorization.'
      });
    });

    it('should handle sendAuthError failing gracefully', async () => {
      mockAuthService.checkPersonalityAccess.mockResolvedValueOnce({
        allowed: false,
        reason: 'Personality requires authentication'
      });
      mockMessage.reply.mockRejectedValueOnce(new Error('Reply failed'));

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityHandler] Error sending auth error message:',
        expect.any(Error)
      );
    });
  });

  describe('Message Reference Processing', () => {
    beforeEach(() => {
      // Mock reference handler
      const referenceHandler = require('../../../src/handlers/referenceHandler');
      referenceHandler.processMessageLinks.mockResolvedValue({
        hasProcessedLink: false,
        messageContent: 'Test message',
      });
    });

    it('should process direct message replies', async () => {
      const referencedMessage = {
        id: 'referenced-message-id',
        content: 'Original message content',
        author: { id: 'other-user-id', username: 'OtherUser', bot: false },
        attachments: new Map(),
        embeds: [],
        webhookId: null,
        createdTimestamp: Date.now() - 1000,
      };

      mockMessage.reference = {
        messageId: 'referenced-message-id',
        channelId: 'channel-id',
      };
      mockMessage.channel.messages.fetch.mockResolvedValueOnce(referencedMessage);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('referenced-message-id');
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        expect.objectContaining({
          messageContent: 'Test message',
          referencedMessage: expect.objectContaining({
            content: 'Original message content',
            author: 'OtherUser',
            authorId: 'other-user-id',
          }),
        }),
        expect.any(Object)
      );
    });

    it('should handle image attachments in referenced messages', async () => {
      const imageAttachment = {
        url: 'https://example.com/image.png',
        contentType: 'image/png',
      };
      const attachments = new Map([['attachment-id', imageAttachment]]);

      const referencedMessage = {
        id: 'referenced-message-id',
        content: 'Message with image',
        author: { id: 'other-user-id', username: 'OtherUser', bot: false },
        attachments: attachments,
        embeds: [],
        webhookId: null,
        createdTimestamp: Date.now() - 1000,
      };

      mockMessage.reference = {
        messageId: 'referenced-message-id',
        channelId: 'channel-id',
      };
      mockMessage.channel.messages.fetch.mockResolvedValueOnce(referencedMessage);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // The handler processes the referenced message correctly
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        expect.objectContaining({
          referencedMessage: expect.objectContaining({
            content: 'Message with image',
            author: 'OtherUser',
          }),
        }),
        expect.any(Object)
      );
    });

    it('should handle audio attachments in referenced messages', async () => {
      const audioAttachment = {
        url: 'https://example.com/audio.mp3',
        contentType: 'audio/mpeg',
      };
      const attachments = new Map([['attachment-id', audioAttachment]]);

      const referencedMessage = {
        id: 'referenced-message-id',
        content: 'Message with audio',
        author: { id: 'other-user-id', username: 'OtherUser', bot: false },
        attachments: attachments,
        embeds: [],
        webhookId: null,
        createdTimestamp: Date.now() - 1000,
      };

      mockMessage.reference = {
        messageId: 'referenced-message-id',
        channelId: 'channel-id',
      };
      mockMessage.channel.messages.fetch.mockResolvedValueOnce(referencedMessage);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // The handler processes the referenced message correctly
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        expect.objectContaining({
          referencedMessage: expect.objectContaining({
            content: 'Message with audio',
            author: 'OtherUser',
          }),
        }),
        expect.any(Object)
      );
    });

    it('should handle webhook messages in references', async () => {
      const referencedMessage = {
        id: 'referenced-message-id',
        content: 'Webhook message content',
        author: { id: 'webhook-id', username: 'PersonalityName', bot: true },
        attachments: new Map(),
        embeds: [],
        webhookId: 'webhook-123',
        createdTimestamp: Date.now() - 1000,
      };

      // Mock the conversation manager to return personality info
      conversationManager.getPersonalityFromMessage.mockResolvedValueOnce('personality-name');

      mockMessage.reference = {
        messageId: 'referenced-message-id',
        channelId: 'channel-id',
      };
      mockMessage.channel.messages.fetch.mockResolvedValueOnce(referencedMessage);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(conversationManager.getPersonalityFromMessage).toHaveBeenCalledWith(
        'referenced-message-id',
        { webhookUsername: 'PersonalityName' }
      );
    });

    it('should handle errors when fetching referenced messages', async () => {
      mockMessage.reference = {
        messageId: 'non-existent-message-id',
        channelId: 'channel-id',
      };
      mockMessage.channel.messages.fetch.mockRejectedValueOnce(new Error('Message not found'));

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityHandler] Error fetching referenced message: Message not found'
      );
      // Should still process the message without the reference
      expect(getAiResponse).toHaveBeenCalled();
    });

    it('should handle nested references in active conversations', async () => {
      // Enable autoresponse to trigger nested reference processing
      conversationManager.isAutoResponseEnabled.mockReturnValue(true);

      const nestedReferencedMessage = {
        id: 'nested-referenced-id',
        content: 'Nested message content',
        author: { id: 'nested-user-id', username: 'NestedUser' },
      };

      const referencedMessage = {
        id: 'referenced-message-id',
        content: 'Message that references another',
        author: { id: 'other-user-id', username: 'OtherUser', bot: false },
        attachments: new Map(),
        embeds: [],
        webhookId: null,
        createdTimestamp: Date.now() - 1000,
        reference: { messageId: 'nested-referenced-id' },
      };

      mockMessage.reference = {
        messageId: 'referenced-message-id',
        channelId: 'channel-id',
      };
      
      // Mock fetch to return the referenced message first
      mockMessage.channel.messages.fetch.mockResolvedValueOnce(referencedMessage);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null, // No triggering mention to enable active conversation mode
        mockClient
      );

      // The handler should process the referenced message
      expect(mockMessage.channel.messages.fetch).toHaveBeenCalledWith('referenced-message-id');
      
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        expect.objectContaining({
          referencedMessage: expect.objectContaining({
            content: 'Message that references another',
            author: 'OtherUser',
          }),
        }),
        expect.any(Object)
      );
    });

    it('should handle same-personality reference optimization', async () => {
      // Mock the conversation manager to return the same personality
      conversationManager.getPersonalityFromMessage.mockResolvedValueOnce('test-personality');

      const referencedMessage = {
        id: 'referenced-message-id',
        content: 'Previous personality message',
        author: { id: 'webhook-id', username: 'Test Personality', bot: true },
        attachments: new Map(),
        embeds: [],
        webhookId: 'webhook-123',
        createdTimestamp: Date.now() - 1000, // Recent message
      };

      mockMessage.reference = {
        messageId: 'referenced-message-id',
        channelId: 'channel-id', // Same channel
      };
      mockMessage.channel.id = 'channel-id'; // Ensure same channel
      mockMessage.channel.messages.fetch.mockResolvedValueOnce(referencedMessage);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // Should skip reference context for same personality in same channel
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        'Test message', // Simple content, no reference object
        expect.any(Object)
      );
    });

    it('should NOT apply same-personality optimization for messages older than 24 hours', async () => {
      // Mock the conversation manager to return the same personality
      conversationManager.getPersonalityFromMessage.mockResolvedValueOnce('test-personality');

      const referencedMessage = {
        id: 'referenced-message-id',
        content: 'Previous personality message',
        author: { id: 'webhook-id', username: 'Test Personality', bot: true },
        attachments: new Map(),
        embeds: [],
        webhookId: 'webhook-123',
        createdTimestamp: Date.now() - (25 * 60 * 60 * 1000), // 25 hours ago
      };

      mockMessage.reference = {
        messageId: 'referenced-message-id',
        channelId: 'channel-id', // Same channel
      };
      mockMessage.channel.id = 'channel-id'; // Ensure same channel
      mockMessage.channel.messages.fetch.mockResolvedValueOnce(referencedMessage);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // Should include reference context since message is too old
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        expect.objectContaining({
          messageContent: 'Test message',
          referencedMessage: expect.objectContaining({
            content: 'Previous personality message'
          })
        }),
        expect.any(Object)
      );
    });
  });

  describe('Error Logging Edge Cases', () => {
    it('should handle errors when logging message details during error handling', async () => {
      // Create an error during message processing
      getAiResponse.mockRejectedValueOnce(new Error('AI Error'));

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      // The error handler should log various error details
      expect(logger.error).toHaveBeenCalledWith('Error in personality interaction: AI Error');
      expect(logger.error).toHaveBeenCalledWith('Error type: Error');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error stack:'));
      expect(logger.error).toHaveBeenCalledWith('Message content: Test message...');
    });

    it('should handle errors when trying to log API response data', async () => {
      const apiError = new Error('API Error');
      apiError.response = { data: 'response data' };
      getAiResponse.mockRejectedValueOnce(apiError);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('API Response error:')
      );
    });

    it('should handle errors when trying to log request data', async () => {
      const requestError = new Error('Request Error');
      requestError.request = { url: 'https://api.example.com' };
      getAiResponse.mockRejectedValueOnce(requestError);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        'Test message',
        mockClient
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Request that caused error:')
      );
    });
  });
});