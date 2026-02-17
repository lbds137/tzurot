/**
 * BullMQ Job Contract Tests
 *
 * These tests verify the contract between api-gateway (job producer) and
 * ai-worker (job consumer). They ensure both services use the same schemas
 * and types, catching breaking changes during refactoring.
 *
 * WHY THIS IS CRITICAL:
 * - Phase 1 will refactor the database schema extensively
 * - Job payloads reference database entities (Personality, User, etc.)
 * - Schema changes could silently break job contracts
 * - This test catches those breaks at build time
 */

import { describe, it, expect } from 'vitest';
import {
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
  anyJobDataSchema,
  audioTranscriptionResultSchema,
  type AudioTranscriptionJobData,
  type ImageDescriptionJobData,
  type LLMGenerationJobData,
  type AudioTranscriptionResult,
} from './jobs.js';
import {
  shapesImportJobDataSchema,
  shapesImportResultSchema,
  type ShapesImportJobData,
  type ShapesImportJobResult,
  shapesExportJobDataSchema,
  type ShapesExportJobData,
  type ShapesExportJobResult,
  shapesExportResultSchema,
} from './shapes-import.js';
import { JobType, JobStatus } from '../constants/queue.js';
import { MessageRole } from '../constants/message.js';
import {
  MINIMAL_CONTEXT,
  AUDIO_ATTACHMENT,
  DISCORD_DESTINATION,
  REQUEST_IDS,
} from './test/fixtures.js';

