/**
 * Application Module Mocks
 * Consolidated mocks for internal application modules
 */

/**
 * Mock Logger
 */
function createLoggerMock(options = {}) {
  const logLevel = options.level || 'info';
  const shouldLog = options.shouldLog !== false;

  const createLogFunction = level =>
    jest.fn().mockImplementation((...args) => {
      if (shouldLog && options.debug) {
        console.log(`[MOCK ${level.toUpperCase()}]`, ...args);
      }
    });

  return {
    error: createLogFunction('error'),
    warn: createLogFunction('warn'),
    info: createLogFunction('info'),
    debug: createLogFunction('debug'),
    verbose: createLogFunction('verbose'),
    log: createLogFunction('log'),
  };
}

/**
 * Mock Personality Manager
 */
function createPersonalityManagerMock(options = {}) {
  const defaultPersonality = {
    fullName: 'test-personality',
    displayName: 'Test Personality',
    avatarUrl: 'https://example.com/avatar.png',
    ...options.defaultPersonality,
  };

  const personalities = new Map();
  const aliases = new Map();
  const activatedChannels = new Map();

  // Add default personality
  personalities.set(defaultPersonality.fullName, defaultPersonality);

  return {
    // Core personality management
    getPersonality: jest.fn().mockImplementation(name => {
      return personalities.get(name) || null;
    }),

    addPersonality: jest.fn().mockImplementation(async (userId, personalityData) => {
      personalities.set(personalityData.fullName, personalityData);
      return { success: true };
    }),

    removePersonality: jest.fn().mockImplementation(async (userId, personalityName) => {
      const removed = personalities.delete(personalityName);
      return { success: removed };
    }),

    listPersonalitiesForUser: jest.fn().mockImplementation(userId => {
      return Array.from(personalities.values());
    }),

    // Register personality function (used by add command)
    registerPersonality: jest
      .fn()
      .mockImplementation(async (userId, fullName, data, fetchInfo = true) => {
        const personality = {
          fullName,
          displayName: data?.displayName || fullName,
          avatarUrl: data?.avatarUrl || 'https://example.com/avatar.png',
          description: data?.description || '',
          createdBy: userId,
          createdAt: Date.now(),
          ...data,
        };
        personalities.set(fullName, personality);
        return { personality };
      }),

    // Alias management
    getPersonalityByAlias: jest.fn().mockImplementation(alias => {
      return aliases.get(alias) || null;
    }),

    setPersonalityAlias: jest.fn().mockImplementation(async (userId, personalityName, alias) => {
      aliases.set(alias, personalityName);
      return { success: true };
    }),

    // Channel activation
    activatePersonality: jest.fn().mockImplementation((channelId, personalityName) => {
      activatedChannels.set(channelId, personalityName);
      return true;
    }),

    deactivatePersonality: jest.fn().mockImplementation(channelId => {
      return activatedChannels.delete(channelId);
    }),

    getActivatedPersonality: jest.fn().mockImplementation(channelId => {
      return activatedChannels.get(channelId) || null;
    }),

    // Test utilities
    _addTestPersonality: personality => {
      personalities.set(personality.fullName, personality);
    },
    _clearAll: () => {
      personalities.clear();
      aliases.clear();
      activatedChannels.clear();
      personalities.set(defaultPersonality.fullName, defaultPersonality);
    },
  };
}

/**
 * Mock Conversation Manager
 */
function createConversationManagerMock(options = {}) {
  const conversations = new Map();
  const autoResponseChannels = new Set();

  return {
    recordConversation: jest.fn().mockImplementation((messageId, channelId, personalityName) => {
      conversations.set(messageId, { channelId, personalityName, timestamp: Date.now() });
    }),

    getActivePersonality: jest.fn().mockImplementation(channelId => {
      // Find the most recent conversation in this channel
      for (const [msgId, conv] of conversations.entries()) {
        if (conv.channelId === channelId) {
          return conv.personalityName;
        }
      }
      return null;
    }),

    getPersonalityFromMessage: jest.fn().mockImplementation(messageId => {
      const conv = conversations.get(messageId);
      return conv ? conv.personalityName : null;
    }),

    clearConversation: jest.fn().mockImplementation(channelId => {
      let cleared = false;
      for (const [msgId, conv] of conversations.entries()) {
        if (conv.channelId === channelId) {
          conversations.delete(msgId);
          cleared = true;
        }
      }
      return cleared;
    }),

    // Auto-response management
    enableAutoResponse: jest.fn().mockImplementation(channelId => {
      autoResponseChannels.add(channelId);
    }),

    disableAutoResponse: jest.fn().mockImplementation(channelId => {
      return autoResponseChannels.delete(channelId);
    }),

    isAutoResponseEnabled: jest.fn().mockImplementation(channelId => {
      return autoResponseChannels.has(channelId);
    }),

    // Channel activation
    activatePersonality: jest.fn().mockImplementation((channelId, personalityName) => {
      conversations.set(`activated-${channelId}`, {
        channelId,
        personalityName,
        timestamp: Date.now(),
        activated: true,
      });
    }),

    deactivatePersonality: jest.fn().mockImplementation(channelId => {
      return conversations.delete(`activated-${channelId}`);
    }),

    getActivatedPersonality: jest.fn().mockImplementation(channelId => {
      const conv = conversations.get(`activated-${channelId}`);
      return conv ? conv.personalityName : null;
    }),

    // Utility methods
    saveAllData: jest.fn().mockResolvedValue(true),

    // Test utilities
    _clearAll: () => {
      conversations.clear();
      autoResponseChannels.clear();
    },
  };
}

/**
 * Mock Webhook Manager
 */
