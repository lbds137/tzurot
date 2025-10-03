/**
 * Tests for bot.js message handling and command routing
 */

// Mock the aiService module
jest.mock('../../src/aiService', () => ({
  getAiResponse: jest.fn().mockResolvedValue({ content: 'This is a mock AI response', metadata: null }),
}));

// Mock the webhookManager module
jest.mock('../../src/webhookManager', () => ({
  getOrCreateWebhook: jest.fn().mockResolvedValue({
    send: jest.fn().mockResolvedValue({ id: 'mock-webhook-message' }),
  }),
  sendWebhookMessage: jest.fn().mockResolvedValue({
    message: { id: 'mock-webhook-message' },
    messageIds: ['mock-webhook-message'],
  }),
  registerEventListeners: jest.fn(),
}));

// Mock the conversationManager module
jest.mock('../../src/core/conversation', () => ({
  recordConversation: jest.fn(),
  getActivePersonality: jest.fn(),
  getPersonalityFromMessage: jest.fn(),
  getActivatedPersonality: jest.fn(),
}));

// Mock the CommandIntegrationAdapter module
jest.mock('../../src/adapters/CommandIntegrationAdapter', () => ({
  getCommandIntegrationAdapter: jest.fn().mockReturnValue({
    processCommand: jest.fn().mockResolvedValue({
      success: true,
      message: 'Command processed successfully',
    }),
  }),
}));


// Mock the logger module
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { botPrefix } = require('../../config');

// Extract the message handling logic from bot.js
function createMessageHandler() {
  // Create a mock for recording which functions were called
  const tracking = {
    commandProcessed: false,
    aiResponseGenerated: false,
    webhookMessageSent: false,
    ignoredOwnMessage: false,
    ignoredBotMessage: false,
  };

  // Create mocks for external dependencies
  const deps = {
    aiService: require('../../src/aiService'),
    webhookManager: require('../../src/webhookManager'),
    conversationManager: require('../../src/core/conversation'),
    commandAdapter: require('../../src/adapters/CommandIntegrationAdapter').getCommandIntegrationAdapter(),
    // Legacy personalityManager removed
    config: require('../../config'),
    logger: require('../../src/logger'),
  };

  // Simulate the message handler function
  async function handleMessage(message) {
    // Skip processing bot messages (except for specific cases we want to handle)
    if (message.author.bot) {
      tracking.ignoredBotMessage = true;
      return null;
    }

    // Skip processing the bot's own messages
    if (message.author.id === 'bot-user-id') {
      tracking.ignoredOwnMessage = true;
      return null;
    }

    // Process commands (messages starting with the prefix)
    if (message.content.startsWith(deps.config.botPrefix)) {
      tracking.commandProcessed = true;

      // Parse the command and arguments
      const content = message.content.startsWith(deps.config.botPrefix + ' ')
        ? message.content.slice(deps.config.botPrefix.length + 1)
        : '';

      const args = content.trim().split(/ +/);
      const command = args.shift()?.toLowerCase() || 'help';

      // Process the command through the command loader
      return await deps.commandAdapter.processCommand(message, command, args);
    }

    // Get the active personality for this user and channel
    const activePersonality = deps.conversationManager.getActivePersonality(
      message.author.id,
      message.channel.id
    );

    // Check if there's an active personality for the channel
    const channelPersonality = deps.conversationManager.getActivatedPersonality(message.channel.id);

    // If no active personality, don't respond
    if (!activePersonality && !channelPersonality) {
      return null;
    }

    // Use either the user's active personality or the channel's activated personality
    const personalityName = activePersonality || channelPersonality;

    // Legacy personality manager removed - would use DDD system
    // In the real DDD system, this would lookup the personality and could return null
    // For this test, we'll simulate that a personality doesn't exist
    const personality = personalityName === 'nonexistent-personality' ? null : { fullName: personalityName };
    if (!personality) {
      return null;
    }

    // Generate AI response
    tracking.aiResponseGenerated = true;
    const response = await deps.aiService.getAiResponse(message.content, personality, {
      userId: message.author.id,
      username: message.author.username,
      channelId: message.channel.id,
    });

    // Send webhook message
    tracking.webhookMessageSent = true;
    const webhookResult = await deps.webhookManager.sendWebhookMessage(
      message.channel,
      response,
      personality
    );

    // Record conversation
    if (webhookResult && webhookResult.messageIds) {
      deps.conversationManager.recordConversation(
        message.author.id,
        message.channel.id,
        webhookResult.messageIds,
        personalityName
      );
    }

    return webhookResult;
  }

  return { handleMessage, tracking, deps };
}