describe('BullMQ Job Contract Tests', () => {
  describe('Schema Validation - Audio Transcription Job', () => {
    it('should validate a valid audio transcription job', () => {
      const validJob: AudioTranscriptionJobData = {
        requestId: REQUEST_IDS.audioTranscription,
        jobType: JobType.AudioTranscription,
        responseDestination: DISCORD_DESTINATION,
        attachment: AUDIO_ATTACHMENT,
        context: { ...MINIMAL_CONTEXT, channelId: 'channel-123' },
      };

      const result = audioTranscriptionJobDataSchema.safeParse(validJob);
      expect(result.success).toBe(true);
    });

    it('should reject audio transcription job missing required fields', () => {
      const invalidJob = {
        requestId: 'req-test-123',
        jobType: JobType.AudioTranscription,
        // Missing: responseDestination, attachment, context
      };

      const result = audioTranscriptionJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it('should reject audio transcription job with wrong jobType', () => {
      const invalidJob = {
        requestId: 'req-test-123',
        jobType: JobType.LLMGeneration, // Wrong type
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        attachment: {
          url: 'https://example.com/audio.mp3',
          contentType: 'audio/mpeg',
        },
        context: { userId: 'user-123', channelId: 'channel-123' },
      };

      const result = audioTranscriptionJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });
  });

  describe('Schema Validation - Image Description Job', () => {
    it('should validate a valid image description job', () => {
      const validJob: ImageDescriptionJobData = {
        requestId: 'req-test-456',
        jobType: JobType.ImageDescription,
        responseDestination: {
          type: 'discord',
          channelId: 'channel-123',
        },
        attachments: [
          {
            url: 'https://example.com/image.png',
            contentType: 'image/png',
            name: 'image.png',
            size: 2048,
          },
        ],
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-123',
        },
      };

      const result = imageDescriptionJobDataSchema.safeParse(validJob);
      expect(result.success).toBe(true);
    });

    it('should reject image description job with empty attachments array', () => {
      const invalidJob = {
        requestId: 'req-test-456',
        jobType: JobType.ImageDescription,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        attachments: [], // Empty array not allowed
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        context: { userId: 'user-123', channelId: 'channel-123' },
      };

      const result = imageDescriptionJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.message.includes('At least one'))).toBe(
          true
        );
      }
    });
  });

  describe('Schema Validation - Audio Transcription Result', () => {
    it('should validate a successful transcription result', () => {
      const validResult: AudioTranscriptionResult = {
        requestId: 'req-audio-123',
        success: true,
        content: 'This is the transcribed text from the audio file.',
        attachmentUrl: 'https://cdn.discordapp.com/attachments/123/456/audio.ogg',
        attachmentName: 'audio.ogg',
        metadata: {
          processingTimeMs: 1500,
          duration: 30.5,
        },
      };

      const result = audioTranscriptionResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('This is the transcribed text from the audio file.');
        expect(result.data.success).toBe(true);
      }
    });

    it('should validate a failed transcription result', () => {
      const failedResult: AudioTranscriptionResult = {
        requestId: 'req-audio-456',
        success: false,
        error: 'Audio file too large or corrupted',
        attachmentUrl: 'https://cdn.discordapp.com/attachments/123/456/audio.ogg',
        attachmentName: 'audio.ogg',
        metadata: {
          processingTimeMs: 250,
          duration: 0,
        },
      };

      const result = audioTranscriptionResultSchema.safeParse(failedResult);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(false);
        expect(result.data.error).toBe('Audio file too large or corrupted');
        expect(result.data.content).toBeUndefined();
      }
    });

    it('should validate result with sourceReferenceNumber', () => {
      const validResult: AudioTranscriptionResult = {
        requestId: 'req-audio-789',
        success: true,
        content: 'Transcribed from referenced message',
        sourceReferenceNumber: 1,
        metadata: {
          processingTimeMs: 800,
        },
      };

      const result = audioTranscriptionResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sourceReferenceNumber).toBe(1);
      }
    });

    it('should reject result missing required requestId', () => {
      const invalidResult = {
        success: true,
        content: 'Some content',
      };

      const result = audioTranscriptionResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it('should reject result missing required success field', () => {
      const invalidResult = {
        requestId: 'req-test',
        content: 'Some content',
      };

      const result = audioTranscriptionResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it('should validate minimal result (only required fields)', () => {
      const minimalResult = {
        requestId: 'req-minimal',
        success: true,
      };

      const result = audioTranscriptionResultSchema.safeParse(minimalResult);
      expect(result.success).toBe(true);
    });
  });

  describe('Schema Validation - LLM Generation Job', () => {
    it('should validate a valid LLM generation job with minimal fields', () => {
      const validJob: LLMGenerationJobData = {
        requestId: 'req-test-789',
        jobType: JobType.LLMGeneration,
        responseDestination: {
          type: 'discord',
          channelId: 'channel-123',
        },
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'Hello, world!',
        context: {
          userId: 'user-123',
        },
      };

      const result = llmGenerationJobDataSchema.safeParse(validJob);
      expect(result.success).toBe(true);
    });

    it('should validate LLM generation job with full context', () => {
      const validJob: LLMGenerationJobData = {
        requestId: 'req-test-789',
        jobType: JobType.LLMGeneration,
        responseDestination: {
          type: 'discord',
          channelId: 'channel-123',
        },
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'Hello, world!',
        context: {
          userId: 'user-123',
          userName: 'TestUser',
          channelId: 'channel-123',
          serverId: 'server-123',
          sessionId: 'session-123',
          activePersonaId: 'persona-123',
          activePersonaName: 'TestPersona',
          conversationHistory: [
            {
              role: MessageRole.User,
              content: 'Previous message',
              tokenCount: 10,
              createdAt: new Date().toISOString(),
            },
          ],
          attachments: [
            {
              url: 'https://example.com/file.pdf',
              contentType: 'application/pdf',
              name: 'file.pdf',
              size: 1024,
            },
          ],
          environment: {
            type: 'guild',
            guild: {
              id: 'guild-123',
              name: 'Test Guild',
            },
            channel: {
              id: 'channel-123',
              name: 'test-channel',
              type: 'GUILD_TEXT',
            },
          },
          referencedMessages: [
            {
              referenceNumber: 1,
              discordMessageId: 'msg-123',
              discordUserId: 'user-456',
              authorUsername: 'testuser',
              authorDisplayName: 'Test User',
              content: 'Referenced content',
              embeds: '',
              timestamp: new Date().toISOString(),
              locationContext: 'Test Server / #general',
            },
          ],
        },
        dependencies: [
          {
            jobId: 'audio-job-123',
            type: JobType.AudioTranscription,
            status: JobStatus.Completed,
            resultKey: 'result:audio-job-123',
          },
        ],
      };

      const result = llmGenerationJobDataSchema.safeParse(validJob);
      expect(result.success).toBe(true);
    });

    it('should accept both string and object message types', () => {
      // String message
      const jobWithString: LLMGenerationJobData = {
        requestId: 'req-test-string',
        jobType: JobType.LLMGeneration,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'String message',
        context: { userId: 'user-123' },
      };

      const resultString = llmGenerationJobDataSchema.safeParse(jobWithString);
      expect(resultString.success).toBe(true);

      // Object message (for multimodal)
      const jobWithObject: LLMGenerationJobData = {
        requestId: 'req-test-object',
        jobType: JobType.LLMGeneration,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: { type: 'multimodal', content: 'Object message' },
        context: { userId: 'user-123' },
      };

      const resultObject = llmGenerationJobDataSchema.safeParse(jobWithObject);
      expect(resultObject.success).toBe(true);
    });
  });

  describe('Discriminated Union Schema', () => {
    it('should correctly discriminate audio transcription jobs', () => {
      const audioJob = {
        requestId: 'req-audio',
        jobType: JobType.AudioTranscription,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        attachment: {
          url: 'https://example.com/audio.mp3',
          contentType: 'audio/mpeg',
        },
        context: { userId: 'user-123', channelId: 'channel-123' },
      };

      const result = anyJobDataSchema.safeParse(audioJob);
      expect(result.success).toBe(true);
    });

    it('should correctly discriminate image description jobs', () => {
      const imageJob = {
        requestId: 'req-image',
        jobType: JobType.ImageDescription,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        attachments: [
          {
            url: 'https://example.com/image.png',
            contentType: 'image/png',
          },
        ],
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        context: { userId: 'user-123', channelId: 'channel-123' },
      };

      const result = anyJobDataSchema.safeParse(imageJob);
      expect(result.success).toBe(true);
    });

    it('should correctly discriminate LLM generation jobs', () => {
      const llmJob = {
        requestId: 'req-llm',
        jobType: JobType.LLMGeneration,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'Test message',
        context: { userId: 'user-123' },
      };

      const result = anyJobDataSchema.safeParse(llmJob);
      expect(result.success).toBe(true);
    });

    it('should reject jobs with invalid jobType discriminator', () => {
      const invalidJob = {
        requestId: 'req-invalid',
        jobType: 'InvalidJobType', // Not a valid JobType enum value
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        message: 'Test',
        context: { userId: 'user-123' },
      };

      const result = anyJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });
  });

  describe('Schema Version Field', () => {
    it('should default version to 1 when not provided', () => {
      const jobWithoutVersion = {
        requestId: 'req-test',
        jobType: JobType.AudioTranscription,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        attachment: {
          url: 'https://example.com/audio.mp3',
          contentType: 'audio/mpeg',
        },
        context: { userId: 'user-123', channelId: 'channel-123' },
      };

      const result = audioTranscriptionJobDataSchema.safeParse(jobWithoutVersion);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
      }
    });

    it('should accept explicit version 1', () => {
      const jobWithVersion = {
        requestId: 'req-test',
        jobType: JobType.AudioTranscription,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        attachment: {
          url: 'https://example.com/audio.mp3',
          contentType: 'audio/mpeg',
        },
        context: { userId: 'user-123', channelId: 'channel-123' },
        version: 1,
      };

      const result = audioTranscriptionJobDataSchema.safeParse(jobWithVersion);
      expect(result.success).toBe(true);
    });
  });

  describe('JobContext Guild Info Fields', () => {
    it('should include participantGuildInfo for extended context participants', () => {
      const validJob: LLMGenerationJobData = {
        requestId: 'req-guild-info-test',
        jobType: JobType.LLMGeneration,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'Hello!',
        context: {
          userId: 'user-123',
          activePersonaId: 'persona-123',
          activePersonaName: 'ActiveUser',
          activePersonaGuildInfo: {
            roles: ['Admin', 'Developer'],
            displayColor: '#FF5733',
            joinedAt: '2023-05-15T10:30:00.000Z',
          },
          participantGuildInfo: {
            'discord:user-456': {
              roles: ['Member', 'Verified'],
              displayColor: '#00FF00',
              joinedAt: '2024-01-20T08:15:00.000Z',
            },
            'discord:user-789': {
              roles: ['Moderator'],
              displayColor: '#0000FF',
            },
          },
        },
      };

      const result = llmGenerationJobDataSchema.safeParse(validJob);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.context.participantGuildInfo).toBeDefined();
        expect(result.data.context.participantGuildInfo?.['discord:user-456']).toEqual({
          roles: ['Member', 'Verified'],
          displayColor: '#00FF00',
          joinedAt: '2024-01-20T08:15:00.000Z',
        });
        expect(result.data.context.participantGuildInfo?.['discord:user-789']).toEqual({
          roles: ['Moderator'],
          displayColor: '#0000FF',
        });
      }
    });

    it('should accept context without participantGuildInfo (optional field)', () => {
      const validJob: LLMGenerationJobData = {
        requestId: 'req-no-guild-info',
        jobType: JobType.LLMGeneration,
        responseDestination: { type: 'discord', channelId: 'channel-123' },
        personality: {
          id: 'personality-123',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test',
          systemPrompt: 'You are a helpful assistant',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2000,
          contextWindowTokens: 8192,
          characterInfo: 'A helpful test personality',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'Hello!',
        context: {
          userId: 'user-123',
        },
      };

      const result = llmGenerationJobDataSchema.safeParse(validJob);
      expect(result.success).toBe(true);
    });
  });

  describe('Producer-Consumer Contract', () => {
    it('should document the contract: producer validates, consumer trusts', () => {
      // This test serves as documentation:
      //
      // JOB DATA CONTRACT (api-gateway → ai-worker):
      //
      // PRODUCER (api-gateway):
      // - Uses addValidatedJob() from validatedQueue.ts
      // - Validates ALL jobs with Zod schemas before enqueueing
      // - Throws error if validation fails (job never enters queue)
      //
      // CONSUMER (ai-worker):
      // - Receives jobs from queue
      // - Can trust job structure matches TypeScript types
      // - Should NOT duplicate validation (already done by producer)
      //
      // JOB RESULT CONTRACT (ai-worker → api-gateway):
      //
      // PRODUCER (ai-worker):
      // - Returns results matching *ResultSchema (e.g., AudioTranscriptionResult)
      // - Uses shared types from @tzurot/common-types
      //
      // CONSUMER (api-gateway):
      // - Uses job.waitUntilFinished() to receive results
      // - Type-casts result using shared types (e.g., `as AudioTranscriptionResult`)
      // - See: transcribe.ts:108 for example usage
      //
      // CONTRACT:
      // - Jobs in queue are ALWAYS valid (guaranteed by producer validation)
      // - Results from ai-worker match shared result types
      // - Consumer code should use shared types from @tzurot/common-types
      // - Breaking changes to schemas MUST be coordinated between services
      //
      // PHASE 1 SAFETY:
      // - These tests catch schema/type mismatches at build time
      // - Prevents silent breakage during database schema refactoring
      // - Changes to Personality, User, or Context require updating these tests

      expect(true).toBe(true); // This test always passes - it's just documentation
    });
  });

  describe('Schema Validation - Shapes Import Job', () => {
    const validJobData: ShapesImportJobData = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      discordUserId: '123456789012345678',
      sourceSlug: 'test-shape',
      importJobId: '660e8400-e29b-41d4-a716-446655440000',
      importType: 'full',
    };

    it('should validate a valid full import job', () => {
      const result = shapesImportJobDataSchema.safeParse(validJobData);
      expect(result.success).toBe(true);
    });

    it('should validate a memory_only import with existingPersonalityId', () => {
      const memoryOnlyJob: ShapesImportJobData = {
        ...validJobData,
        importType: 'memory_only',
        existingPersonalityId: '770e8400-e29b-41d4-a716-446655440000',
      };

      const result = shapesImportJobDataSchema.safeParse(memoryOnlyJob);
      expect(result.success).toBe(true);
    });

    it('should reject job with invalid importType', () => {
      const invalidJob = { ...validJobData, importType: 'partial' };
      const result = shapesImportJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });

    it('should reject job with non-UUID userId', () => {
      const invalidJob = { ...validJobData, userId: 'not-a-uuid' };
      const result = shapesImportJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });

    it('should reject job missing required fields', () => {
      const invalidJob = { userId: validJobData.userId };
      const result = shapesImportJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });

    it('should reject job with empty sourceSlug', () => {
      const invalidJob = { ...validJobData, sourceSlug: '' };
      const result = shapesImportJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });
  });

  describe('Schema Validation - Shapes Import Result', () => {
    it('should validate a successful import result', () => {
      const validResult: ShapesImportJobResult = {
        success: true,
        personalityId: '550e8400-e29b-41d4-a716-446655440000',
        personalitySlug: 'test-shape',
        memoriesImported: 150,
        memoriesFailed: 2,
        importType: 'full',
      };

      const result = shapesImportResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it('should validate a failed import result', () => {
      const failedResult: ShapesImportJobResult = {
        success: false,
        memoriesImported: 0,
        memoriesFailed: 0,
        importType: 'full',
        error: 'No shapes.inc credentials found. Use /shapes auth first.',
      };

      const result = shapesImportResultSchema.safeParse(failedResult);
      expect(result.success).toBe(true);
    });

    it('should reject result with negative memoriesImported', () => {
      const invalidResult = {
        success: true,
        memoriesImported: -1,
        memoriesFailed: 0,
        importType: 'full',
      };

      const result = shapesImportResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it('should reject result missing required success field', () => {
      const invalidResult = {
        memoriesImported: 10,
        memoriesFailed: 0,
        importType: 'full',
      };

      const result = shapesImportResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });
  });

  describe('Schema Validation - Shapes Export Job', () => {
    const validJobData: ShapesExportJobData = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      sourceSlug: 'test-shape',
      exportJobId: '660e8400-e29b-41d4-a716-446655440000',
      format: 'json',
    };

    it('should validate a valid json export job', () => {
      const result = shapesExportJobDataSchema.safeParse(validJobData);
      expect(result.success).toBe(true);
    });

    it('should validate a markdown export job', () => {
      const mdJob: ShapesExportJobData = { ...validJobData, format: 'markdown' };
      const result = shapesExportJobDataSchema.safeParse(mdJob);
      expect(result.success).toBe(true);
    });

    it('should reject job with invalid format', () => {
      const invalidJob = { ...validJobData, format: 'csv' };
      const result = shapesExportJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });

    it('should reject job with non-UUID userId', () => {
      const invalidJob = { ...validJobData, userId: 'not-a-uuid' };
      const result = shapesExportJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });

    it('should reject job missing required fields', () => {
      const invalidJob = { userId: validJobData.userId };
      const result = shapesExportJobDataSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });
  });

  describe('Schema Validation - Shapes Export Result', () => {
    it('should validate a successful export result', () => {
      const validResult: ShapesExportJobResult = {
        success: true,
        fileSizeBytes: 1048576,
        memoriesCount: 150,
        storiesCount: 5,
      };

      const result = shapesExportResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it('should validate a failed export result', () => {
      const failedResult: ShapesExportJobResult = {
        success: false,
        fileSizeBytes: 0,
        memoriesCount: 0,
        storiesCount: 0,
        error: 'No shapes.inc credentials found.',
      };

      const result = shapesExportResultSchema.safeParse(failedResult);
      expect(result.success).toBe(true);
    });

    it('should reject result with negative memoriesCount', () => {
      const invalidResult = {
        success: true,
        fileSizeBytes: 0,
        memoriesCount: -1,
        storiesCount: 0,
      };

      const result = shapesExportResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });
  });

  describe('Job Schema Coverage Enforcement', () => {
    /**
     * ENFORCEMENT: Every JobType enum value MUST have a corresponding Zod schema.
     * This test prevents adding new job types without defining their contract schemas.
     *
     * If this test fails, you need to:
     * 1. Create a Zod schema for your new job type (in jobs.ts or its own file)
     * 2. Add it to JOB_DATA_SCHEMAS below
     * 3. Add contract tests above
     */
    const JOB_DATA_SCHEMAS: Record<string, unknown> = {
      [JobType.AudioTranscription]: audioTranscriptionJobDataSchema,
      [JobType.ImageDescription]: imageDescriptionJobDataSchema,
      [JobType.LLMGeneration]: llmGenerationJobDataSchema,
      [JobType.ShapesImport]: shapesImportJobDataSchema,
      [JobType.ShapesExport]: shapesExportJobDataSchema,
    };

    it('should have a Zod data schema for every JobType enum value', () => {
      const allJobTypes = Object.values(JobType);
      const coveredJobTypes = Object.keys(JOB_DATA_SCHEMAS);

      const missing = allJobTypes.filter(jt => !coveredJobTypes.includes(jt));
      expect(missing).toEqual([]);
    });

    it('should not have schemas for non-existent JobType values', () => {
      const allJobTypes = new Set(Object.values(JobType) as string[]);
      const coveredJobTypes = Object.keys(JOB_DATA_SCHEMAS);

      const extra = coveredJobTypes.filter(jt => !allJobTypes.has(jt));
      expect(extra).toEqual([]);
    });
  });
});
