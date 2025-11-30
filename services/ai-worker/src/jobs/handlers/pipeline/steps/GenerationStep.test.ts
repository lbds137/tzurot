/**
 * GenerationStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType, type LLMGenerationJobData, type LoadedPersonality } from '@tzurot/common-types';
import { GenerationStep } from './GenerationStep.js';
import type { GenerationContext, ResolvedConfig, ResolvedAuth, PreparedContext } from '../types.js';
import type { ConversationalRAGService, RAGResponse } from '../../../../services/ConversationalRAGService.js';

// Mock common-types logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
  errorMessage: 'Sorry, something went wrong.',
};

function createValidJobData(): LLMGenerationJobData {
  return {
    requestId: 'test-req-001',
    jobType: JobType.LLMGeneration,
    personality: TEST_PERSONALITY,
    message: 'Hello, how are you?',
    context: {
      userId: 'user-456',
      userName: 'TestUser',
      channelId: 'channel-789',
    },
    responseDestination: {
      type: 'discord',
      channelId: 'channel-789',
    },
  };
}

function createMockJob(data: Partial<LLMGenerationJobData> = {}): Job<LLMGenerationJobData> {
  return {
    id: 'job-123',
    data: { ...createValidJobData(), ...data } as LLMGenerationJobData,
  } as Job<LLMGenerationJobData>;
}

function createMockRAGService(): ConversationalRAGService {
  return {
    generateResponse: vi.fn(),
  } as unknown as ConversationalRAGService;
}

describe('GenerationStep', () => {
  let step: GenerationStep;
  let mockRAGService: ConversationalRAGService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRAGService = createMockRAGService();
    step = new GenerationStep(mockRAGService);
  });

  it('should have correct name', () => {
    expect(step.name).toBe('Generation');
  });

  describe('process', () => {
    const baseConfig: ResolvedConfig = {
      effectivePersonality: TEST_PERSONALITY,
      configSource: 'personality',
    };

    const baseAuth: ResolvedAuth = {
      apiKey: 'sk-test-key',
      provider: 'openrouter',
      isGuestMode: false,
    };

    const basePreparedContext: PreparedContext = {
      conversationHistory: [],
      rawConversationHistory: [],
      participants: [],
    };

    it('should throw error if config is missing', async () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        auth: baseAuth,
        preparedContext: basePreparedContext,
        // No config
      };

      await expect(step.process(context)).rejects.toThrow('ConfigStep must run before GenerationStep');
    });

    it('should throw error if auth is missing', async () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        preparedContext: basePreparedContext,
        // No auth
      };

      await expect(step.process(context)).rejects.toThrow('AuthStep must run before GenerationStep');
    });

    it('should throw error if preparedContext is missing', async () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        // No preparedContext
      };

      await expect(step.process(context)).rejects.toThrow('ContextStep must run before GenerationStep');
    });

    it('should generate response successfully', async () => {
      const ragResponse: RAGResponse = {
        content: 'Hello! I am doing well, thank you for asking.',
        retrievedMemories: 5,
        tokensIn: 100,
        tokensOut: 50,
        modelUsed: 'anthropic/claude-sonnet-4',
      };

      vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        preparedContext: basePreparedContext,
      };

      const result = await step.process(context);

      expect(result.result).toBeDefined();
      expect(result.result?.success).toBe(true);
      expect(result.result?.content).toBe('Hello! I am doing well, thank you for asking.');
      expect(result.result?.metadata?.retrievedMemories).toBe(5);
      expect(result.result?.metadata?.tokensIn).toBe(100);
      expect(result.result?.metadata?.tokensOut).toBe(50);
      expect(result.result?.metadata?.modelUsed).toBe('anthropic/claude-sonnet-4');
    });

    it('should include processing time in metadata', async () => {
      const ragResponse: RAGResponse = {
        content: 'Response',
        retrievedMemories: 0,
        tokensIn: 10,
        tokensOut: 5,
      };

      vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

      const startTime = Date.now() - 100; // Started 100ms ago

      const context: GenerationContext = {
        job: createMockJob(),
        startTime,
        config: baseConfig,
        auth: baseAuth,
        preparedContext: basePreparedContext,
      };

      const result = await step.process(context);

      expect(result.result?.metadata?.processingTimeMs).toBeGreaterThanOrEqual(100);
    });

    it('should include configSource and guest mode in metadata', async () => {
      const ragResponse: RAGResponse = {
        content: 'Response',
        retrievedMemories: 0,
        tokensIn: 10,
        tokensOut: 5,
      };

      vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: {
          effectivePersonality: TEST_PERSONALITY,
          configSource: 'user-personality',
        },
        auth: {
          apiKey: undefined,
          provider: 'openrouter',
          isGuestMode: true,
        },
        preparedContext: basePreparedContext,
      };

      const result = await step.process(context);

      expect(result.result?.metadata?.configSource).toBe('user-personality');
      expect(result.result?.metadata?.isGuestMode).toBe(true);
    });

    it('should pass preprocessed attachments to RAG service', async () => {
      const ragResponse: RAGResponse = {
        content: 'Response about the image',
        retrievedMemories: 0,
        tokensIn: 10,
        tokensOut: 5,
        attachmentDescriptions: 'Image: A sunset',
      };

      vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        preparedContext: basePreparedContext,
        preprocessing: {
          processedAttachments: [
            {
              type: 'image' as const,
              description: 'A sunset',
              originalUrl: 'https://example.com/image.png',
              metadata: { url: 'https://example.com/image.png', name: 'image.png', contentType: 'image/png', size: 1000 },
            },
          ],
          transcriptions: [],
          referenceAttachments: {},
        },
      };

      const result = await step.process(context);

      expect(mockRAGService.generateResponse).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          preprocessedAttachments: expect.arrayContaining([
            expect.objectContaining({ description: 'A sunset' }),
          ]),
        }),
        expect.anything(),
        expect.anything()
      );
      expect(result.result?.attachmentDescriptions).toBe('Image: A sunset');
    });

    it('should return failure result when RAG service throws', async () => {
      vi.mocked(mockRAGService.generateResponse).mockRejectedValue(
        new Error('Model rate limit exceeded')
      );

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        preparedContext: basePreparedContext,
      };

      const result = await step.process(context);

      expect(result.result).toBeDefined();
      expect(result.result?.success).toBe(false);
      expect(result.result?.error).toBe('Model rate limit exceeded');
      expect(result.result?.personalityErrorMessage).toBe('Sorry, something went wrong.');
    });

    it('should handle unknown error type', async () => {
      vi.mocked(mockRAGService.generateResponse).mockRejectedValue('String error');

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        preparedContext: basePreparedContext,
      };

      const result = await step.process(context);

      expect(result.result?.success).toBe(false);
      expect(result.result?.error).toBe('Unknown error');
    });

    it('should include referenced messages descriptions in result', async () => {
      const ragResponse: RAGResponse = {
        content: 'Response',
        retrievedMemories: 0,
        tokensIn: 10,
        tokensOut: 5,
        referencedMessagesDescriptions: '[Referenced Message 1]: Previous context',
      };

      vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        preparedContext: basePreparedContext,
      };

      const result = await step.process(context);

      expect(result.result?.referencedMessagesDescriptions).toBe('[Referenced Message 1]: Previous context');
    });

    it('should pass provider from auth to result metadata', async () => {
      const ragResponse: RAGResponse = {
        content: 'Response',
        retrievedMemories: 0,
        tokensIn: 10,
        tokensOut: 5,
      };

      vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: {
          apiKey: 'key',
          provider: 'gemini',
          isGuestMode: false,
        },
        preparedContext: basePreparedContext,
      };

      const result = await step.process(context);

      expect(result.result?.metadata?.providerUsed).toBe('gemini');
    });
  });
});
