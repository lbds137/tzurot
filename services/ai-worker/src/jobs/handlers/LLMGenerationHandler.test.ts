/**
 * Tests for LLM Generation Handler
 *
 * Tests the LLM generation job processing including:
 * - Job validation
 * - Dependency processing (audio transcriptions, image descriptions)
 * - Response generation via RAG service
 * - BYOK API key resolution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  JobType,
  JobStatus,
  AIProvider,
  type LLMGenerationJobData,
  type LoadedPersonality,
  REDIS_KEY_PREFIXES,
} from '@tzurot/common-types';
import { LLMGenerationHandler } from './LLMGenerationHandler.js';
import type { ApiKeyResolver, ApiKeyResolutionResult } from '../../services/ApiKeyResolver.js';

// Mock the redis module (dynamic import)
vi.mock('../../redis.js', () => ({
  redisService: {
    getJobResult: vi.fn(),
  },
}));

// Mock conversationUtils
vi.mock('../utils/conversationUtils.js', () => ({
  extractParticipants: vi.fn(),
  convertConversationHistory: vi.fn(),
}));

// Import mocked modules
import { redisService } from '../../redis.js';
import { extractParticipants, convertConversationHistory } from '../utils/conversationUtils.js';

// Get mocked functions
const mockGetJobResult = vi.mocked(redisService.getJobResult);
const mockExtractParticipants = vi.mocked(extractParticipants);
const mockConvertConversationHistory = vi.mocked(convertConversationHistory);

// Mock RAG service
function createMockRAGService() {
  return {
    generateResponse: vi.fn(),
  };
}

// Mock ApiKeyResolver
function createMockApiKeyResolver() {
  return {
    resolveApiKey: vi.fn(),
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
  } as unknown as ApiKeyResolver;
}

/**
 * Test personality with all required fields per loadedPersonalitySchema
 */
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
};

// Create minimal valid job data
function createValidJobData(overrides?: Partial<LLMGenerationJobData>): LLMGenerationJobData {
  return {
    requestId: 'test-req-001',
    jobType: JobType.LLMGeneration,
    personality: TEST_PERSONALITY,
    message: 'Hello, how are you?',
    context: {
      userId: 'user-456',
      userName: 'TestUser',
      channelId: 'channel-789',
      serverId: 'server-012',
      sessionId: 'session-xyz',
    },
    responseDestination: {
      type: 'discord',
      channelId: 'channel-789',
    },
    ...overrides,
  };
}

