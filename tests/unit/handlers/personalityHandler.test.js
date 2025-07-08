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
const { MARKERS } = require('../../../src/constants');
const requestTracker = require('../../../src/utils/requestTracker');
const personalityAuth = require('../../../src/utils/personalityAuth');
const threadHandler = require('../../../src/utils/threadHandler');

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('../../../src/aiService');
jest.mock('../../../src/webhookManager', () => ({
  sendAsPersonality: jest.fn(),
  sendWebhookMessage: jest.fn(),
  sendDirectThreadMessage: jest.fn(),
}));
jest.mock('../../../src/utils/channelUtils');
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
  detectMedia: jest.fn().mockReturnValue({
    hasMedia: false,
    messageContent: 'default content',
  }),
  processMediaUrls: jest.fn(),
  processMediaForWebhook: jest.fn(),
  prepareAttachmentOptions: jest.fn().mockReturnValue(null),
}));
// Auth module has been removed - auth checks are now handled by personalityAuth
jest.mock('../../../src/utils/requestTracker');
jest.mock('../../../src/utils/personalityAuth');
jest.mock('../../../src/utils/threadHandler');
jest.mock('../../../src/core/conversation', () => ({
  recordConversation: jest.fn(),
  getPersonalityFromMessage: jest.fn(),
  isAutoResponseEnabled: jest.fn(),
}));
jest.mock('../../../src/core/personality', () => ({
  listPersonalitiesForUser: jest.fn().mockReturnValue([]),
}));

