const { getAiResponse, createRequestId, formatApiMessages } = require('../../src/aiService');

// Mock OpenAI module
jest.mock('openai', () => {
  // Create a mock AI client with support for multimodal content
  const mockAIClient = {
    setShouldError: jest.fn().mockImplementation(function (shouldError) {
      this.shouldError = shouldError;
    }),

    chat: {
      completions: {
        create: jest.fn().mockImplementation(async function (params) {

          // Check if we should return an error
          if (mockAIClient.shouldError) {
            throw new Error('Mock API error');
          }

          // Return a successful response
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: params.model || 'gpt-3.5-turbo',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: `This is a mock response from the AI for personality: ${params.model}. I am responding to your message.`,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 200,
              total_tokens: 300,
              metadata: {
                is_premium: true,
                fallback_model_used: false,
                zero_balance_diverted: false
              }
            },
          };
        }),
      },
    },
  };

  return {
    OpenAI: jest.fn().mockImplementation(() => mockAIClient),
  };
});

// Mock config module
jest.mock('../../config', () => ({
  getApiEndpoint: jest.fn().mockReturnValue('https://api.example.com'),
  getModelPath: jest.fn().mockImplementation((personality) => `mock-model-path-${personality}`),
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@',
  },
}));

// AuthManager mock removed - using DDD authentication

// Mock PersonalityDataService
jest.mock('../../src/services/PersonalityDataService', () => ({
  getPersonalityDataService: jest.fn().mockReturnValue({
    getExtendedProfile: jest.fn().mockResolvedValue({
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
      errorMessage: 'Error occurred',
      mode: 'normal',
    }),
  }),
}));

// Mock webhookUserTracker to bypass authentication
jest.mock('../../src/utils/webhookUserTracker', () => ({
  shouldBypassNsfwVerification: jest.fn().mockReturnValue(true), // Return true to bypass auth in tests
}));

// Mock ApplicationBootstrap
jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn(),
}));

// Mock other dependencies
jest.mock('../../src/constants', () => ({
  TIME: {
    ERROR_BLACKOUT_DURATION: 30000,
    ONE_MINUTE: 60000,
  },
  ERROR_PATTERNS: [
    'NoneType',
    'AttributeError',
    'TypeError',
    'ValueError',
    'Traceback',
    'Error:',
    'ImportError',
    'KeyError',
  ],
  MARKERS: {
    BOT_ERROR_MESSAGE: 'BOT_ERROR_MESSAGE_PREFIX:',
  },
  DEFAULTS: {
    ANONYMOUS_USER: 'anon',
    NO_CHANNEL: 'nochannel',
    DEFAULT_PROMPT: 'Hello',
  },
}));

// Mock aiService's getAiClientForUser method
const aiService = require('../../src/aiService');
aiService.getAiClientForUser = jest.fn();

