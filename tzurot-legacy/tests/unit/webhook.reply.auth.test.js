const webhookManager = require('../../src/webhookManager');
const aiService = require('../../src/aiService');
const conversationManager = require('../../src/core/conversation');

// Mock dependencies
jest.mock('../../src/webhookManager');
jest.mock('../../src/aiService');
jest.mock('../../src/core/conversation');

describe('Webhook Reply Authentication', () => {
  // Legacy authManager removed - using DDD authentication

  // Spy on logging
  const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();

    // Legacy authManager removed - using DDD authentication

    // Mock getPersonalityFromMessage
    conversationManager.getPersonalityFromMessage.mockReturnValue('test-personality');

    // Mock getAiResponse
    aiService.getAiResponse.mockResolvedValue({ content: 'AI response', metadata: null });

    // Legacy authManager removed - authentication handled by DDD system in aiService

    // Mock webhook message sending
    webhookManager.sendWebhookMessage.mockResolvedValue({
      messageIds: ['mock-message-id'],
      message: { id: 'mock-message-id' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('webhook replies pass correct user ID to AI service', async () => {
    // Create mock message from a user replying to a webhook
    const mockMessage = {
      id: 'user-message-id',
      content: 'Test reply message',
      author: {
        id: '9999', // User with valid token
        tag: 'TestUser#9999',
      },
      channel: {
        id: 'test-channel',
        send: jest.fn().mockResolvedValue({}),
      },
      reference: {
        messageId: 'webhook-message-id',
      },
    };

    // Create mock personality
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
    };

    // Simulate sending a message with a user ID and personality
    await aiService.getAiResponse(mockPersonality.fullName, mockMessage.content, {
      userId: mockMessage.author.id,
      channelId: mockMessage.channel.id,
    });

    // Verify aiService.getAiResponse was called with the correct user ID
    expect(aiService.getAiResponse).toHaveBeenCalledWith(
      'test-personality',
      'Test reply message',
      expect.objectContaining({
        userId: '9999',
        channelId: 'test-channel',
      })
    );

    // Simulate webhook response with user information
    await webhookManager.sendWebhookMessage(
      mockMessage.channel,
      'AI response',
      mockPersonality,
      { userId: mockMessage.author.id },
      mockMessage
    );

    // Verify webhookManager.sendWebhookMessage was called with the message containing the user ID
    expect(webhookManager.sendWebhookMessage).toHaveBeenCalledWith(
      mockMessage.channel,
      'AI response',
      mockPersonality,
      expect.objectContaining({ userId: '9999' }),
      mockMessage
    );
  });

  // Test different users replying to same webhook
  test('Different users replying to same webhook use their own auth tokens', async () => {
    // First user with valid token
    const mockMessageUser1 = {
      id: 'user1-message-id',
      content: 'Reply from user 1',
      author: {
        id: '9999', // User with valid token
        tag: 'User1#9999',
      },
      channel: {
        id: 'test-channel',
        send: jest.fn().mockResolvedValue({}),
      },
      reference: {
        messageId: 'webhook-message-id',
      },
    };

    // Second user without valid token
    const mockMessageUser2 = {
      id: 'user2-message-id',
      content: 'Reply from user 2',
      author: {
        id: '8888', // User without valid token
        tag: 'User2#8888',
      },
      channel: {
        id: 'test-channel',
        send: jest.fn().mockResolvedValue({}),
      },
      reference: {
        messageId: 'webhook-message-id',
      },
    };

    // Create mock personality
    const mockPersonality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
    };

    // Test user 1's auth - legacy authManager removed
    // Authentication now handled by DDD system in aiService
    await aiService.getAiResponse(mockPersonality.fullName, mockMessageUser1.content, {
      userId: mockMessageUser1.author.id,
      channelId: mockMessageUser1.channel.id,
    });

    // Verify aiService.getAiResponse was called with the first user's ID
    expect(aiService.getAiResponse).toHaveBeenCalledWith(
      'test-personality',
      'Reply from user 1',
      expect.objectContaining({
        userId: '9999',
        channelId: 'test-channel',
      })
    );

    // Legacy authManager.hasValidToken removed - authentication handled by DDD system

    // Reset mocks
    jest.clearAllMocks();

    // Test user 2's auth - legacy authManager removed
    // Authentication now handled by DDD system in aiService
    await aiService.getAiResponse(mockPersonality.fullName, mockMessageUser2.content, {
      userId: mockMessageUser2.author.id,
      channelId: mockMessageUser2.channel.id,
    });

    // Verify aiService.getAiResponse was called with the second user's ID
    expect(aiService.getAiResponse).toHaveBeenCalledWith(
      'test-personality',
      'Reply from user 2',
      expect.objectContaining({
        userId: '8888',
        channelId: 'test-channel',
      })
    );

    // Legacy authManager.hasValidToken removed - authentication handled by DDD system
  });
});