describe('Personality Handler Module', () => {
  let mockMessage;
  let mockPersonality;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Configure personalityHandler to use fake timers and instant delays
    personalityHandler.configureTimers({
      setTimeout: jest.fn((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: jest.fn(id => clearTimeout(id)),
      setInterval: jest.fn((fn, ms) => setInterval(fn, ms)),
      clearInterval: jest.fn(id => clearInterval(id)),
    });

    // Configure delay to be instant for tests
    personalityHandler.configureDelay(ms => Promise.resolve());

    // Mock message object
    mockMessage = {
      id: 'message-id',
      content: 'Test message',
      author: {
        id: 'user-id',
        username: 'testuser',
        tag: 'testuser#1234',
      },
      channel: {
        id: 'test-channel-id',
        name: 'test-channel',
        isDMBased: jest.fn().mockReturnValue(false),
        isThread: jest.fn().mockReturnValue(false),
        isTextBased: jest.fn().mockReturnValue(true),
        isVoiceBased: jest.fn().mockReturnValue(false),
        type: 'GUILD_TEXT',
        parent: null,
        parentId: null,
        sendTyping: jest.fn().mockResolvedValue({}),
        messages: {
          fetch: jest.fn(),
        },
        send: jest.fn().mockResolvedValue({
          id: 'direct-message-id',
        }),
      },
      reply: jest.fn().mockResolvedValue({}),
      reference: null,
      attachments: new Map(),
      embeds: [],
      member: {
        displayName: 'TestUser',
      },
    };

    // Mock personality object
    mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      systemPrompt: 'You are Test Personality',
      avatarUrl: 'https://example.com/avatar.jpg',
    };

    // Mock client object
    mockClient = {
      user: {
        id: 'bot-user-id',
      },
      guilds: {
        cache: {
          get: jest.fn(),
        },
      },
    };

    // Mock channelUtils
    channelUtils.isChannelNSFW.mockReturnValue(true);

    // Mock webhookUserTracker
    webhookUserTracker.shouldBypassNsfwVerification.mockReturnValue(false);

    // Mock auth module - default to authenticated and verified
    // Auth checks now handled by mocked authManager
    // NSFW checks now handled by mocked authManager

    // Mock media detection
    require('../../../src/utils/media').detectMedia.mockImplementation((message, content) => ({
      hasMedia: false,
      messageContent: content || message.content,
    }));

    // Mock AI response
    getAiResponse.mockResolvedValue('Test AI response');

    // Mock webhook manager to return the structure expected by recordConversationData
    webhookManager.sendWebhookMessage.mockResolvedValue({
      messageIds: ['webhook-message-id'],
      message: { id: 'webhook-message-id' },
    });

    webhookManager.sendDirectThreadMessage.mockResolvedValue({
      messageIds: ['thread-message-id'],
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

    // Set up personalityAuth mock defaults
    personalityAuth.checkPersonalityAuth.mockResolvedValue({
      isAllowed: true,
      authUserId: 'user-id',
      authUsername: 'testuser',
      isProxySystem: false,
      isDM: false,
      isNSFW: true,
    });
    personalityAuth.sendAuthError = jest.fn().mockImplementation(async (message, errorMessage) => {
      await message.reply({ content: errorMessage, ephemeral: true });
    });

    // Set up threadHandler mock defaults
    threadHandler.detectThread.mockReturnValue({
      isThread: false,
      isNativeThread: false,
      isForcedThread: false,
      channelType: 'GUILD_TEXT',
    });
    threadHandler.buildThreadWebhookOptions.mockReturnValue({
      userId: 'user-id',
      channelType: 'GUILD_TEXT',
      isReplyToDMFormattedMessage: false,
    });
    threadHandler.sendThreadMessage.mockResolvedValue({
      messageIds: ['thread-message-id'],
      message: { id: 'thread-message-id' },
    });
    threadHandler.getThreadInfo.mockReturnValue({});

    // Clear the activeRequests map
    requestTracker.clearAllRequests();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // Helper to wait for async operations
  const waitForAsyncOperations = async () => {
    // Since we configured instant delays, just flush promises
    await Promise.resolve();
  };

  describe('trackRequest', () => {
    it('should track a request and return request key', async () => {
      // Verify that requestTracker.trackRequest is called when handling a personality interaction
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify trackRequest was called with correct parameters
      expect(requestTracker.trackRequest).toHaveBeenCalledWith(
        'user-id',
        'test-channel-id',
        'test-personality'
      );
    });

    it('should return null for duplicate requests', () => {
      // Mock requestTracker to return null (duplicate)
      requestTracker.trackRequest.mockReturnValue(null);

      // The duplicate handling is now in requestTracker module
      const result = requestTracker.trackRequest('user-id', 'channel-id', 'test-personality');

      expect(result).toBeNull();
    });
  });

  describe('startTypingIndicator', () => {
    let mockInterval;

    beforeEach(() => {
      // Use a fake interval ID
      mockInterval = 12345;

      // Configure personality handler with mock timers
      personalityHandler.configureTimers({
        setInterval: jest.fn((callback, delay) => {
          // Store the callback for testing
          personalityHandler._testIntervalCallback = callback;
          return mockInterval;
        }),
        clearInterval: jest.fn(),
        setTimeout: jest.fn(),
        clearTimeout: jest.fn(),
      });
    });

    afterEach(() => {
      // Reset timers to defaults
      personalityHandler.configureTimers({
        setInterval: global.setInterval,
        clearInterval: global.clearInterval,
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
      });
    });

    it('should start typing indicator and return interval ID', () => {
      const channel = {
        sendTyping: jest.fn().mockResolvedValue({}),
      };

      const result = personalityHandler.startTypingIndicator(channel);

      expect(result).toBe(mockInterval);
      expect(channel.sendTyping).toHaveBeenCalled();
    });

    it('should handle errors when starting typing indicator', () => {
      const channel = {
        sendTyping: jest.fn().mockRejectedValue(new Error('Network error')),
      };

      const result = personalityHandler.startTypingIndicator(channel);

      // Should still return interval ID even if sendTyping fails
      expect(result).toBe(mockInterval);
    });
  });

  describe('recordConversationData', () => {
    it('should record conversation data for array of message IDs', () => {
      const { recordConversation } = require('../../../src/core/conversation');

      const result = {
        messageIds: ['msg1', 'msg2'],
      };

      personalityHandler.recordConversationData(
        'user-id',
        'channel-id',
        result,
        'test-personality',
        false
      );

      expect(recordConversation).toHaveBeenCalledTimes(2);
      expect(recordConversation).toHaveBeenNthCalledWith(
        1,
        'user-id',
        'channel-id',
        'msg1',
        'test-personality',
        false,
        false
      );
      expect(recordConversation).toHaveBeenNthCalledWith(
        2,
        'user-id',
        'channel-id',
        'msg2',
        'test-personality',
        false,
        false
      );
    });

    it('should record conversation data for single message ID', () => {
      const { recordConversation } = require('../../../src/core/conversation');

      const result = {
        messageIds: 'single-message-id', // String instead of array
      };

      personalityHandler.recordConversationData(
        'user-id',
        'channel-id',
        result,
        'test-personality',
        false
      );

      expect(recordConversation).toHaveBeenCalledTimes(1);
      expect(recordConversation).toHaveBeenCalledWith(
        'user-id',
        'channel-id',
        'single-message-id',
        'test-personality',
        false,
        false
      );
    });

    it('should handle empty message IDs array', () => {
      const { recordConversation } = require('../../../src/core/conversation');

      const result = {
        messageIds: [],
      };

      personalityHandler.recordConversationData(
        'user-id',
        'channel-id',
        result,
        'test-personality',
        false
      );

      expect(recordConversation).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('handlePersonalityInteraction', () => {
    it('should check NSFW channel requirements', async () => {
      // Mock personalityAuth to return not allowed for NSFW requirements
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: false,
        errorMessage: 'This personality is only available in NSFW channels.',
        reason: 'nsfw_required',
        shouldReply: true,
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Should call sendAuthError with NSFW requirement message
      expect(personalityAuth.sendAuthError).toHaveBeenCalledWith(
        mockMessage,
        expect.stringContaining('NSFW'),
        'nsfw_required'
      );

      // Should not proceed with AI call
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should check authentication before age verification', async () => {
      // Mock personalityAuth to return not allowed for authentication
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: false,
        errorMessage: `⚠️ **Authentication Required**\n\nTo use AI personalities, you need to authenticate first.\n\nPlease run \`${botPrefix} auth start\` to begin setting up your account.`,
        reason: 'not_authenticated',
        shouldReply: true,
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Should call sendAuthError with authentication message
      expect(personalityAuth.sendAuthError).toHaveBeenCalledWith(
        mockMessage,
        expect.stringContaining('Authentication Required'),
        'not_authenticated'
      );

      // Should not proceed with AI call
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should auto-verify users in NSFW channels', async () => {
      // Mock personalityAuth to allow the request (auto-verification happens inside personalityAuth)
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: true,
        authUserId: 'user-id',
        authUsername: 'TestUser',
        isProxySystem: false,
        isDM: false,
        isNSFW: true,
      });

      // Mock successful AI response
      getAiResponse.mockResolvedValueOnce('Test AI response');

      // Mock successful webhook message send
      webhookManager.sendWebhookMessage.mockResolvedValueOnce({
        messageIds: ['123456789'],
        result: true,
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Should proceed with AI call after auto-verification
      expect(getAiResponse).toHaveBeenCalled();

      // Should send the response via webhook
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalled();
    });

    it('should require age verification in DMs without auto-verification', async () => {
      // Mock personalityAuth to return not allowed for verification
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: false,
        errorMessage: `⚠️ **Age Verification Required**\n\nTo use AI personalities, you need to verify your age first.\n\nPlease run \`${botPrefix} verify\` in a channel marked as NSFW. This will verify that you meet Discord's age requirements for accessing NSFW content.`,
        reason: 'not_verified',
        shouldReply: true,
      });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();

      // Should call sendAuthError with verification message
      expect(personalityAuth.sendAuthError).toHaveBeenCalledWith(
        mockMessage,
        expect.stringContaining('Age Verification Required'),
        'not_verified'
      );

      // Should not proceed with AI call
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should handle duplicate requests', async () => {
      // Mock trackRequest to return null (duplicate)
      requestTracker.trackRequest.mockReturnValue(null);

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
      mockMessage.channel.sendTyping.mockResolvedValue();

      // Configure mock timers for this test
      const mockInterval = 12345;
      const mockSetInterval = jest.fn().mockReturnValue(mockInterval);
      const mockClearInterval = jest.fn();

      personalityHandler.configureTimers({
        setInterval: mockSetInterval,
        clearInterval: mockClearInterval,
        setTimeout: jest.fn((fn, ms) => setTimeout(fn, ms)),
        clearTimeout: jest.fn(id => clearTimeout(id)),
      });

      const promise = personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();
      await promise;

      // Verify typing indicator was started
      expect(mockMessage.channel.sendTyping).toHaveBeenCalled();
      expect(mockSetInterval).toHaveBeenCalled();

      // Reset timers
      personalityHandler.configureTimers({
        setInterval: global.setInterval,
        clearInterval: global.clearInterval,
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
      });
    });

    it('should call getAiResponse with correct parameters', async () => {
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify getAiResponse was called with correct parameters
      expect(getAiResponse).toHaveBeenCalledWith(
        mockPersonality.fullName,
        expect.any(String), // The constructed message content
        expect.objectContaining({
          userId: mockMessage.author.id,
          channelId: mockMessage.channel.id,
          message: mockMessage,
          userName: expect.any(String),
        })
      );
    });

    it('should send response via webhookManager', async () => {
      // Reset all mocks
      jest.clearAllMocks();

      // Mock personalityAuth to allow the request
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: true,
        authUserId: 'user-id',
        authUsername: 'TestUser',
        isProxySystem: false,
        isDM: false,
        isNSFW: true,
      });

      // Mock threadHandler to indicate it's not a thread
      threadHandler.detectThread.mockReturnValueOnce({
        isThread: false,
      });

      threadHandler.buildThreadWebhookOptions.mockReturnValueOnce({
        userId: mockMessage.author.id,
        threadId: undefined,
        channelType: 'GUILD_TEXT',
        isForum: null,
        isReplyToDMFormattedMessage: false,
      });

      // Set up mocks to ensure they resolve correctly
      getAiResponse.mockResolvedValue('Test AI response');
      webhookManager.sendWebhookMessage.mockResolvedValue({
        messageIds: ['webhook-message-id'],
        message: { id: 'webhook-message-id' },
      });

      // Ensure getRealUserId returns the correct value
      webhookUserTracker.getRealUserId.mockReturnValue(mockMessage.author.id);

      // Ensure isAutoResponseEnabled returns false
      conversationManager.isAutoResponseEnabled.mockReturnValue(false);

      const promise = personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();
      await promise;

      // Verify webhook manager was called
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'Test AI response',
        mockPersonality,
        expect.objectContaining({
          userId: mockMessage.author.id,
        }),
        mockMessage
      );

      // Verify conversation was recorded
      // isMentionOnly is true for guild channels without autoresponse
      expect(conversationManager.recordConversation).toHaveBeenCalledWith(
        mockMessage.author.id,
        mockMessage.channel.id,
        'webhook-message-id',
        mockPersonality.fullName,
        false,
        true
      );
    });

    it('should handle error response markers', async () => {
      // Mock AI to return an error marker
      getAiResponse.mockResolvedValueOnce(MARKERS.BOT_ERROR_MESSAGE + ' An error occurred');

      const promise = personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();
      await promise;

      // Verify reply was called with error message (without the marker)
      expect(mockMessage.reply).toHaveBeenCalledWith('An error occurred');

      // Verify webhook manager was NOT called
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });

    it('should handle error messages from AI service', async () => {
      // Mock AI to return an error message
      const errorMessage =
        'I encountered a processing error. This personality might need maintenance. Please try again or contact support. ||(Reference: test123)||';
      getAiResponse.mockResolvedValueOnce(errorMessage);

      const promise = personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();
      await promise;

      // Verify error message was sent to user
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        expect.any(Object),
        errorMessage,
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should use direct thread message for threads', async () => {
      // Mock threadHandler to detect a thread
      threadHandler.detectThread.mockReturnValue({
        isThread: true,
        isNativeThread: true,
        isForcedThread: false,
        channelType: 'GUILD_PUBLIC_THREAD',
      });

      const promise = personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();
      await promise;

      // Verify threadHandler.sendThreadMessage was called
      expect(threadHandler.sendThreadMessage).toHaveBeenCalledWith(
        webhookManager,
        mockMessage.channel,
        'Test AI response',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );

      // Verify regular sendWebhookMessage was NOT called
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
    });

    it('should fall back to regular webhook if thread message fails', async () => {
      // Mock personalityAuth to allow the request
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: true,
        authUserId: 'user-id',
        authUsername: 'TestUser',
        isProxySystem: false,
        isDM: false,
        isNSFW: true,
      });

      // Mock threadHandler to indicate it's a thread
      threadHandler.detectThread.mockReturnValueOnce({
        isThread: true,
      });

      threadHandler.getThreadInfo.mockReturnValueOnce({
        isThread: true,
        threadId: 'thread-id',
        parentId: 'parent-channel-id',
        isForum: false,
      });

      threadHandler.buildThreadWebhookOptions.mockReturnValueOnce({
        userId: mockMessage.author.id,
        threadId: 'thread-id',
        channelType: 'GUILD_PUBLIC_THREAD',
      });

      // Mock successful AI response
      getAiResponse.mockResolvedValueOnce('Test AI response');

      // Mock sendThreadMessage to return a successful result
      // (The fallback logic is handled inside threadHandler.sendThreadMessage)
      threadHandler.sendThreadMessage.mockResolvedValueOnce({
        messageIds: ['thread-message-id'],
        result: true,
      });

      const promise = personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();
      await promise;

      // Verify threadHandler.sendThreadMessage was called
      expect(threadHandler.sendThreadMessage).toHaveBeenCalledWith(
        webhookManager,
        mockMessage.channel,
        'Test AI response',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should fall back to direct channel.send if all webhook methods fail', async () => {
      // Mock threadHandler to detect a thread
      threadHandler.detectThread.mockReturnValue({
        isThread: true,
        isNativeThread: true,
        isForcedThread: false,
        channelType: 'GUILD_PUBLIC_THREAD',
      });

      // Mock sendThreadMessage to simulate complete failure and emergency fallback
      threadHandler.sendThreadMessage.mockImplementation(async () => {
        // Simulate all methods failing internally, triggering emergency fallback
        mockMessage.channel.send.mockResolvedValueOnce({ id: 'direct-message-id' });
        return {
          messageIds: ['direct-message-id'],
          message: { id: 'direct-message-id' },
          isEmergencyFallback: true,
        };
      });

      const promise = personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();
      await promise;

      // Verify threadHandler.sendThreadMessage was called (it handles fallback internally)
      expect(threadHandler.sendThreadMessage).toHaveBeenCalled();
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

  describe('PluralKit Integration', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      // Auth mocks are now handled by personalityAuth mock

      // Setup webhook manager mock
      webhookManager.sendWebhookMessage.mockResolvedValue({
        messageIds: ['123456789'],
        result: true,
      });
    });

    test('should track PluralKit messages to the real user ID', async () => {
      // Mock a PluralKit webhook message
      const pluralKitMessage = {
        ...mockMessage,
        webhookId: 'pk-webhook-123',
        author: {
          id: 'pk-webhook-123',
          username: 'Alice | Wonderland System',
          bot: true,
        },
      };

      // Mock webhook user tracker to return real user ID
      webhookUserTracker.getRealUserId.mockReturnValue('real-user-123');
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.checkProxySystemAuthentication.mockReturnValue({
        isAuthenticated: true,
        userId: 'real-user-123',
        username: 'Alice',
      });

      // Call the handler
      await personalityHandler.handlePersonalityInteraction(
        pluralKitMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify conversation was recorded with real user ID, not webhook ID
      expect(conversationManager.recordConversation).toHaveBeenCalledWith(
        'real-user-123', // Real user ID, not 'pk-webhook-123'
        'test-channel-id',
        expect.any(String),
        'test-personality',
        false,
        true // isMentionOnly is true for guild channels without autoresponse
      );
    });

    test('should pass isProxyMessage flag to AI service for PluralKit messages', async () => {
      // Mock a PluralKit webhook message
      const pluralKitMessage = {
        ...mockMessage,
        webhookId: 'pk-webhook-123',
        author: {
          id: 'pk-webhook-123',
          username: 'Bob | Test System',
          bot: true,
        },
        member: {
          displayName: 'Bob | Test System',
        },
      };

      // Mock personalityAuth to allow the proxy request
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: true,
        authUserId: 'real-user-456',
        authUsername: 'Bob',
        isProxySystem: true,
        isDM: false,
        isNSFW: true,
      });

      // Mock webhook user tracker
      webhookUserTracker.getRealUserId.mockReturnValue('real-user-456');
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.checkProxySystemAuthentication.mockReturnValue({
        isAuthenticated: true,
        userId: 'real-user-456',
        username: 'Bob',
      });

      // Mock threadHandler
      threadHandler.detectThread.mockReturnValueOnce({ isThread: false });
      threadHandler.buildThreadWebhookOptions.mockReturnValueOnce({
        userId: 'real-user-456',
      });

      // Call the handler
      await personalityHandler.handlePersonalityInteraction(
        pluralKitMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify AI service was called with isProxyMessage flag
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        expect.any(String),
        expect.objectContaining({
          isProxyMessage: true,
          userName: 'Bob | Test System', // Should use display name only for PK
        })
      );
    });

    test('should handle regular users without proxy message formatting', async () => {
      // Regular Discord message (not PluralKit)
      webhookUserTracker.getRealUserId.mockReturnValue('user-123');
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);

      // Call the handler
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify AI service was called without isProxyMessage flag
      expect(getAiResponse).toHaveBeenCalledWith(
        'test-personality',
        expect.any(String),
        expect.objectContaining({
          isProxyMessage: false,
          userName: 'TestUser (testuser)', // Regular format with username
        })
      );

      // Verify conversation tracked with regular user ID
      expect(conversationManager.recordConversation).toHaveBeenCalledWith(
        'user-123',
        'test-channel-id',
        expect.any(String),
        'test-personality',
        false,
        true // isMentionOnly is true for guild channels without autoresponse
      );
    });

    test('should use webhook options with real user ID for PluralKit', async () => {
      // Mock a PluralKit webhook message
      const pluralKitMessage = {
        ...mockMessage,
        webhookId: 'pk-webhook-123',
        author: {
          id: 'pk-webhook-123',
          username: 'Charlie | Rainbow System',
          bot: true,
        },
      };

      // Mock personalityAuth to allow the proxy request
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: true,
        authUserId: 'real-user-789',
        authUsername: 'Charlie',
        isProxySystem: true,
        isDM: false,
        isNSFW: true,
      });

      webhookUserTracker.getRealUserId.mockReturnValue('real-user-789');
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.checkProxySystemAuthentication.mockReturnValue({
        isAuthenticated: true,
        userId: 'real-user-789',
        username: 'Charlie',
      });

      // Mock threadHandler
      threadHandler.detectThread.mockReturnValueOnce({ isThread: false });
      threadHandler.buildThreadWebhookOptions.mockReturnValueOnce({
        userId: 'real-user-789',
      });

      await personalityHandler.handlePersonalityInteraction(
        pluralKitMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify webhook manager was called with real user ID in options
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        expect.any(Object), // channel
        expect.any(String), // AI response
        expect.any(Object), // personality
        expect.objectContaining({
          userId: 'real-user-789', // Real user ID in webhook options
        }),
        expect.any(Object) // original message
      );
    });
  });

  describe('PluralKit Authentication', () => {
    beforeEach(() => {
      // Reset mocks for PluralKit-specific tests
      webhookUserTracker.isProxySystemWebhook.mockClear();
      webhookUserTracker.checkProxySystemAuthentication.mockClear();
      webhookUserTracker.getRealUserId.mockClear();

      // Ensure channel is NSFW to bypass NSFW checks
      channelUtils.isChannelNSFW.mockReturnValue(true);

      // Mock auth module for NSFW verification
      // NSFW checks now handled by mocked authManager

      // Default getRealUserId behavior (returns null for non-PluralKit messages)
      webhookUserTracker.getRealUserId.mockReturnValue(null);
    });

    it('should check authentication for PluralKit proxy messages', async () => {
      const pluralkitMessage = {
        ...mockMessage,
        webhookId: 'pk-webhook-id',
        author: {
          id: 'pk-webhook-id',
          username: 'PluralKit',
          bot: true,
          discriminator: '0000',
        },
      };

      // Mock personalityAuth to return not allowed for PluralKit authentication
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: false,
        errorMessage: `⚠️ **Authentication Required for PluralKit Users**\n\nTo use AI personalities through PluralKit, the original Discord user must authenticate first.\n\nPlease send \`${botPrefix} auth start\` directly (not through PluralKit) to begin setting up your account.`,
        reason: 'pluralkit_not_authenticated',
        shouldReply: true,
      });

      await personalityHandler.handlePersonalityInteraction(
        pluralkitMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify authentication error was sent
      expect(personalityAuth.sendAuthError).toHaveBeenCalledWith(
        pluralkitMessage,
        expect.stringContaining('Authentication Required for PluralKit Users'),
        'pluralkit_not_authenticated'
      );

      // Verify no AI response was generated
      expect(getAiResponse).not.toHaveBeenCalled();
    });

    it('should allow authenticated PluralKit users to use personalities', async () => {
      // Mock as PluralKit webhook with authenticated user
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(true);
      webhookUserTracker.checkProxySystemAuthentication.mockReturnValue({
        isAuthenticated: true,
        userId: 'original-user-123',
        username: 'OriginalUser',
      });
      webhookUserTracker.getRealUserId.mockReturnValue('original-user-123');

      const pluralkitMessage = {
        ...mockMessage,
        webhookId: 'pk-webhook-id',
        author: {
          id: 'pk-webhook-id',
          username: 'PluralKit',
          bot: true,
          discriminator: '0000',
        },
      };

      await personalityHandler.handlePersonalityInteraction(
        pluralkitMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Wait for async operations
      await waitForAsyncOperations();

      // Verify AI response was generated
      expect(getAiResponse).toHaveBeenCalled();
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalled();

      // Verify no authentication error message
      expect(pluralkitMessage.reply).not.toHaveBeenCalledWith(
        expect.stringContaining('Authentication Required')
      );
    });

    it('should not check PluralKit authentication for non-proxy messages', async () => {
      // Mock as regular user message (not PluralKit)
      webhookUserTracker.isProxySystemWebhook.mockReturnValue(false);

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Wait for async operations
      await waitForAsyncOperations();

      // Verify PluralKit authentication was not checked
      expect(webhookUserTracker.checkProxySystemAuthentication).not.toHaveBeenCalled();

      // Verify normal flow continued
      expect(getAiResponse).toHaveBeenCalled();
    });

    it('should show custom error message for unauthenticated PluralKit users', async () => {
      const pluralkitMessage = {
        ...mockMessage,
        webhookId: 'pk-webhook-id',
        author: {
          id: 'pk-webhook-id',
          username: 'SystemName',
          bot: true,
          discriminator: '0000',
        },
      };

      // Mock personalityAuth to return the exact PluralKit error message
      personalityAuth.checkPersonalityAuth.mockResolvedValueOnce({
        isAllowed: false,
        errorMessage: `⚠️ **Authentication Required for PluralKit Users**\n\nTo use AI personalities through PluralKit, the original Discord user must authenticate first.\n\nPlease send \`${botPrefix} auth start\` directly (not through PluralKit) to begin setting up your account.`,
        reason: 'pluralkit_not_authenticated',
        shouldReply: true,
      });

      await personalityHandler.handlePersonalityInteraction(
        pluralkitMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify the exact error message format
      expect(personalityAuth.sendAuthError).toHaveBeenCalledWith(
        pluralkitMessage,
        `⚠️ **Authentication Required for PluralKit Users**\n\nTo use AI personalities through PluralKit, the original Discord user must authenticate first.\n\nPlease send \`${botPrefix} auth start\` directly (not through PluralKit) to begin setting up your account.`,
        'pluralkit_not_authenticated'
      );
    });
  });

  // Tests for markdown image link processing
  describe('Markdown Image Link Processing', () => {
    it('should convert markdown image links to media handler format', async () => {
      // Mock AI response with markdown image link
      getAiResponse.mockResolvedValue(
        'Here is your generated image [https://files.example.com/image123.png](https://files.example.com/image123.png)'
      );

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();

      // Verify the webhook was called with processed content
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'Here is your generated image\n[Image: https://files.example.com/image123.png]',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should handle multiple images but only process the last one', async () => {
      // Mock AI response with multiple markdown image links
      getAiResponse.mockResolvedValue(
        'First image [https://files.example.com/image1.jpg](https://files.example.com/image1.jpg) and second [https://files.example.com/image2.png](https://files.example.com/image2.png)'
      );

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();

      // Verify only the last image was processed
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'First image [https://files.example.com/image1.jpg](https://files.example.com/image1.jpg) and second\n[Image: https://files.example.com/image2.png]',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should not modify responses without markdown image links', async () => {
      // Mock AI response without markdown image links
      getAiResponse.mockResolvedValue('This is a regular response with no images');

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();

      // Verify the response was not modified
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'This is a regular response with no images',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should not process markdown links with mismatched URLs', async () => {
      // Mock AI response with mismatched URLs in markdown
      getAiResponse.mockResolvedValue(
        'Bad link [https://files.example.com/image1.png](https://files.example.com/image2.png)'
      );

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();

      // Verify the response was not modified
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        'Bad link [https://files.example.com/image1.png](https://files.example.com/image2.png)',
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });

    it('should handle various image formats', async () => {
      const imageFormats = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

      for (const format of imageFormats) {
        jest.clearAllMocks();

        getAiResponse.mockResolvedValue(
          `Image in ${format} format [https://files.example.com/test.${format}](https://files.example.com/test.${format})`
        );

        await personalityHandler.handlePersonalityInteraction(
          mockMessage,
          mockPersonality,
          null,
          mockClient
        );

        await waitForAsyncOperations();

        expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
          mockMessage.channel,
          `Image in ${format} format\n[Image: https://files.example.com/test.${format}]`,
          mockPersonality,
          expect.any(Object),
          mockMessage
        );
      }
    });

    it('should handle non-string AI responses gracefully', async () => {
      // Mock AI response that's not a string
      getAiResponse.mockResolvedValue({ text: 'complex response' });

      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      await waitForAsyncOperations();

      // Verify the response was passed through unchanged
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
        mockMessage.channel,
        { text: 'complex response' },
        mockPersonality,
        expect.any(Object),
        mockMessage
      );
    });
  });

  describe('Request Deduplication Error Recovery', () => {
    it('should remove request from tracking on AI service error to allow retries', async () => {
      // Arrange - Set up the request key
      const mockRequestKey = 'user-123-channel-123-test-personality';
      requestTracker.trackRequest.mockReturnValue(mockRequestKey);

      // Mock AI service to throw an error
      getAiResponse.mockRejectedValue(new Error('500 Internal Server Error'));

      // Act - Call the handler
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Assert - Verify request was tracked
      expect(requestTracker.trackRequest).toHaveBeenCalledWith(
        mockMessage.author.id,
        mockMessage.channel.id,
        mockPersonality.fullName
      );

      // Verify request was removed from tracking despite the error
      expect(requestTracker.removeRequest).toHaveBeenCalledWith(mockRequestKey);

      // Verify error message was sent to user
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Sorry, I encountered an error while processing your message. Check logs for details.'
      );
    });

    it('should remove request from tracking even when error reply fails', async () => {
      // Arrange
      const mockRequestKey = 'user-123-channel-123-test-personality';
      requestTracker.trackRequest.mockReturnValue(mockRequestKey);

      // Mock both AI service and reply to throw errors
      getAiResponse.mockRejectedValue(new Error('API Error'));
      mockMessage.reply.mockRejectedValue(new Error('Cannot send message'));

      // Act
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Assert - Verify request was still removed from tracking
      expect(requestTracker.removeRequest).toHaveBeenCalledWith(mockRequestKey);
    });

    it('should allow retry after error by not blocking subsequent requests', async () => {
      // Arrange
      const mockRequestKey = 'user-123-channel-123-test-personality';

      // First call returns key, second call also returns key (not blocked)
      requestTracker.trackRequest
        .mockReturnValueOnce(mockRequestKey)
        .mockReturnValueOnce(mockRequestKey);

      // First call fails, second succeeds
      getAiResponse
        .mockRejectedValueOnce(new Error('500 Error'))
        .mockResolvedValueOnce('Success response');

      // Act - First attempt (fails)
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Verify first attempt removed the request
      expect(requestTracker.removeRequest).toHaveBeenNthCalledWith(1, mockRequestKey);

      // Act - Second attempt (succeeds)
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Assert - Verify both attempts tracked requests
      expect(requestTracker.trackRequest).toHaveBeenCalledTimes(2);

      // Verify second attempt also cleaned up
      expect(requestTracker.removeRequest).toHaveBeenNthCalledWith(2, mockRequestKey);

      // Verify success on second attempt
      expect(webhookManager.sendWebhookMessage).toHaveBeenCalledTimes(1);
    });

    it('should not remove request if trackRequest returns null (duplicate prevention)', async () => {
      // Arrange - trackRequest returns null to indicate duplicate
      requestTracker.trackRequest.mockReturnValue(null);

      // Act
      await personalityHandler.handlePersonalityInteraction(
        mockMessage,
        mockPersonality,
        null,
        mockClient
      );

      // Assert - Verify no further processing occurred
      expect(getAiResponse).not.toHaveBeenCalled();
      expect(webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
      expect(requestTracker.removeRequest).not.toHaveBeenCalled();
    });
  });
});
