/**
 * @jest-environment node
 * @testType adapter
 *
 * AIServiceAdapterFactory Test
 * - Tests factory for creating AI service adapters
 */

jest.mock('../../../../src/adapters/ai/HttpAIServiceAdapter');
jest.mock('../../../../src/logger');

const { AIServiceAdapterFactory } = require('../../../../src/adapters/ai/AIServiceAdapterFactory');
const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const { AIContent } = require('../../../../src/domain/ai');

describe('AIServiceAdapterFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Mock HttpAIServiceAdapter constructor
    HttpAIServiceAdapter.mockImplementation(config => ({
      config,
      generateContent: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Clean up environment variables
    delete process.env.AI_PROVIDER;
    delete process.env.AI_SERVICE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_TIMEOUT;
    delete process.env.AI_MAX_RETRIES;
    delete process.env.AI_DEFAULT_MODEL;
  });

  describe('create', () => {
    it('should create generic adapter by default', () => {
      const adapter = AIServiceAdapterFactory.create({
        baseUrl: 'https://api.example.com',
        apiKey: 'test-key',
      });

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com',
        headers: { Authorization: 'Bearer test-key' },
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
      });

      expect(adapter).toBeDefined();
    });

    it('should create generic adapter without API key', () => {
      const adapter = AIServiceAdapterFactory.create({
        baseUrl: 'https://api.example.com',
      });

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com',
        headers: {},
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
      });
    });

    it('should throw error if baseUrl missing for generic provider', () => {
      expect(() => {
        AIServiceAdapterFactory.create({ provider: 'generic' });
      }).toThrow('baseUrl is required for generic provider');
    });

    it('should pass through custom options', () => {
      const adapter = AIServiceAdapterFactory.create({
        baseUrl: 'https://api.example.com',
        options: {
          timeout: 60000,
          customOption: 'value',
        },
      });

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com',
        headers: {},
        timeout: 60000,
        maxRetries: 3,
        retryDelay: 1000,
        customOption: 'value',
      });
    });
  });

  describe('OpenAI-compatible provider', () => {
    it('should create OpenAI-compatible adapter', () => {
      const adapter = AIServiceAdapterFactory.create({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
      });

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://api.openai.com',
          headers: {
            Authorization: 'Bearer sk-test',
            'OpenAI-Beta': 'assistants=v1',
          },
          timeout: 60000,
          transformRequest: expect.any(Function),
          transformResponse: expect.any(Function),
        })
      );
    });

    it('should throw error if baseUrl or apiKey missing', () => {
      expect(() => {
        AIServiceAdapterFactory.create({
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com',
        });
      }).toThrow('baseUrl and apiKey are required for OpenAI-compatible provider');

      expect(() => {
        AIServiceAdapterFactory.create({
          provider: 'openai-compatible',
          apiKey: 'sk-test',
        });
      }).toThrow('baseUrl and apiKey are required for OpenAI-compatible provider');
    });

    it('should transform requests in OpenAI format', () => {
      AIServiceAdapterFactory.create({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
      });

      const transformRequest = HttpAIServiceAdapter.mock.calls[0][0].transformRequest;

      // Create test request

      // Create mock request with proper domain model structure
      const mockRequest = {
        toJSON: () => ({
          id: 'req-123',
          requestId: 'req-123',
          userId: 'user-123',
          personalityId: 'personality-456',
          content: [{ type: 'text', text: 'Hello' }],
          model: {
            name: 'gpt-4',
            path: 'gpt-4',
            capabilities: {
              temperature: 0.7,
              maxTokens: 1000,
            },
          },
        }),
      };

      const transformed = transformRequest(mockRequest);

      expect(transformed).toEqual({
        endpoint: '/v1/chat/completions',
        payload: {
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You are personality personality-456.' },
            { role: 'user', content: 'Hello' },
          ],
          temperature: 0.7,
          max_tokens: 1000,
          user: 'user-123',
        },
      });
    });

    it('should transform OpenAI responses', async () => {
      AIServiceAdapterFactory.create({
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
      });

      const transformResponse = HttpAIServiceAdapter.mock.calls[0][0].transformResponse;

      const apiResponse = {
        id: 'chatcmpl-123',
        model: 'gpt-4',
        choices: [
          {
            message: { content: 'Hello! How can I help?' },
            finish_reason: 'stop',
          },
        ],
        usage: { total_tokens: 50 },
      };

      const result = await transformResponse(apiResponse);

      expect(result).toBeInstanceOf(AIContent);
      expect(result.getText()).toBe('Hello! How can I help?');
    });
  });

  describe('Anthropic-compatible provider', () => {
    it('should create Anthropic-compatible adapter', () => {
      const adapter = AIServiceAdapterFactory.create({
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'claude-key',
      });

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://api.anthropic.com',
          headers: {
            'X-API-Key': 'claude-key',
            'Anthropic-Version': '2023-06-01',
          },
          timeout: 60000,
          transformRequest: expect.any(Function),
          transformResponse: expect.any(Function),
        })
      );
    });

    it('should use custom version if provided', () => {
      const adapter = AIServiceAdapterFactory.create({
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'claude-key',
        options: { version: '2024-01-01' },
      });

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Anthropic-Version': '2024-01-01',
          }),
        })
      );
    });

    it('should transform requests in Anthropic format', () => {
      AIServiceAdapterFactory.create({
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'claude-key',
      });

      const transformRequest = HttpAIServiceAdapter.mock.calls[0][0].transformRequest;

      // Create mock request with proper domain model structure
      const mockRequest = {
        toJSON: () => ({
          id: 'req-123',
          requestId: 'req-123',
          userId: 'user-123',
          personalityId: 'personality-789',
          content: [{ type: 'text', text: 'Hello Claude' }],
          model: {
            name: 'claude-3-opus',
            path: 'claude-3-opus',
            capabilities: {
              temperature: 0.5,
              maxTokens: 1000,
            },
          },
        }),
      };

      const transformed = transformRequest(mockRequest);

      expect(transformed).toEqual({
        endpoint: '/v1/messages',
        payload: {
          model: 'claude-3-opus',
          messages: [{ role: 'user', content: 'Hello Claude' }],
          system: 'You are personality personality-789.',
          temperature: 0.5,
          max_tokens: 1000,
          metadata: { user_id: 'user-123' },
        },
      });
    });

    it('should transform Anthropic responses', async () => {
      AIServiceAdapterFactory.create({
        provider: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'claude-key',
      });

      const transformResponse = HttpAIServiceAdapter.mock.calls[0][0].transformResponse;

      const apiResponse = {
        id: 'msg-123',
        model: 'claude-3-opus',
        content: [
          { type: 'text', text: 'Hello! ' },
          { type: 'text', text: 'How can I assist you?' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const result = await transformResponse(apiResponse);

      expect(result).toBeInstanceOf(AIContent);
      expect(result.getText()).toBe('Hello! \nHow can I assist you?');
    });
  });

  describe('createFromEnv', () => {
    it('should create adapter from environment variables', () => {
      process.env.AI_PROVIDER = 'generic';
      process.env.AI_SERVICE_URL = 'https://env.example.com';
      process.env.AI_API_KEY = 'env-key';
      process.env.AI_TIMEOUT = '45000';
      process.env.AI_MAX_RETRIES = '5';

      const adapter = AIServiceAdapterFactory.createFromEnv();

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith({
        baseUrl: 'https://env.example.com',
        headers: { Authorization: 'Bearer env-key' },
        timeout: 45000,
        maxRetries: 5,
        retryDelay: 1000,
        defaultModel: undefined,
      });
    });

    it('should throw error if AI_SERVICE_URL not set', () => {
      expect(() => {
        AIServiceAdapterFactory.createFromEnv();
      }).toThrow('AI_SERVICE_URL environment variable is required');
    });

    it('should use defaults for missing optional env vars', () => {
      process.env.AI_SERVICE_URL = 'https://env.example.com';

      const adapter = AIServiceAdapterFactory.createFromEnv();

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith({
        baseUrl: 'https://env.example.com',
        headers: {},
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        defaultModel: undefined,
      });
    });
  });
});
