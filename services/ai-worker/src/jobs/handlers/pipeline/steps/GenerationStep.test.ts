/**
 * GenerationStep Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JobType,
  MessageRole,
  AttachmentType,
  type LLMGenerationJobData,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { GenerationStep } from './GenerationStep.js';
import type { GenerationContext, ResolvedConfig, ResolvedAuth, PreparedContext } from '../types.js';
import type {
  ConversationalRAGService,
  RAGResponse,
} from '../../../../services/ConversationalRAGService.js';
import { RetryError } from '../../../../utils/retry.js';

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
    storeDeferredMemory: vi.fn().mockResolvedValue(undefined),
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

      await expect(step.process(context)).rejects.toThrow(
        'ConfigStep must run before GenerationStep'
      );
    });

    it('should throw error if auth is missing', async () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        preparedContext: basePreparedContext,
        // No auth
      };

      await expect(step.process(context)).rejects.toThrow(
        'AuthStep must run before GenerationStep'
      );
    });

    it('should throw error if preparedContext is missing', async () => {
      const context: GenerationContext = {
        job: createMockJob(),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        // No preparedContext
      };

      await expect(step.process(context)).rejects.toThrow(
        'ContextStep must run before GenerationStep'
      );
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
              type: AttachmentType.Image,
              description: 'A sunset',
              originalUrl: 'https://example.com/image.png',
              metadata: {
                url: 'https://example.com/image.png',
                name: 'image.png',
                contentType: 'image/png',
                size: 1000,
              },
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
        expect.objectContaining({
          userApiKey: 'sk-test-key',
          isGuestMode: false,
        })
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
      // Verify error metadata includes model/provider/config info for footer display
      expect(result.result?.metadata?.modelUsed).toBe('anthropic/claude-sonnet-4');
      expect(result.result?.metadata?.providerUsed).toBe('openrouter');
      expect(result.result?.metadata?.configSource).toBe('personality');
      expect(result.result?.metadata?.isGuestMode).toBe(false);
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
      // Verify error metadata includes model/provider/config info for footer display
      expect(result.result?.metadata?.modelUsed).toBe('anthropic/claude-sonnet-4');
      expect(result.result?.metadata?.providerUsed).toBe('openrouter');
      expect(result.result?.metadata?.configSource).toBe('personality');
      expect(result.result?.metadata?.isGuestMode).toBe(false);
    });

    it('should return failure with EMPTY_RESPONSE when content is empty after post-processing', async () => {
      // This simulates a reasoning model returning only thinking content but no visible response
      const ragResponse: RAGResponse = {
        content: '', // Empty content after thinking extraction
        retrievedMemories: 2,
        tokensIn: 100,
        tokensOut: 50,
        thinkingContent: 'I was thinking about the question...',
        modelUsed: 'deepseek/deepseek-r1',
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
      expect(result.result?.success).toBe(false);
      expect(result.result?.error).toContain('empty response');
      expect(result.result?.personalityErrorMessage).toBe('Sorry, something went wrong.');
      expect(result.result?.errorInfo?.category).toBe('empty_response');
      expect(result.result?.errorInfo?.type).toBe('transient');
      // Verify thinking content is preserved in metadata for display
      expect(result.result?.metadata?.thinkingContent).toBe('I was thinking about the question...');
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

      expect(result.result?.referencedMessagesDescriptions).toBe(
        '[Referenced Message 1]: Previous context'
      );
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

    it('should pass guild info from job context to RAG service', async () => {
      // This test prevents regression of the bug where activePersonaGuildInfo
      // and participantGuildInfo were not being passed from job context to
      // the ConversationContext used by the RAG service
      const ragResponse: RAGResponse = {
        content: 'Response with guild context',
        retrievedMemories: 0,
        tokensIn: 10,
        tokensOut: 5,
      };

      vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

      const guildInfo = {
        roles: ['Admin', 'Moderator', 'Member'],
        displayColor: '#FF5500',
        joinedAt: '2023-01-15T10:00:00.000Z',
      };

      const participantGuildInfo = {
        'discord:123456': {
          roles: ['VIP', 'Supporter'],
          displayColor: '#00FF00',
        },
      };

      const jobData = createValidJobData();
      jobData.context.activePersonaGuildInfo = guildInfo;
      jobData.context.participantGuildInfo = participantGuildInfo;

      const context: GenerationContext = {
        job: createMockJob(jobData),
        startTime: Date.now(),
        config: baseConfig,
        auth: baseAuth,
        preparedContext: basePreparedContext,
      };

      await step.process(context);

      // Verify guild info was passed to RAG service
      expect(mockRAGService.generateResponse).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          activePersonaGuildInfo: guildInfo,
          participantGuildInfo: participantGuildInfo,
        }),
        expect.anything()
      );
    });

    describe('RetryError unwrapping', () => {
      it('should unwrap RetryError to classify underlying API error', async () => {
        // Create an underlying authentication error
        const authError = new Error('Invalid API key');
        // Wrap it in a RetryError
        const retryError = new RetryError('All retries failed', 3, authError);

        vi.mocked(mockRAGService.generateResponse).mockRejectedValue(retryError);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: basePreparedContext,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(false);
        // The error message should be from the RetryError (outer), but the
        // errorInfo.category should be based on the underlying authError
        expect(result.result?.error).toBe('All retries failed');
        // The underlying error contains 'Invalid API key' which matches authentication pattern
        expect(result.result?.errorInfo?.category).toBe('authentication');
      });

      it('should classify underlying rate limit error from RetryError', async () => {
        const rateLimitError = new Error('Rate limit exceeded');
        const retryError = new RetryError('Max retries reached', 3, rateLimitError);

        vi.mocked(mockRAGService.generateResponse).mockRejectedValue(retryError);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: basePreparedContext,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(false);
        expect(result.result?.errorInfo?.category).toBe('rate_limit');
      });

      it('should handle RetryError with null lastError', async () => {
        const retryError = new RetryError('Timed out', 3, null);

        vi.mocked(mockRAGService.generateResponse).mockRejectedValue(retryError);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: basePreparedContext,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(false);
        // With null lastError, should fall back to unknown error classification
        expect(result.result?.errorInfo?.category).toBe('unknown');
      });
    });

    describe('cross-turn duplication detection and retry', () => {
      const previousBotResponse =
        '*slow smile* I accept that victory graciously. Well played, my friend.';

      it('should not retry when response is different from previous', async () => {
        const ragResponse: RAGResponse = {
          content: 'This is a completely different response about something else entirely.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
        };

        vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: 'user', content: 'Previous message' },
            { role: 'assistant', content: previousBotResponse },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(result.result?.content).toBe(ragResponse.content);
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(false);
        // Should only call generateResponse once (no retry)
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(1);
      });

      it('should retry when response is too similar to previous turn', async () => {
        // First call returns duplicate, second call returns unique
        const duplicateResponse: RAGResponse = {
          content: '*slow smile* I accept that victory graciously. Well played, my friend.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
        };

        const uniqueResponse: RAGResponse = {
          content: 'Ah, you have bested me this time! A worthy opponent indeed.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 45,
          modelUsed: 'test-model',
        };

        vi.mocked(mockRAGService.generateResponse)
          .mockResolvedValueOnce(duplicateResponse)
          .mockResolvedValueOnce(uniqueResponse);

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: 'user', content: 'Previous message' },
            { role: 'assistant', content: previousBotResponse },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        // Should use the retry response
        expect(result.result?.content).toBe(uniqueResponse.content);
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(true);
        // Should call generateResponse twice (original + retry)
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(2);
      });

      it('should use last response if all retries produce duplicates', async () => {
        // All 3 calls return duplicates (matches RETRY_CONFIG.MAX_ATTEMPTS = 3)
        // Each response must be >85% similar to previousBotResponse to trigger retry
        const duplicateResponse1: RAGResponse = {
          content: '*slow smile* I accept that victory graciously. Well played, my friend.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
        };

        const duplicateResponse2: RAGResponse = {
          content: '*slow smile* I accept that victory graciously. Well played, my dear friend.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 48,
        };

        const duplicateResponse3: RAGResponse = {
          content: '*slow smile* I accept that victory graciously. Well played, dear friend.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 47,
          modelUsed: 'test-model',
        };

        vi.mocked(mockRAGService.generateResponse)
          .mockResolvedValueOnce(duplicateResponse1)
          .mockResolvedValueOnce(duplicateResponse2)
          .mockResolvedValueOnce(duplicateResponse3);

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: 'user', content: 'Previous message' },
            { role: 'assistant', content: previousBotResponse },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        // Should use the last response (even though it's also a duplicate)
        expect(result.result?.content).toBe(
          '*slow smile* I accept that victory graciously. Well played, dear friend.'
        );
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(true);
        // Should try 3 times (1 initial + 2 retries, matching RETRY_CONFIG.MAX_ATTEMPTS)
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(3);
      });

      it('should not retry when no previous assistant message exists', async () => {
        const ragResponse: RAGResponse = {
          content: 'Hello! Nice to meet you.',
          retrievedMemories: 0,
          tokensIn: 50,
          tokensOut: 20,
        };

        vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

        // History with only user messages
        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [{ role: 'user', content: 'Hello!' }],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(false);
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(1);
      });

      it('should not retry for short responses that may legitimately repeat', async () => {
        const shortResponse: RAGResponse = {
          content: 'Thank you!',
          retrievedMemories: 0,
          tokensIn: 50,
          tokensOut: 10,
        };

        vi.mocked(mockRAGService.generateResponse).mockResolvedValue(shortResponse);

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: 'user', content: 'Thanks for your help!' },
            { role: 'assistant', content: 'Thank you!' },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        // Short responses should not trigger retry even if identical
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(false);
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(1);
      });

      it('should retry when response matches an OLDER assistant message (not just the most recent)', async () => {
        // This is the key bug fix: detecting duplicates of messages from several turns back
        const olderResponse = '*The darkness ripples* This is wisdom from several turns ago.';
        const middleResponse = '*The shadows shift* A completely different response in between.';
        const recentResponse = '*The void speaks* Yet another unique response here.';

        // First call duplicates the OLDEST message in history
        const duplicateOfOlder: RAGResponse = {
          content: '*The darkness ripples* This is wisdom from several turns ago.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
        };

        // Second call returns unique response
        const uniqueResponse: RAGResponse = {
          content: '*A new whisper emerges* This is a completely fresh response.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 45,
          modelUsed: 'test-model',
        };

        vi.mocked(mockRAGService.generateResponse)
          .mockResolvedValueOnce(duplicateOfOlder)
          .mockResolvedValueOnce(uniqueResponse);

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            // Older conversation
            { role: 'user', content: 'First question' },
            { role: 'assistant', content: olderResponse }, // <- DUPLICATE OF THIS
            { role: 'user', content: 'Second question' },
            { role: 'assistant', content: middleResponse },
            { role: 'user', content: 'Third question' },
            { role: 'assistant', content: recentResponse }, // <- This is most recent
            // New user message that triggers generation
            { role: 'user', content: 'Fourth question' },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        // Should detect duplication against the older message and retry
        expect(result.result?.content).toBe(uniqueResponse.content);
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(true);
        // Should call generateResponse twice (original + retry)
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(2);
      });

      it('should detect duplicates using MessageRole enum values (production format)', async () => {
        // Production uses MessageRole enum values, not string literals
        // This test ensures the enum comparison works correctly
        const previousBotContent =
          '*Katie adjusts her microphone* Listen here, darling, I do not repeat myself... usually.';

        const duplicateResponse: RAGResponse = {
          content:
            '*Katie adjusts her microphone* Listen here, darling, I do not repeat myself... usually.',
          retrievedMemories: 3,
          tokensIn: 150,
          tokensOut: 60,
        };

        const uniqueResponse: RAGResponse = {
          content:
            '*Katie smirks* Oh how the tables have turned! Let me tell you something different now.',
          retrievedMemories: 3,
          tokensIn: 150,
          tokensOut: 55,
          modelUsed: 'test-model',
        };

        vi.mocked(mockRAGService.generateResponse)
          .mockResolvedValueOnce(duplicateResponse)
          .mockResolvedValueOnce(uniqueResponse);

        // Use MessageRole enum explicitly (simulates production data from BullMQ)
        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: MessageRole.User, content: 'Hello Katie!' },
            { role: MessageRole.Assistant, content: previousBotContent },
            { role: MessageRole.User, content: '*sigh* yes Ms. Killjoy' },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        // Should detect duplicate and retry
        expect(result.result?.content).toBe(uniqueResponse.content);
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(true);
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(2);
      });

      it('should detect duplicates in 18-message history (production scenario)', async () => {
        // Simulates the exact production scenario: 18 messages, alternating user/assistant
        // A duplicate of the most recent assistant message should be detected
        const longBotResponse =
          '*The demon queen tilts her head contemplatively* Ah yes, I see what you mean. ' +
          'The darkness has a way of revealing truths that the light would hide. ' +
          'Let me share some ancient wisdom with you on this matter.';

        const duplicateResponse: RAGResponse = {
          content: longBotResponse, // Exact duplicate
          retrievedMemories: 5,
          tokensIn: 200,
          tokensOut: 80,
        };

        const uniqueResponse: RAGResponse = {
          content:
            '*A sinister chuckle escapes* Now that is a completely different perspective entirely!',
          retrievedMemories: 5,
          tokensIn: 200,
          tokensOut: 75,
          modelUsed: 'test-model',
        };

        vi.mocked(mockRAGService.generateResponse)
          .mockResolvedValueOnce(duplicateResponse)
          .mockResolvedValueOnce(uniqueResponse);

        // Build 18-message history alternating user/assistant (9 pairs)
        // Use MessageRole enum like production
        const history: { role: MessageRole; content: string }[] = [];
        for (let i = 0; i < 9; i++) {
          history.push({
            role: MessageRole.User,
            content: `User message ${i + 1}: Some question or comment here.`,
          });
          if (i < 8) {
            history.push({
              role: MessageRole.Assistant,
              content: `Assistant response ${i + 1}: A unique response to the user.`,
            });
          } else {
            // The 9th (most recent) assistant message is the one we'll duplicate
            history.push({
              role: MessageRole.Assistant,
              content: longBotResponse,
            });
          }
        }

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: history,
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        // Should detect duplicate of most recent assistant message and retry
        expect(result.result?.content).toBe(uniqueResponse.content);
        expect(result.result?.metadata?.crossTurnDuplicateDetected).toBe(true);
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(2);
      });

      it('should preserve reasoning from first attempt when retry has no reasoning', async () => {
        // First attempt: has reasoning but content is duplicate
        const duplicateWithReasoning: RAGResponse = {
          content: '*slow smile* I accept that victory graciously. Well played, my friend.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
          thinkingContent: 'Let me think about how to respond to this situation...',
        };

        // Second attempt: unique content but no reasoning (model didn't produce it at high temp)
        const uniqueNoReasoning: RAGResponse = {
          content: 'A completely different and unique response here.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 45,
          modelUsed: 'test-model',
          // No thinkingContent
        };

        vi.mocked(mockRAGService.generateResponse)
          .mockResolvedValueOnce(duplicateWithReasoning)
          .mockResolvedValueOnce(uniqueNoReasoning);

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: 'user', content: 'Previous message' },
            { role: 'assistant', content: previousBotResponse },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(result.result?.content).toBe(uniqueNoReasoning.content);
        // Reasoning from the first attempt should be preserved
        expect(result.result?.metadata?.thinkingContent).toBe(
          'Let me think about how to respond to this situation...'
        );
      });

      it('should use latest reasoning when retry also has reasoning', async () => {
        const duplicateWithReasoning: RAGResponse = {
          content: '*slow smile* I accept that victory graciously. Well played, my friend.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
          thinkingContent: 'First attempt reasoning...',
        };

        const uniqueWithReasoning: RAGResponse = {
          content: 'A completely different and unique response here.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 45,
          modelUsed: 'test-model',
          thinkingContent: 'Retry reasoning - this should be used.',
        };

        vi.mocked(mockRAGService.generateResponse)
          .mockResolvedValueOnce(duplicateWithReasoning)
          .mockResolvedValueOnce(uniqueWithReasoning);

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: 'user', content: 'Previous message' },
            { role: 'assistant', content: previousBotResponse },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        // When retry has its own reasoning, use it (not the preserved one)
        expect(result.result?.metadata?.thinkingContent).toBe(
          'Retry reasoning - this should be used.'
        );
      });

      it('should isolate context mutations across retry attempts', async () => {
        // This test verifies the fix for the repetition bug:
        // The RAG service mutates rawConversationHistory (e.g., injectImageDescriptions),
        // so each retry must get a fresh copy of the context to prevent mutations
        // from attempt 1 affecting attempt 2+.

        const duplicateResponse: RAGResponse = {
          content: '*slow smile* I accept that victory graciously. Well played, my friend.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
        };

        const uniqueResponse: RAGResponse = {
          content: 'A completely unique response that is different.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 45,
        };

        // Track all contexts passed to generateResponse
        const capturedContexts: { historyLength: number; hasImageDescriptions: boolean }[] = [];

        vi.mocked(mockRAGService.generateResponse).mockImplementation(
          async (_personality, _message, context) => {
            // Capture context state BEFORE mutation
            const entry = context.rawConversationHistory?.[0];
            capturedContexts.push({
              historyLength: context.rawConversationHistory?.length ?? 0,
              hasImageDescriptions: !!entry?.messageMetadata?.imageDescriptions,
            });

            // Simulate mutation that happens in injectImageDescriptions
            // This would pollute subsequent retries if context wasn't cloned
            if (context.rawConversationHistory?.[0]) {
              context.rawConversationHistory[0].messageMetadata ??= {};
              context.rawConversationHistory[0].messageMetadata.imageDescriptions = [
                { filename: 'test.png', description: 'A test image' },
              ];
            }

            // First call returns duplicate, second returns unique
            return capturedContexts.length === 1 ? duplicateResponse : uniqueResponse;
          }
        );

        const contextWithHistory: PreparedContext = {
          ...basePreparedContext,
          rawConversationHistory: [
            { role: 'user', content: 'Previous message' },
            { role: 'assistant', content: previousBotResponse },
          ],
        };

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfig,
          auth: baseAuth,
          preparedContext: contextWithHistory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(result.result?.content).toBe(uniqueResponse.content);
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(2);

        // CRITICAL: Both calls should receive context WITHOUT pre-existing imageDescriptions
        // If context cloning is working, the second call should NOT see mutations from the first
        expect(capturedContexts).toHaveLength(2);
        expect(capturedContexts[0].hasImageDescriptions).toBe(false);
        expect(capturedContexts[1].hasImageDescriptions).toBe(false); // Should be fresh copy!
      });
    });

    describe('deferred memory storage', () => {
      const basePreparedContextForMemory: PreparedContext = {
        conversationHistory: [],
        rawConversationHistory: [],
        participants: [],
      };

      const baseConfigForMemory: ResolvedConfig = {
        effectivePersonality: TEST_PERSONALITY,
        configSource: 'personality',
      };

      const baseAuthForMemory: ResolvedAuth = {
        apiKey: 'sk-test-key',
        provider: 'openrouter',
        isGuestMode: false,
      };

      it('should call storeDeferredMemory when deferredMemoryData is present', async () => {
        const ragResponse: RAGResponse = {
          content: 'Hello! Here is my response.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
          deferredMemoryData: {
            contentForEmbedding: 'User message content',
            responseContent: 'Hello! Here is my response.',
            personaId: 'persona-123',
          },
        };

        vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfigForMemory,
          auth: baseAuthForMemory,
          preparedContext: basePreparedContextForMemory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(mockRAGService.storeDeferredMemory).toHaveBeenCalledOnce();
        // Verify it was called with correct personality and deferred data
        const calls = vi.mocked(mockRAGService.storeDeferredMemory).mock.calls;
        expect(calls[0][0]).toBe(TEST_PERSONALITY); // effectivePersonality
        expect(calls[0][2]).toEqual(ragResponse.deferredMemoryData); // deferredMemoryData
      });

      it('should NOT call storeDeferredMemory when incognitoModeActive is true', async () => {
        const ragResponse: RAGResponse = {
          content: 'Hello from incognito!',
          retrievedMemories: 0,
          tokensIn: 100,
          tokensOut: 50,
          incognitoModeActive: true,
          deferredMemoryData: {
            contentForEmbedding: 'User message',
            responseContent: 'Hello from incognito!',
            personaId: 'persona-123',
          },
        };

        vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfigForMemory,
          auth: baseAuthForMemory,
          preparedContext: basePreparedContextForMemory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(mockRAGService.storeDeferredMemory).not.toHaveBeenCalled();
      });

      it('should NOT call storeDeferredMemory when deferredMemoryData is undefined', async () => {
        const ragResponse: RAGResponse = {
          content: 'Hello! No memory to store.',
          retrievedMemories: 0,
          tokensIn: 100,
          tokensOut: 50,
          // No deferredMemoryData
        };

        vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfigForMemory,
          auth: baseAuthForMemory,
          preparedContext: basePreparedContextForMemory,
        };

        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(mockRAGService.storeDeferredMemory).not.toHaveBeenCalled();
      });

      it('should succeed even if storeDeferredMemory throws an error', async () => {
        const ragResponse: RAGResponse = {
          content: 'Hello! Memory storage will fail.',
          retrievedMemories: 2,
          tokensIn: 100,
          tokensOut: 50,
          deferredMemoryData: {
            contentForEmbedding: 'User message content',
            responseContent: 'Hello! Memory storage will fail.',
            personaId: 'persona-123',
          },
        };

        vi.mocked(mockRAGService.generateResponse).mockResolvedValue(ragResponse);
        vi.mocked(mockRAGService.storeDeferredMemory).mockRejectedValue(
          new Error('Database connection failed')
        );

        const context: GenerationContext = {
          job: createMockJob(),
          startTime: Date.now(),
          config: baseConfigForMemory,
          auth: baseAuthForMemory,
          preparedContext: basePreparedContextForMemory,
        };

        // Should NOT throw - job should succeed despite memory storage failure
        const result = await step.process(context);

        expect(result.result?.success).toBe(true);
        expect(result.result?.content).toBe('Hello! Memory storage will fail.');
        expect(mockRAGService.storeDeferredMemory).toHaveBeenCalledOnce();
      });
    });
  });
});