describe('LLMGenerationHandler', () => {
  let handler: LLMGenerationHandler;
  let mockRAGService: ReturnType<typeof createMockRAGService>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRAGService = createMockRAGService();
    handler = new LLMGenerationHandler(mockRAGService as any);

    // Default mock implementations
    mockExtractParticipants.mockReturnValue([]);
    mockConvertConversationHistory.mockReturnValue([]);
    mockRAGService.generateResponse.mockResolvedValue({
      content: 'Hello! I am doing well, thank you for asking.',
      retrievedMemories: 0,
      tokensIn: 100,
      tokensOut: 50,
      modelUsed: 'anthropic/claude-sonnet-4',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processJob', () => {
    describe('job validation', () => {
      it('should process valid job data successfully', async () => {
        const jobData = createValidJobData();
        const job = { id: 'job-001', data: jobData } as Job<LLMGenerationJobData>;

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);
        expect(result.requestId).toBe('test-req-001');
        expect(result.content).toBe('Hello! I am doing well, thank you for asking.');
      });

      it('should reject job with missing required fields', async () => {
        const invalidJobData = {
          requestId: 'test-req-invalid',
          // Missing jobType, personality, message, context, etc.
        } as any;
        const job = { id: 'job-invalid', data: invalidJobData } as Job<LLMGenerationJobData>;

        await expect(handler.processJob(job)).rejects.toThrow(
          'LLM generation job validation failed'
        );
      });

      it('should reject job with invalid personality structure', async () => {
        const invalidJobData = createValidJobData({
          personality: {
            name: 'Test',
            // Missing required fields like id, systemPrompt, model, etc.
          } as any,
        });
        const job = {
          id: 'job-invalid-personality',
          data: invalidJobData,
        } as Job<LLMGenerationJobData>;

        await expect(handler.processJob(job)).rejects.toThrow(
          'LLM generation job validation failed'
        );
      });
    });

    describe('without dependencies', () => {
      it('should generate response without processing dependencies', async () => {
        const jobData = createValidJobData();
        const job = { id: 'job-no-deps', data: jobData } as Job<LLMGenerationJobData>;

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);
        expect(mockGetJobResult).not.toHaveBeenCalled();
        expect(mockRAGService.generateResponse).toHaveBeenCalledTimes(1);
      });

      it('should include metadata in successful response', async () => {
        const jobData = createValidJobData();
        const job = { id: 'job-metadata', data: jobData } as Job<LLMGenerationJobData>;

        const result = await handler.processJob(job);

        expect(result.metadata).toBeDefined();
        expect(result.metadata?.retrievedMemories).toBe(0);
        expect(result.metadata?.tokensIn).toBe(100);
        expect(result.metadata?.tokensOut).toBe(50);
        expect(result.metadata?.modelUsed).toBe('anthropic/claude-sonnet-4');
        expect(result.metadata?.processingTimeMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('with dependencies', () => {
      it('should process audio transcription dependencies', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'audio-job-001',
              type: JobType.AudioTranscription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-001`,
            },
          ],
        });
        const job = { id: 'job-audio-dep', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValue({
          success: true,
          content: 'This is the transcribed audio content.',
        });

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);
        expect(mockGetJobResult).toHaveBeenCalledWith('audio-001');
        // Audio transcriptions are currently stored but not yet passed through
        // (unlike images which get converted to ProcessedAttachment[])
        // This test verifies the Redis fetch works correctly
      });

      it('should process image description dependencies', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'image-job-001',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}image-001`,
            },
          ],
        });
        const job = { id: 'job-image-dep', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValue({
          success: true,
          descriptions: [
            { url: 'https://example.com/img1.png', description: 'A scenic mountain landscape.' },
          ],
        });

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);
        expect(mockGetJobResult).toHaveBeenCalledWith('image-001');

        // Verify preprocessedAttachments are passed to RAG service (avoiding duplicate vision calls)
        const ragCall = mockRAGService.generateResponse.mock.calls[0];
        const context = ragCall[2]; // Third argument is context
        expect(context.preprocessedAttachments).toBeDefined();
        expect(context.preprocessedAttachments).toHaveLength(1);
        expect(context.preprocessedAttachments[0].description).toBe('A scenic mountain landscape.');
        expect(context.preprocessedAttachments[0].originalUrl).toBe('https://example.com/img1.png');
      });

      it('should handle multiple dependencies', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'audio-job-001',
              type: JobType.AudioTranscription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-001`,
            },
            {
              jobId: 'image-job-001',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}image-001`,
            },
          ],
        });
        const job = { id: 'job-multi-dep', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult
          .mockResolvedValueOnce({
            success: true,
            content: 'Audio transcript here.',
            attachmentUrl: 'https://example.com/audio.ogg',
            attachmentName: 'audio.ogg',
          })
          .mockResolvedValueOnce({
            success: true,
            descriptions: [
              { url: 'https://example.com/img.png', description: 'Image description here.' },
            ],
          });

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);
        expect(mockGetJobResult).toHaveBeenCalledTimes(2);

        // Verify preprocessedAttachments contains both image and audio
        const ragCall = mockRAGService.generateResponse.mock.calls[0];
        const context = ragCall[2];
        expect(context.preprocessedAttachments).toBeDefined();
        expect(context.preprocessedAttachments).toHaveLength(2);
        // Image comes first in the array, then audio
        expect(context.preprocessedAttachments[0].description).toBe('Image description here.');
        expect(context.preprocessedAttachments[0].type).toBe('image');
        expect(context.preprocessedAttachments[1].description).toBe('Audio transcript here.');
        expect(context.preprocessedAttachments[1].type).toBe('audio');
      });

      it('should handle failed dependency gracefully', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'audio-job-failed',
              type: JobType.AudioTranscription,
              status: JobStatus.Failed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-failed`,
            },
          ],
        });
        const job = { id: 'job-failed-dep', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValue({
          success: false,
          error: 'Transcription failed',
        });

        const result = await handler.processJob(job);

        // Should still succeed, just without the transcription
        expect(result.success).toBe(true);
        expect(job.data.__preprocessedAttachments).toBeUndefined();
      });

      it('should handle Redis fetch error gracefully', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'audio-job-redis-error',
              type: JobType.AudioTranscription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}audio-error`,
            },
          ],
        });
        const job = { id: 'job-redis-error', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockRejectedValue(new Error('Redis connection failed'));

        const result = await handler.processJob(job);

        // Should still succeed, just without the transcription
        expect(result.success).toBe(true);
        expect(job.data.__preprocessedAttachments).toBeUndefined();
      });

      it('should use jobId as key when resultKey is missing', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'audio-job-no-resultkey',
              type: JobType.AudioTranscription,
              status: JobStatus.Completed,
              // No resultKey provided
            },
          ],
        });
        const job = { id: 'job-no-resultkey', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValue({
          success: true,
          content: 'Transcribed content.',
        });

        await handler.processJob(job);

        expect(mockGetJobResult).toHaveBeenCalledWith('audio-job-no-resultkey');
      });
    });

    describe('referenced message attachment routing', () => {
      it('should route image with sourceReferenceNumber to referenceAttachments', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'ref-image-job-001',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}ref-image-001`,
            },
          ],
        });
        const job = { id: 'job-ref-image', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValue({
          success: true,
          descriptions: [
            {
              url: 'https://example.com/ref-img.png',
              description: 'Referenced image description.',
            },
          ],
          sourceReferenceNumber: 1, // This indicates it's from referenced message 1
        });

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);

        // Verify it went to preprocessedReferenceAttachments, NOT preprocessedAttachments
        const ragCall = mockRAGService.generateResponse.mock.calls[0];
        const context = ragCall[2];

        // Direct attachments should be empty/undefined
        expect(context.preprocessedAttachments).toBeUndefined();

        // Referenced attachments should have the image
        expect(context.preprocessedReferenceAttachments).toBeDefined();
        expect(context.preprocessedReferenceAttachments[1]).toBeDefined();
        expect(context.preprocessedReferenceAttachments[1]).toHaveLength(1);
        expect(context.preprocessedReferenceAttachments[1][0].description).toBe(
          'Referenced image description.'
        );
      });

      it('should route audio with sourceReferenceNumber to referenceAttachments', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'ref-audio-job-001',
              type: JobType.AudioTranscription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}ref-audio-001`,
            },
          ],
        });
        const job = { id: 'job-ref-audio', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValue({
          success: true,
          content: 'Referenced audio transcription.',
          attachmentUrl: 'https://example.com/ref-audio.ogg',
          attachmentName: 'ref-audio.ogg',
          sourceReferenceNumber: 2, // From referenced message 2
        });

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);

        const ragCall = mockRAGService.generateResponse.mock.calls[0];
        const context = ragCall[2];

        // Direct attachments should be empty/undefined
        expect(context.preprocessedAttachments).toBeUndefined();

        // Referenced attachments should have the audio
        expect(context.preprocessedReferenceAttachments).toBeDefined();
        expect(context.preprocessedReferenceAttachments[2]).toBeDefined();
        expect(context.preprocessedReferenceAttachments[2]).toHaveLength(1);
        expect(context.preprocessedReferenceAttachments[2][0].description).toBe(
          'Referenced audio transcription.'
        );
        expect(context.preprocessedReferenceAttachments[2][0].type).toBe('audio');
      });

      it('should route mixed direct and referenced attachments to correct destinations', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'direct-image-001',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}direct-image`,
            },
            {
              jobId: 'ref-image-001',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}ref-image`,
            },
            {
              jobId: 'direct-audio-001',
              type: JobType.AudioTranscription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}direct-audio`,
            },
            {
              jobId: 'ref-audio-001',
              type: JobType.AudioTranscription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}ref-audio`,
            },
          ],
        });
        const job = { id: 'job-mixed-routing', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult
          // Direct image (no sourceReferenceNumber)
          .mockResolvedValueOnce({
            success: true,
            descriptions: [{ url: 'https://example.com/direct.png', description: 'Direct image.' }],
          })
          // Referenced image (sourceReferenceNumber: 1)
          .mockResolvedValueOnce({
            success: true,
            descriptions: [
              { url: 'https://example.com/ref.png', description: 'Referenced image.' },
            ],
            sourceReferenceNumber: 1,
          })
          // Direct audio (no sourceReferenceNumber)
          .mockResolvedValueOnce({
            success: true,
            content: 'Direct audio.',
            attachmentUrl: 'https://example.com/direct.ogg',
            attachmentName: 'direct.ogg',
          })
          // Referenced audio (sourceReferenceNumber: 1)
          .mockResolvedValueOnce({
            success: true,
            content: 'Referenced audio.',
            attachmentUrl: 'https://example.com/ref.ogg',
            attachmentName: 'ref.ogg',
            sourceReferenceNumber: 1,
          });

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);

        const ragCall = mockRAGService.generateResponse.mock.calls[0];
        const context = ragCall[2];

        // Direct attachments should have 2 items (image + audio)
        expect(context.preprocessedAttachments).toBeDefined();
        expect(context.preprocessedAttachments).toHaveLength(2);
        expect(context.preprocessedAttachments[0].description).toBe('Direct image.');
        expect(context.preprocessedAttachments[1].description).toBe('Direct audio.');

        // Referenced attachments should have 2 items under reference 1
        expect(context.preprocessedReferenceAttachments).toBeDefined();
        expect(context.preprocessedReferenceAttachments[1]).toHaveLength(2);
        expect(context.preprocessedReferenceAttachments[1][0].description).toBe(
          'Referenced image.'
        );
        expect(context.preprocessedReferenceAttachments[1][1].description).toBe(
          'Referenced audio.'
        );
      });

      it('should handle multiple reference numbers correctly', async () => {
        const jobData = createValidJobData({
          dependencies: [
            {
              jobId: 'ref1-image',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}ref1-img`,
            },
            {
              jobId: 'ref2-image',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}ref2-img`,
            },
          ],
        });
        const job = { id: 'job-multi-refs', data: jobData } as Job<LLMGenerationJobData>;

        mockGetJobResult
          .mockResolvedValueOnce({
            success: true,
            descriptions: [{ url: 'https://example.com/ref1.png', description: 'Ref 1 image.' }],
            sourceReferenceNumber: 1,
          })
          .mockResolvedValueOnce({
            success: true,
            descriptions: [{ url: 'https://example.com/ref2.png', description: 'Ref 2 image.' }],
            sourceReferenceNumber: 2,
          });

        const result = await handler.processJob(job);

        expect(result.success).toBe(true);

        const ragCall = mockRAGService.generateResponse.mock.calls[0];
        const context = ragCall[2];

        // Should have separate entries for each reference number
        expect(context.preprocessedReferenceAttachments).toBeDefined();
        expect(context.preprocessedReferenceAttachments[1]).toHaveLength(1);
        expect(context.preprocessedReferenceAttachments[1][0].description).toBe('Ref 1 image.');
        expect(context.preprocessedReferenceAttachments[2]).toHaveLength(1);
        expect(context.preprocessedReferenceAttachments[2][0].description).toBe('Ref 2 image.');
      });
    });

    describe('RAG service integration', () => {
      it('should pass correct parameters to RAG service', async () => {
        const jobData = createValidJobData({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            serverId: 'server-012',
            sessionId: 'session-xyz',
            conversationHistory: [
              {
                role: 'user' as any,
                content: 'Previous message',
                createdAt: '2025-01-01T12:00:00Z',
              },
            ],
          },
        });
        const job = { id: 'job-rag', data: jobData } as Job<LLMGenerationJobData>;

        mockExtractParticipants.mockReturnValue([
          { personaId: 'user-456', personaName: 'TestUser', isActive: true },
        ]);

        await handler.processJob(job);

        expect(mockRAGService.generateResponse).toHaveBeenCalledWith(
          jobData.personality,
          jobData.message,
          expect.objectContaining({
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            serverId: 'server-012',
            sessionId: 'session-xyz',
          }),
          expect.objectContaining({
            userApiKey: undefined,
            isGuestMode: false, // no ApiKeyResolver provided, defaults to false
          })
        );
      });

      it('should resolve and pass API key from ApiKeyResolver (BYOK)', async () => {
        // Create handler with mock ApiKeyResolver
        const mockApiKeyResolver = createMockApiKeyResolver();
        const handlerWithResolver = new LLMGenerationHandler(
          mockRAGService as any,
          mockApiKeyResolver
        );

        // Configure mock to return a user's API key (BYOK user = not guest mode)
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockResolvedValue({
          apiKey: 'user-resolved-key-from-db',
          source: 'user',
          provider: AIProvider.OpenRouter,
          userId: 'user-456',
          isGuestMode: false,
        } as ApiKeyResolutionResult);

        const jobData = createValidJobData();
        const job = { id: 'job-user-key', data: jobData } as Job<LLMGenerationJobData>;

        await handlerWithResolver.processJob(job);

        // Verify ApiKeyResolver was called with correct userId and provider
        expect(mockApiKeyResolver.resolveApiKey).toHaveBeenCalledWith(
          'user-456', // userId from context
          AIProvider.OpenRouter
        );

        // Verify the resolved key is passed to RAG service
        expect(mockRAGService.generateResponse).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String),
          expect.any(Object),
          expect.objectContaining({
            userApiKey: 'user-resolved-key-from-db',
            isGuestMode: false, // BYOK user has their own key
          })
        );
      });

      it('should fall back to undefined key when ApiKeyResolver fails', async () => {
        // Create handler with mock ApiKeyResolver that throws
        const mockApiKeyResolver = createMockApiKeyResolver();
        const handlerWithResolver = new LLMGenerationHandler(
          mockRAGService as any,
          mockApiKeyResolver
        );

        // Configure mock to throw an error
        vi.mocked(mockApiKeyResolver.resolveApiKey).mockRejectedValue(
          new Error('No API key available')
        );

        const jobData = createValidJobData();
        const job = { id: 'job-fallback', data: jobData } as Job<LLMGenerationJobData>;

        await handlerWithResolver.processJob(job);

        // Verify RAG service is called with undefined key (system fallback) and guest mode
        expect(mockRAGService.generateResponse).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String),
          expect.any(Object),
          expect.objectContaining({
            userApiKey: undefined, // no resolved key
            isGuestMode: true, // fallback to guest mode when resolution fails
          })
        );
      });
    });

    describe('error handling', () => {
      /**
       * Error Propagation Behavior:
       *
       * ValidationStep errors propagate as EXCEPTIONS (fail BullMQ job directly).
       * Post-validation errors are CAUGHT and return error results {success: false}.
       *
       * This design ensures:
       * - Malformed job data fails the job immediately (programming error)
       * - Application errors (rate limits, model unavailable) return graceful errors to users
       */

      it('should propagate validation errors as exceptions (not error results)', async () => {
        // Validation errors indicate programming errors - they should throw,
        // NOT return {success: false, error: ...}
        const invalidJobData = {
          requestId: 'test-validation-propagation',
          // Missing required fields: jobType, personality, message, context
        } as any;
        const job = {
          id: 'job-validation-exception',
          data: invalidJobData,
        } as Job<LLMGenerationJobData>;

        // Should throw exception (rejects), not return error result
        await expect(handler.processJob(job)).rejects.toThrow(
          'LLM generation job validation failed'
        );

        // Verify RAG service was never called (stopped at validation)
        expect(mockRAGService.generateResponse).not.toHaveBeenCalled();
      });

      it('should return failure result when RAG service throws', async () => {
        const jobData = createValidJobData();
        const job = { id: 'job-rag-error', data: jobData } as Job<LLMGenerationJobData>;

        mockRAGService.generateResponse.mockRejectedValue(new Error('AI provider rate limited'));

        const result = await handler.processJob(job);

        expect(result.success).toBe(false);
        expect(result.error).toBe('AI provider rate limited');
        expect(result.requestId).toBe('test-req-001');
        expect(result.metadata?.processingTimeMs).toBeGreaterThanOrEqual(0);
        // Verify error metadata includes model/config info for footer display
        // (provider is undefined when no apiKeyResolver is provided)
        expect(result.metadata?.modelUsed).toBe('anthropic/claude-sonnet-4');
        expect(result.metadata?.providerUsed).toBeUndefined();
        expect(result.metadata?.configSource).toBe('personality');
        expect(result.metadata?.isGuestMode).toBe(false);
      });

      it('should handle unknown error type', async () => {
        const jobData = createValidJobData();
        const job = { id: 'job-unknown-error', data: jobData } as Job<LLMGenerationJobData>;

        mockRAGService.generateResponse.mockRejectedValue('Some string error');

        const result = await handler.processJob(job);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown error');
        // Verify error metadata includes model/config info for footer display
        expect(result.metadata?.modelUsed).toBe('anthropic/claude-sonnet-4');
        expect(result.metadata?.providerUsed).toBeUndefined();
        expect(result.metadata?.configSource).toBe('personality');
        expect(result.metadata?.isGuestMode).toBe(false);
      });
    });

    describe('conversation history processing', () => {
      it('should extract participants from conversation history', async () => {
        const jobData = createValidJobData({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            conversationHistory: [
              {
                role: 'user' as any,
                content: 'Hello',
                personaId: 'persona-1',
                personaName: 'Alice',
              },
              {
                role: 'assistant' as any,
                content: 'Hi there',
              },
            ],
          },
        });
        const job = { id: 'job-participants', data: jobData } as Job<LLMGenerationJobData>;

        await handler.processJob(job);

        expect(mockExtractParticipants).toHaveBeenCalledWith(
          jobData.context.conversationHistory,
          undefined, // activePersonaId
          undefined // activePersonaName
        );
      });

      it('should convert conversation history to BaseMessage format', async () => {
        const jobData = createValidJobData({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            conversationHistory: [{ role: 'user' as any, content: 'Test message' }],
          },
        });
        const job = { id: 'job-convert', data: jobData } as Job<LLMGenerationJobData>;

        await handler.processJob(job);

        expect(mockConvertConversationHistory).toHaveBeenCalledWith(
          jobData.context.conversationHistory,
          'TestBot' // personality name
        );
      });

      it('should calculate oldest history timestamp for LTM deduplication', async () => {
        const jobData = createValidJobData({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            conversationHistory: [
              { role: 'user' as any, content: 'First', createdAt: '2025-01-01T10:00:00Z' },
              { role: 'assistant' as any, content: 'Response', createdAt: '2025-01-01T10:01:00Z' },
              { role: 'user' as any, content: 'Second', createdAt: '2025-01-01T10:02:00Z' },
            ],
          },
        });
        const job = { id: 'job-timestamp', data: jobData } as Job<LLMGenerationJobData>;

        await handler.processJob(job);

        // Should pass oldestHistoryTimestamp to RAG service
        expect(mockRAGService.generateResponse).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String),
          expect.objectContaining({
            oldestHistoryTimestamp: new Date('2025-01-01T10:00:00Z').getTime(),
          }),
          expect.objectContaining({
            userApiKey: undefined,
            isGuestMode: false,
          })
        );
      });

      it('should add mentioned personas to participants when not already present', async () => {
        const jobData = createValidJobData({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            activePersonaId: 'active-persona-id',
            activePersonaName: 'ActiveUser',
            conversationHistory: [],
            mentionedPersonas: [
              { personaId: 'mentioned-persona-1', personaName: 'MentionedUser1' },
              { personaId: 'mentioned-persona-2', personaName: 'MentionedUser2' },
            ],
          },
        });
        const job = { id: 'job-mentioned', data: jobData } as Job<LLMGenerationJobData>;

        // extractParticipants returns just the active user initially
        mockExtractParticipants.mockReturnValue([
          { personaId: 'active-persona-id', personaName: 'ActiveUser', isActive: true },
        ]);

        await handler.processJob(job);

        // Verify mentioned personas are added with isActive: false
        expect(mockRAGService.generateResponse).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String),
          expect.objectContaining({
            participants: expect.arrayContaining([
              { personaId: 'active-persona-id', personaName: 'ActiveUser', isActive: true },
              { personaId: 'mentioned-persona-1', personaName: 'MentionedUser1', isActive: false },
              { personaId: 'mentioned-persona-2', personaName: 'MentionedUser2', isActive: false },
            ]),
          }),
          expect.objectContaining({
            userApiKey: undefined,
            isGuestMode: false,
          })
        );
      });

      it('should not duplicate mentioned personas that are already in participants', async () => {
        const jobData = createValidJobData({
          context: {
            userId: 'user-456',
            userName: 'TestUser',
            channelId: 'channel-789',
            activePersonaId: 'active-persona-id',
            activePersonaName: 'ActiveUser',
            conversationHistory: [],
            mentionedPersonas: [
              { personaId: 'active-persona-id', personaName: 'ActiveUser' }, // Already in participants
              { personaId: 'new-persona-id', personaName: 'NewUser' },
            ],
          },
        });
        const job = { id: 'job-no-dup', data: jobData } as Job<LLMGenerationJobData>;

        // extractParticipants already includes the active user
        mockExtractParticipants.mockReturnValue([
          { personaId: 'active-persona-id', personaName: 'ActiveUser', isActive: true },
        ]);

        await handler.processJob(job);

        // Should have exactly 2 participants (no duplicate)
        const call = mockRAGService.generateResponse.mock.calls[0];
        const ragContext = call[2];
        expect(ragContext.participants).toHaveLength(2);
        expect(ragContext.participants).toContainEqual({
          personaId: 'active-persona-id',
          personaName: 'ActiveUser',
          isActive: true,
        });
        expect(ragContext.participants).toContainEqual({
          personaId: 'new-persona-id',
          personaName: 'NewUser',
          isActive: false,
        });
      });
    });

    describe('response structure', () => {
      it('should include attachment descriptions in response', async () => {
        const jobData = createValidJobData();
        const job = { id: 'job-attachments', data: jobData } as Job<LLMGenerationJobData>;

        mockRAGService.generateResponse.mockResolvedValue({
          content: 'Response text',
          attachmentDescriptions: 'Image shows a sunset.',
          retrievedMemories: 2,
          tokensIn: 150,
          tokensOut: 50,
          modelUsed: 'test-model',
        });

        const result = await handler.processJob(job);

        expect(result.attachmentDescriptions).toBe('Image shows a sunset.');
      });

      it('should include referenced messages descriptions in response', async () => {
        const jobData = createValidJobData();
        const job = { id: 'job-refs', data: jobData } as Job<LLMGenerationJobData>;

        mockRAGService.generateResponse.mockResolvedValue({
          content: 'Response about referenced messages',
          referencedMessagesDescriptions: 'User replied to: "Original message"',
          retrievedMemories: 1,
          tokensIn: 130,
          tokensOut: 50,
          modelUsed: 'test-model',
        });

        const result = await handler.processJob(job);

        expect(result.referencedMessagesDescriptions).toBe('User replied to: "Original message"');
      });
    });

    describe('cross-job state isolation', () => {
      it('should not leak preprocessing results from one job to another', async () => {
        // Job 1: Has preprocessed attachments from dependencies
        const job1Data = createValidJobData({
          dependencies: [
            {
              jobId: 'image-job-001',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}image-001`,
            },
          ],
        });
        const job1 = { id: 'job-1-with-deps', data: job1Data } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValueOnce({
          success: true,
          descriptions: [
            { url: 'https://example.com/job1-image.png', description: 'Job 1 image description' },
          ],
        });

        const result1 = await handler.processJob(job1);
        expect(result1.success).toBe(true);

        // Verify Job 1 had preprocessed attachments
        const job1RagCall = mockRAGService.generateResponse.mock.calls[0];
        const job1Context = job1RagCall[2];
        expect(job1Context.preprocessedAttachments).toBeDefined();
        expect(job1Context.preprocessedAttachments).toHaveLength(1);
        expect(job1Context.preprocessedAttachments[0].description).toBe('Job 1 image description');

        // Clear mocks for job 2
        mockRAGService.generateResponse.mockClear();
        mockGetJobResult.mockClear();

        // Job 2: Has NO dependencies - should NOT inherit Job 1's preprocessing results
        const job2Data = createValidJobData({
          dependencies: undefined, // No dependencies!
        });
        const job2 = { id: 'job-2-no-deps', data: job2Data } as Job<LLMGenerationJobData>;

        const result2 = await handler.processJob(job2);
        expect(result2.success).toBe(true);

        // Verify Job 2 did NOT receive Job 1's preprocessed attachments
        const job2RagCall = mockRAGService.generateResponse.mock.calls[0];
        const job2Context = job2RagCall[2];
        expect(job2Context.preprocessedAttachments).toBeUndefined();

        // Redis should not have been called since Job 2 has no dependencies
        expect(mockGetJobResult).not.toHaveBeenCalled();
      });

      it('should reset preprocessing results even when job has empty dependencies array', async () => {
        // Job 1: Has preprocessed attachments
        const job1Data = createValidJobData({
          dependencies: [
            {
              jobId: 'image-job-001',
              type: JobType.ImageDescription,
              status: JobStatus.Completed,
              resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}image-001`,
            },
          ],
        });
        const job1 = { id: 'job-1', data: job1Data } as Job<LLMGenerationJobData>;

        mockGetJobResult.mockResolvedValueOnce({
          success: true,
          descriptions: [{ url: 'https://example.com/job1-image.png', description: 'Job 1 image' }],
        });

        await handler.processJob(job1);

        // Clear mocks
        mockRAGService.generateResponse.mockClear();
        mockGetJobResult.mockClear();

        // Job 2: Has empty dependencies array (not undefined)
        const job2Data = createValidJobData({
          dependencies: [], // Empty array!
        });
        const job2 = { id: 'job-2-empty-deps', data: job2Data } as Job<LLMGenerationJobData>;

        const result2 = await handler.processJob(job2);
        expect(result2.success).toBe(true);

        // Verify Job 2 has no preprocessing results
        const job2RagCall = mockRAGService.generateResponse.mock.calls[0];
        const job2Context = job2RagCall[2];
        expect(job2Context.preprocessedAttachments).toBeUndefined();
      });
    });
  });
});
