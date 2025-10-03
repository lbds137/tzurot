describe('Pluralkit Reply Integration', () => {
  let messageHandler;
  let personalityHandler;
  let webhookUserTracker;
  let pluralkitReplyTracker;
  let pluralkitMessageStore;
  let mockLogger;
  let mockClient;
  let messageTrackerHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    jest.doMock('../../../src/logger', () => mockLogger);
    
    // Mock dependencies
    personalityHandler = {
      handlePersonalityInteraction: jest.fn()
    };
    jest.doMock('../../../src/handlers/personalityHandler', () => personalityHandler);
    
    // Mock client
    mockClient = {
      user: { id: 'bot-123' }
    };
    
    // Load modules after mocking
    messageHandler = require('../../../src/handlers/messageHandler');
    webhookUserTracker = require('../../../src/utils/webhookUserTracker');
    pluralkitReplyTracker = require('../../../src/utils/pluralkitReplyTracker');
    pluralkitMessageStore = require('../../../src/utils/pluralkitMessageStore').instance;
    messageTrackerHandler = require('../../../src/handlers/messageTrackerHandler');
    
    // Stop auto-cleanup intervals
    pluralkitReplyTracker.stopCleanup();
    pluralkitReplyTracker.clear();
    messageTrackerHandler.stopCleanupInterval();
    
    // Mock messageTrackerHandler to verify handled messages
    messageTrackerHandler.trackMessageInChannel = jest.fn();
    messageTrackerHandler.markMessageAsHandled = jest.fn();
  });
  
  afterEach(() => {
    // Clean up intervals
    messageTrackerHandler.stopCleanupInterval();
  });
  
  it('should handle Pluralkit reply to personality message', async () => {
    // 1. Track a pending reply when user replies to personality
    const originalReply = {
      id: 'original-reply-123',
      author: { 
        id: 'user-456',
        bot: false,
        username: 'TestUser'
      },
      content: 'Lila: Hello personality!',
      channel: { 
        id: 'channel-789',
        isDMBased: () => false
      },
      reference: {
        messageId: 'personality-msg-999'
      }
    };
    
    const personality = {
      fullName: 'test-personality',
      displayName: 'Test'
    };
    
    // Track the pending reply
    pluralkitReplyTracker.trackPendingReply({
      channelId: originalReply.channel.id,
      userId: originalReply.author.id,
      content: originalReply.content,
      personality: personality,
      referencedMessageId: 'personality-msg-999',
      originalMessageId: originalReply.id
    });
    
    // 2. Pluralkit webhook message arrives
    const pluralkitMessage = {
      id: 'pk-msg-456',
      webhookId: 'pk-webhook-789',
      applicationId: '466378653216014359', // Pluralkit bot ID
      author: {
        bot: true,
        username: 'Lila | System',
        id: 'pk-webhook-user-123'
      },
      content: 'Hello personality!', // Pluralkit stripped the prefix
      channel: originalReply.channel,
      reference: null // Pluralkit doesn't preserve references
    };
    
    // Mock isProxySystemWebhook to return true
    jest.spyOn(webhookUserTracker, 'isProxySystemWebhook').mockReturnValue(true);
    
    // 3. Process the Pluralkit message
    await messageHandler.handleMessage(pluralkitMessage, mockClient, {});
    
    // 4. Verify the personality handler was called with the correct personality
    expect(personalityHandler.handlePersonalityInteraction).toHaveBeenCalledWith(
      pluralkitMessage,
      personality,
      null,
      mockClient
    );
    
    // 5. Verify the association was logged
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Found pending reply context for Pluralkit message from user user-456')
    );
    
    // 6. Verify the original message was marked as handled
    expect(messageTrackerHandler.markMessageAsHandled).toHaveBeenCalledWith(
      { 
        id: 'original-reply-123',
        channel: { id: 'channel-789' }
      }
    );
  });
  
  it('should not process non-matching Pluralkit messages', async () => {
    // Track a pending reply
    pluralkitReplyTracker.trackPendingReply({
      channelId: 'channel-789',
      userId: 'user-456', 
      content: 'Lila: Hello personality!',
      personality: { fullName: 'test-personality' },
      referencedMessageId: 'msg-999'
    });
    
    // Different content Pluralkit message
    const pluralkitMessage = {
      id: 'pk-msg-456',
      webhookId: 'pk-webhook-789',
      applicationId: '466378653216014359',
      author: {
        bot: true,
        username: 'Lila | System',
        id: 'pk-webhook-user-123'
      },
      content: 'Different message entirely',
      channel: { 
        id: 'channel-789',
        isDMBased: () => false
      }
    };
    
    jest.spyOn(webhookUserTracker, 'isProxySystemWebhook').mockReturnValue(true);
    
    await messageHandler.handleMessage(pluralkitMessage, mockClient, {});
    
    // Should not call personality handler
    expect(personalityHandler.handlePersonalityInteraction).not.toHaveBeenCalled();
  });
});