describe('Referenced Message Media Tests', () => {
  // Save original environment variables
  const originalEnv = process.env;

  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // Original setTimeout
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    // Mock environment variables
    process.env = {
      ...originalEnv,
      SERVICE_API_KEY: 'mock-api-key',
      NODE_ENV: 'test',
    };

    // Mock console methods to prevent noise during tests
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();

    // Mock setTimeout to execute immediately
    global.setTimeout = jest.fn(callback => {
      // Don't actually call the callback to avoid cleaning up pending requests too early
      return 123; // Mock timer ID
    });

    // Reset mocks between tests
    jest.clearAllMocks();
    
    // Setup default mock for getAiClientForUser to return the OpenAI mock client
    const openaiModule = require('openai');
    const OpenAI = openaiModule.OpenAI;
    const mockClient = new OpenAI();
    aiService.getAiClientForUser.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    // Restore environment variables
    process.env = originalEnv;

    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
  });

  // Test 1: Text message referencing another message with an image
  it('should properly format a text message referencing a message with an image', async () => {
    // Set up test data for a referenced message with an image
    const message = {
      messageContent: 'What do you think about this image?',
      referencedMessage: {
        content: 'Check out this cool image\n[Image: https://example.com/image.jpg]',
        author: 'TestUser',
        isFromBot: false,
      },
    };

    const context = {
      userId: 'user123',
      channelId: 'channel456',
    };

    // Test the formatApiMessages function directly
    const formattedMessages = await formatApiMessages(message);

    // Verify we get a single combined message
    expect(formattedMessages.length).toBe(1);
    expect(formattedMessages[0].role).toBe('user');
    expect(Array.isArray(formattedMessages[0].content)).toBe(true);

    const singleMessage = formattedMessages[0];

    // Find the text content containing both user question and reference
    const textItem = singleMessage.content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('What do you think about this image?');
    expect(textItem.text).toContain('TestUser said (with an image):');

    // Find the image content
    const imageItem = singleMessage.content.find(item => item.type === 'image_url');
    expect(imageItem).toBeDefined();
    expect(imageItem.image_url.url).toBe('https://example.com/image.jpg');

    // Test the createRequestId function to ensure it handles reference + image
    const requestId = createRequestId('test-personality', message, context);

    // Verify the request ID is properly formatted
    expect(requestId).toContain('test-personality');
    expect(requestId).toContain('user123');
    expect(requestId).toContain('channel456');

    // The request ID should include some part of the text content
    expect(requestId).toContain('Whatdoyouthink');

    // It should include the IMAGE marker
    expect(requestId).toContain('IMG-');
  });

  // Test 2: Text message referencing another message with audio
  it('should properly format a text message referencing a message with audio', async () => {
    // Set up test data for a referenced message with audio
    const message = {
      messageContent: 'What is being said in this audio?',
      referencedMessage: {
        content: 'Listen to this audio file\n[Audio: https://example.com/audio.mp3]',
        author: 'TestUser',
        isFromBot: false,
      },
    };

    const context = {
      userId: 'user123',
      channelId: 'channel456',
    };

    // Test the formatApiMessages function directly
    const formattedMessages = await formatApiMessages(message);

    // Verify we get a single combined message
    expect(formattedMessages.length).toBe(1);
    expect(formattedMessages[0].role).toBe('user');
    expect(Array.isArray(formattedMessages[0].content)).toBe(true);

    const singleMessage = formattedMessages[0];

    // Find the text content containing both user question and reference
    const textItem = singleMessage.content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('What is being said in this audio?');
    expect(textItem.text).toContain('TestUser said (with audio):');

    // Find the audio content
    const audioItem = singleMessage.content.find(item => item.type === 'audio_url');
    expect(audioItem).toBeDefined();
    expect(audioItem.audio_url.url).toBe('https://example.com/audio.mp3');

    // Test the createRequestId function to ensure it handles reference + audio
    const requestId = createRequestId('test-personality', message, context);

    // Verify the request ID is properly formatted
    expect(requestId).toContain('test-personality');
    expect(requestId).toContain('user123');
    expect(requestId).toContain('channel456');

    // The request ID should include some part of the text content
    expect(requestId).toContain('Whatisbeingsaid');

    // It should include the AUD marker
    expect(requestId).toContain('AUD-');
  });

  // Test 3: Multimodal message (with an image) referencing another message with audio
  it('should properly format a multimodal message with image referencing a message with audio', async () => {
    // Set up test data for a multimodal message with image referencing a message with audio
    const message = {
      messageContent: [
        {
          type: 'text',
          text: 'This image is related to the audio. What do you think?',
        },
        {
          type: 'image_url',
          image_url: {
            url: 'https://example.com/related-image.jpg',
          },
        },
      ],
      referencedMessage: {
        content: 'Listen to this audio file\n[Audio: https://example.com/audio.mp3]',
        author: 'TestUser',
        isFromBot: false,
      },
    };

    const context = {
      userId: 'user123',
      channelId: 'channel456',
    };

    // Test the formatApiMessages function directly
    const formattedMessages = await formatApiMessages(message);

    // Verify we get a single combined message
    expect(formattedMessages.length).toBe(1);
    expect(formattedMessages[0].role).toBe('user');
    expect(Array.isArray(formattedMessages[0].content)).toBe(true);

    const singleMessage = formattedMessages[0];

    // Find the text content containing both user content and reference
    const textItem = singleMessage.content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('This image is related to the audio');
    expect(textItem.text).toContain('TestUser said (with audio):');

    // Find the user's image content
    const userImageItem = singleMessage.content.find(
      item =>
        item.type === 'image_url' && item.image_url.url === 'https://example.com/related-image.jpg'
    );
    expect(userImageItem).toBeDefined();

    // Find the referenced audio content
    const audioItem = singleMessage.content.find(
      item => item.type === 'audio_url' && item.audio_url.url === 'https://example.com/audio.mp3'
    );
    expect(audioItem).toBeDefined();

    // Verify the URLs are correct
    expect(userImageItem.image_url.url).toBe('https://example.com/related-image.jpg');
    expect(audioItem.audio_url.url).toBe('https://example.com/audio.mp3');

    // Test the createRequestId function to ensure it handles multimodal + reference properly
    const requestId = createRequestId('test-personality', message, context);

    // Verify the request ID is properly formatted
    expect(requestId).toContain('test-personality');
    expect(requestId).toContain('user123');
    expect(requestId).toContain('channel456');

    // It should include both media markers if possible
    const hasImgMarker = requestId.includes('IMG-');
    const hasAudMarker = requestId.includes('AUD-');

    // We should have at least one media marker
    expect(hasImgMarker || hasAudMarker).toBe(true);
  });

  // Test 4: Multimodal message (with audio) referencing another message with an image
  it('should properly format a multimodal message with audio referencing a message with image', async () => {
    // Set up test data for a multimodal message with audio referencing a message with image
    const message = {
      messageContent: [
        {
          type: 'text',
          text: 'This audio is my response to the image. What do you think?',
        },
        {
          type: 'audio_url',
          audio_url: {
            url: 'https://example.com/response-audio.mp3',
          },
        },
      ],
      referencedMessage: {
        content: 'Check out this image\n[Image: https://example.com/image.jpg]',
        author: 'TestUser',
        isFromBot: false,
      },
    };

    const context = {
      userId: 'user123',
      channelId: 'channel456',
    };

    // Test the formatApiMessages function directly
    const formattedMessages = await formatApiMessages(message);

    // Verify we get a single combined message
    expect(formattedMessages.length).toBe(1);
    expect(formattedMessages[0].role).toBe('user');
    expect(Array.isArray(formattedMessages[0].content)).toBe(true);

    const singleMessage = formattedMessages[0];

    // Find the text content containing both user content and reference
    const textItem = singleMessage.content.find(item => item.type === 'text');
    expect(textItem).toBeDefined();
    expect(textItem.text).toContain('This audio is my response to the image');
    expect(textItem.text).toContain('TestUser said (with an image):');

    // Find the user's audio content
    const userAudioItem = singleMessage.content.find(
      item =>
        item.type === 'audio_url' && item.audio_url.url === 'https://example.com/response-audio.mp3'
    );
    expect(userAudioItem).toBeDefined();

    // Find the referenced image content
    const imageItem = singleMessage.content.find(
      item => item.type === 'image_url' && item.image_url.url === 'https://example.com/image.jpg'
    );
    expect(imageItem).toBeDefined();

    // Verify the URLs are correct
    expect(userAudioItem.audio_url.url).toBe('https://example.com/response-audio.mp3');
    expect(imageItem.image_url.url).toBe('https://example.com/image.jpg');

    // Test the createRequestId function to ensure it handles multimodal + reference properly
    const requestId = createRequestId('test-personality', message, context);

    // Verify the request ID is properly formatted
    expect(requestId).toContain('test-personality');
    expect(requestId).toContain('user123');
    expect(requestId).toContain('channel456');

    // It should include both media markers if possible
    const hasImgMarker = requestId.includes('IMG-');
    const hasAudMarker = requestId.includes('AUD-');

    // We should have at least one media marker
    expect(hasImgMarker || hasAudMarker).toBe(true);
  });

  // Test 5: Integration test - full AI response flow with media references
  it('should correctly process a full AI request with referenced media', async () => {
    // Mock ApplicationBootstrap for DDD auth
    const mockDDDAuthService = {
      getAuthenticationStatus: jest.fn().mockResolvedValue({
        isAuthenticated: true,
        user: { 
          nsfwStatus: { verified: true },
          token: { value: 'test-token' }
        }
      }),
      createAIClient: jest.fn().mockImplementation(() => {
        const openaiModule = require('openai');
        const OpenAI = openaiModule.OpenAI;
        return new OpenAI();
      })
    };
    
    const { getApplicationBootstrap } = require('../../src/application/bootstrap/ApplicationBootstrap');
    getApplicationBootstrap.mockReturnValue({
      getApplicationServices: jest.fn().mockReturnValue({
        authenticationService: mockDDDAuthService
      }),
      getPersonalityApplicationService: jest.fn().mockReturnValue({
        getPersonality: jest.fn().mockResolvedValue(null)
      })
    });

    // Set up test data
    const personalityName = 'test-personality';
    const message = {
      messageContent: 'What do you see in this image?',
      referencedMessage: {
        content: 'Look at this\n[Image: https://example.com/test.jpg]',
        author: 'TestUser',
        isFromBot: false,
      },
    };
    const context = { 
      userId: 'user123', 
      channelId: 'channel456',
      // Add webhook context to bypass initial auth check
      message: {
        webhookId: 'test-webhook',
        author: { username: 'TestWebhook' }
      }
    };

    // Setup getAiClientForUser to return our mock client
    const openaiModule = require('openai');
    const OpenAI = openaiModule.OpenAI;
    const mockClient = new OpenAI();
    aiService.getAiClientForUser.mockResolvedValue(mockClient);
    
    // Spy on the OpenAI API call
    const createChatCompletionSpy = jest.spyOn(mockClient.chat.completions, 'create');
    
    // Make the API call
    const response = await getAiResponse(personalityName, message, context);

    // Verify we got a valid response
    expect(response).toBeTruthy();
    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('metadata');
    expect(typeof response.content).toBe('string');
    expect(response.content).toContain('This is a mock response');

    // Verify the API was called with the correctly formatted messages
    expect(createChatCompletionSpy).toHaveBeenCalledTimes(1);

    // Get the messages that were passed to the API
    const apiCall = createChatCompletionSpy.mock.calls[0][0];

    // Verify the messages contain the reference and image
    expect(apiCall.messages).toBeDefined();
    expect(apiCall.messages.length).toBeGreaterThan(0);

    // Look for the message containing the reference
    const apiRefMsg = apiCall.messages.find(
      msg =>
        msg.role === 'user' &&
        ((typeof msg.content === 'string' && msg.content.includes('TestUser')) ||
          (Array.isArray(msg.content) &&
            msg.content.some(item => item.type === 'text' && item.text.includes('TestUser'))))
    );
    expect(apiRefMsg).toBeDefined();

    // Look for the message containing the image
    const imageFound = apiCall.messages.some(
      msg =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some(
          item => item.type === 'image_url' && item.image_url.url === 'https://example.com/test.jpg'
        )
    );
    expect(imageFound).toBe(true);

    // Clean up spy
    createChatCompletionSpy.mockRestore();
  });
});