function createWebhookManagerMock(options = {}) {
  const webhooks = new Map();

  return {
    sendWebhookMessage: jest.fn().mockImplementation(async (channel, content, personalityName) => {
      return {
        id: `webhook-msg-${Date.now()}`,
        content: typeof content === 'string' ? content : '',
        embeds: content?.embeds || [],
        author: {
          username: personalityName || 'Mock Personality',
          avatar: 'https://example.com/avatar.png',
        },
      };
    }),

    createWebhookForChannel: jest.fn().mockImplementation(async channel => {
      const webhook = {
        id: `webhook-${Date.now()}`,
        url: `https://discord.com/api/webhooks/mock-webhook`,
        send: jest.fn().mockResolvedValue({ id: 'mock-message' }),
      };
      webhooks.set(channel.id, webhook);
      return webhook;
    }),

    getWebhookForChannel: jest.fn().mockImplementation(channelId => {
      return webhooks.get(channelId) || null;
    }),

    // Test utilities
    _clearWebhooks: () => {
      webhooks.clear();
    },
  };
}

/**
 * Mock Auth Module
 */
function createAuthMock(options = {}) {
  const userTokens = new Map();
  const verifiedUsers = new Set();

  return {
    hasValidToken: jest.fn().mockImplementation(userId => {
      return userTokens.has(userId);
    }),

    getUserToken: jest.fn().mockImplementation(userId => {
      return userTokens.get(userId) || null;
    }),

    storeUserToken: jest.fn().mockImplementation((userId, token) => {
      userTokens.set(userId, { token, timestamp: Date.now() });
    }),

    isNsfwVerified: jest.fn().mockImplementation(userId => {
      return verifiedUsers.has(userId);
    }),

    storeNsfwVerification: jest.fn().mockImplementation(userId => {
      verifiedUsers.add(userId);
    }),

    getAuthorizationUrl: jest.fn().mockReturnValue('https://example.com/auth'),

    // Test utilities
    _addTestUser: (userId, token = 'mock-token') => {
      userTokens.set(userId, { token, timestamp: Date.now() });
    },
    _verifyTestUser: userId => {
      verifiedUsers.add(userId);
    },
    _clearAll: () => {
      userTokens.clear();
      verifiedUsers.clear();
    },
  };
}

/**
 * Mock Command Validator
 */
function createCommandValidatorMock(options = {}) {
  return {
    isAdmin: jest.fn().mockReturnValue(options.isAdmin !== false),
    canManageMessages: jest.fn().mockReturnValue(options.canManageMessages !== false),
    isNsfwChannel: jest.fn().mockReturnValue(options.isNsfwChannel || false),
    createDirectSend: jest.fn().mockImplementation(message => {
      return jest.fn().mockImplementation(async content => {
        return message.channel.send(content);
      });
    }),
  };
}

/**
 * Mock Rate Limiter
 * CRITICAL: This mock prevents test timeouts by executing queued functions immediately
 */
function createRateLimiterMock(options = {}) {
  const queue = [];
  let isProcessing = false;

  const mock = {
    // Execute function immediately - no delays!
    enqueue: jest.fn().mockImplementation(fn => {
      if (options.simulateQueue) {
        return new Promise(resolve => {
          queue.push({ fn, resolve });
          if (!isProcessing) {
            isProcessing = true;
            process.nextTick(() => {
              while (queue.length > 0) {
                const { fn: queuedFn, resolve: queuedResolve } = queue.shift();
                queuedResolve(queuedFn());
              }
              isProcessing = false;
            });
          }
        });
      }
      // Default: execute immediately
      return Promise.resolve(fn());
    }),

    // Handle rate limit - return retry count
    handleRateLimit: jest.fn().mockImplementation(async (resourceId, retryAfter, retryCount) => {
      const newRetryCount = retryCount + 1;
      if (options.simulateMaxRetries && newRetryCount >= (options.maxRetries || 3)) {
        return options.maxRetries || 3; // Signal max retries reached
      }
      return newRetryCount;
    }),

    // Record successful request
    recordSuccess: jest.fn(),

    // Properties
    maxRetries: options.maxRetries || 3,
    minRequestSpacing: options.minRequestSpacing || 0,
    maxConcurrent: options.maxConcurrent || 1,

    // Test utilities
    _getQueueLength: () => queue.length,
    _clearQueue: () => {
      queue.length = 0;
      isProcessing = false;
    },
  };

  // Add constructor mock
  const RateLimiterConstructor = jest.fn().mockImplementation(() => mock);
  RateLimiterConstructor.mock = mock;

  return RateLimiterConstructor;
}

/**
 * Factory function to create module mock environment
 */
function createModuleEnvironment(options = {}) {
  const mocks = {};

  if (options.logger !== false) {
    mocks.logger = createLoggerMock(options.logger);
  }

  if (options.personalityManager !== false) {
    mocks.personalityManager = createPersonalityManagerMock(options.personalityManager);
  }

  if (options.conversationManager !== false) {
    mocks.conversationManager = createConversationManagerMock(options.conversationManager);
  }

  if (options.webhookManager !== false) {
    mocks.webhookManager = createWebhookManagerMock(options.webhookManager);
  }

  if (options.auth !== false) {
    mocks.auth = createAuthMock(options.auth);
  }

  if (options.commandValidator !== false) {
    mocks.commandValidator = createCommandValidatorMock(options.commandValidator);
  }

  if (options.rateLimiter !== false) {
    mocks.rateLimiter = createRateLimiterMock(options.rateLimiter);
  }

  return mocks;
}

module.exports = {
  createLoggerMock,
  createPersonalityManagerMock,
  createConversationManagerMock,
  createWebhookManagerMock,
  createAuthMock,
  createCommandValidatorMock,
  createRateLimiterMock,
  createModuleEnvironment,
};