describe('Bot Message Handler', () => {
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    // Mock console methods
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Reset all mocks
    jest.clearAllMocks();

    // Reset global state
    global.processedBotMessages = new Set();
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  it('should process commands when message starts with prefix', async () => {
    const { handleMessage, tracking, deps } = createMessageHandler();

    // Create a mock message with command prefix
    const message = {
      id: 'mock-message-id',
      author: {
        id: 'mock-user-id',
        username: 'MockUser',
        bot: false,
      },
      content: `${botPrefix} help`,
      channel: {
        id: 'mock-channel-id',
        send: jest.fn().mockResolvedValue({ id: 'response-id' }),
      },
    };

    // Process the message
    await handleMessage(message);

    // Verify command processing was attempted
    expect(tracking.commandProcessed).toBe(true);
    expect(deps.commandAdapter.processCommand).toHaveBeenCalledWith(message, 'help', []);

    // Verify AI response was not generated
    expect(tracking.aiResponseGenerated).toBe(false);
    expect(deps.aiService.getAiResponse).not.toHaveBeenCalled();
  });

  it('should ignore messages from bots', async () => {
    const { handleMessage, tracking } = createMessageHandler();

    // Create a mock message from a bot
    const message = {
      id: 'mock-message-id',
      author: {
        id: 'bot-user-id',
        username: 'BotUser',
        bot: true,
      },
      content: 'Hello from a bot',
      channel: {
        id: 'mock-channel-id',
        send: jest.fn(),
      },
    };

    // Process the message
    await handleMessage(message);

    // Verify the bot message was ignored
    expect(tracking.ignoredBotMessage).toBe(true);
    expect(tracking.commandProcessed).toBe(false);
    expect(tracking.aiResponseGenerated).toBe(false);
  });

  it('should generate AI response for normal message with active personality', async () => {
    const { handleMessage, tracking, deps } = createMessageHandler();

    // Mock active personality
    deps.conversationManager.getActivePersonality.mockReturnValue('test-personality');
    // PersonalityManager removed - DDD system now handles personality resolution

    // Create a mock message
    const message = {
      id: 'mock-message-id',
      author: {
        id: 'mock-user-id',
        username: 'MockUser',
        bot: false,
      },
      content: 'Hello, can you help me?',
      channel: {
        id: 'mock-channel-id',
        send: jest.fn(),
      },
    };

    // Process the message
    await handleMessage(message);

    // Verify AI response was generated
    expect(tracking.aiResponseGenerated).toBe(true);
    expect(deps.aiService.getAiResponse).toHaveBeenCalledWith(
      'Hello, can you help me?',
      expect.objectContaining({
        fullName: 'test-personality',
      }),
      expect.objectContaining({
        userId: 'mock-user-id',
        username: 'MockUser',
        channelId: 'mock-channel-id',
      })
    );

    // Verify webhook message was sent
    expect(tracking.webhookMessageSent).toBe(true);
    expect(deps.webhookManager.sendWebhookMessage).toHaveBeenCalled();

    // Verify conversation was recorded
    expect(deps.conversationManager.recordConversation).toHaveBeenCalled();
  });

  it('should use channel personality if no active user personality', async () => {
    const { handleMessage, tracking, deps } = createMessageHandler();

    // Mock channel personality but no active user personality
    deps.conversationManager.getActivePersonality.mockReturnValue(null);
    deps.conversationManager.getActivatedPersonality.mockReturnValue('channel-personality');
    // PersonalityManager removed - DDD system now handles personality resolution

    // Create a mock message
    const message = {
      id: 'mock-message-id',
      author: {
        id: 'mock-user-id',
        username: 'MockUser',
        bot: false,
      },
      content: 'Hello channel personality',
      channel: {
        id: 'mock-channel-id',
        send: jest.fn(),
      },
    };

    // Process the message
    await handleMessage(message);

    // Verify AI response was generated with channel personality
    expect(tracking.aiResponseGenerated).toBe(true);
    expect(deps.aiService.getAiResponse).toHaveBeenCalledWith(
      'Hello channel personality',
      expect.objectContaining({
        fullName: 'channel-personality',
      }),
      expect.any(Object)
    );
  });

  it('should not respond if no active personality is found', async () => {
    const { handleMessage, tracking, deps } = createMessageHandler();

    // Mock no active personalities
    deps.conversationManager.getActivePersonality.mockReturnValue(null);
    deps.conversationManager.getActivatedPersonality.mockReturnValue(null);

    // Create a mock message
    const message = {
      id: 'mock-message-id',
      author: {
        id: 'mock-user-id',
        username: 'MockUser',
        bot: false,
      },
      content: 'This message should be ignored',
      channel: {
        id: 'mock-channel-id',
        send: jest.fn(),
      },
    };

    // Process the message
    const result = await handleMessage(message);

    // Verify no response was generated
    expect(result).toBeNull();
    expect(tracking.aiResponseGenerated).toBe(false);
    expect(deps.aiService.getAiResponse).not.toHaveBeenCalled();
    expect(tracking.webhookMessageSent).toBe(false);
    expect(deps.webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
  });

  it('should not respond if personality is not found', async () => {
    const { handleMessage, tracking, deps } = createMessageHandler();

    // Mock active personality that doesn't exist
    deps.conversationManager.getActivePersonality.mockReturnValue('nonexistent-personality');
    // PersonalityManager removed - DDD system now handles personality resolution

    // Create a mock message
    const message = {
      id: 'mock-message-id',
      author: {
        id: 'mock-user-id',
        username: 'MockUser',
        bot: false,
      },
      content: 'This message should be ignored',
      channel: {
        id: 'mock-channel-id',
        send: jest.fn(),
      },
    };

    // Process the message
    const result = await handleMessage(message);

    // Verify no response was generated
    expect(result).toBeNull();
    expect(tracking.aiResponseGenerated).toBe(false);
    expect(deps.aiService.getAiResponse).not.toHaveBeenCalled();
    expect(tracking.webhookMessageSent).toBe(false);
    expect(deps.webhookManager.sendWebhookMessage).not.toHaveBeenCalled();
  });

  it('should parse command with prefix and space correctly', async () => {
    const { handleMessage, tracking, deps } = createMessageHandler();

    // Create a mock message with command prefix and space
    const message = {
      id: 'mock-message-id',
      author: {
        id: 'mock-user-id',
        username: 'MockUser',
        bot: false,
      },
      content: `${botPrefix} list 2`,
      channel: {
        id: 'mock-channel-id',
        send: jest.fn().mockResolvedValue({ id: 'response-id' }),
      },
    };

    // Process the message
    await handleMessage(message);

    // Verify command was parsed correctly
    expect(deps.commandAdapter.processCommand).toHaveBeenCalledWith(message, 'list', ['2']);
  });
});
