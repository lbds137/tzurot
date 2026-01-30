/**
 * Contract Test: BullMQ Job Consumer (ai-worker)
 *
 * Validates that ai-worker can consume job payloads that conform to the shared
 * Zod schemas. This ensures the consumer (ai-worker) accepts what the producer
 * (api-gateway) sends.
 *
 * These tests validate schema compliance and type safety, not job execution.
 */

import { describe, it, expect } from 'vitest';
import {
  llmGenerationJobDataSchema,
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  JobType,
  JobStatus,
  type LLMGenerationJobData,
  type AudioTranscriptionJobData,
  type ImageDescriptionJobData,
} from '@tzurot/common-types';

describe('Contract: BullMQ Job Consumer (ai-worker)', () => {
  describe('LLM Generation Job', () => {
    it('should accept any payload that matches the shared contract', () => {
      // Create a mock payload compliant with the shared schema
      const validPayload: LLMGenerationJobData = {
        requestId: 'consumer-test-123',
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'test-personality-id',
          name: 'TestPersonality',
          displayName: 'Test Personality',
          slug: 'test-personality',
          systemPrompt: 'You are a test AI.',
          model: 'anthropic/claude-3-5-sonnet',
          temperature: 0.7,
          maxTokens: 4000,
          contextWindowTokens: 200000,
          characterInfo: 'Test character',
          personalityTraits: 'Helpful, friendly',
        },
        message: 'Test message from consumer',
        context: {
          userId: 'test-user-123',
          userName: 'TestUser',
          channelId: 'test-channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'test-channel-456',
        },
      };

      // Verify the payload matches the schema
      const result = llmGenerationJobDataSchema.safeParse(validPayload);
      expect(result.success).toBe(true);

      // Ensure TypeScript types are correct (compile-time check)
      const typedPayload: LLMGenerationJobData = validPayload;
      expect(typedPayload.requestId).toBe('consumer-test-123');
    });

    it('should reject payloads missing required fields', () => {
      const invalidPayload = {
        requestId: 'consumer-test-124',
        jobType: JobType.LLMGeneration,
        // Missing: personality, message, context, responseDestination
      };

      const result = llmGenerationJobDataSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Ensure errors are specific
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it('should handle optional fields correctly', () => {
      const payloadWithOptionals: LLMGenerationJobData = {
        requestId: 'consumer-test-125',
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'test-id',
          name: 'Test',
          displayName: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
          contextWindowTokens: 100000,
          characterInfo: 'Test',
          personalityTraits: 'Test',
        },
        message: 'Test',
        context: {
          userId: 'user-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-123',
        },
        // Optional fields
        userApiKey: 'test-api-key',
        dependencies: [
          {
            jobId: 'dep-job-123',
            type: JobType.AudioTranscription,
            status: JobStatus.Completed,
            resultKey: 'result:key',
          },
        ],
      };

      const result = llmGenerationJobDataSchema.safeParse(payloadWithOptionals);
      expect(result.success).toBe(true);
    });

    it('should add version field by default', () => {
      const payload = {
        requestId: 'test-126',
        jobType: JobType.LLMGeneration,
        personality: {
          id: 'test-id',
          name: 'Test',
          displayName: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
          contextWindowTokens: 100000,
          characterInfo: 'Test',
          personalityTraits: 'Test',
        },
        message: 'Test',
        context: {
          userId: 'user-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-123',
        },
      };

      const result = llmGenerationJobDataSchema.parse(payload);
      // Version should be added by schema default
      expect(result.version).toBe(1);
    });
  });

  describe('Audio Transcription Job', () => {
    it('should accept any payload that matches the shared contract', () => {
      const validPayload: AudioTranscriptionJobData = {
        requestId: 'audio-consumer-test-123',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.mp3',
          contentType: 'audio/mpeg',
          name: 'test.mp3',
          isVoiceMessage: true,
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const result = audioTranscriptionJobDataSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid attachment data', () => {
      const invalidPayload = {
        requestId: 'audio-consumer-test-124',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 123, // Invalid: should be string
          contentType: 'audio/mpeg',
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const result = audioTranscriptionJobDataSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe('Image Description Job', () => {
    it('should accept any payload that matches the shared contract', () => {
      const validPayload: ImageDescriptionJobData = {
        requestId: 'image-consumer-test-123',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.jpg',
            contentType: 'image/jpeg',
          },
          {
            url: 'https://example.com/image2.png',
            contentType: 'image/png',
          },
        ],
        personality: {
          id: 'test-id',
          name: 'Test',
          displayName: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'test-model',
          visionModel: 'test-vision-model',
          temperature: 0.7,
          maxTokens: 1000,
          contextWindowTokens: 100000,
          characterInfo: 'Test',
          personalityTraits: 'Test',
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const result = imageDescriptionJobDataSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('should require at least one attachment', () => {
      const invalidPayload = {
        requestId: 'image-consumer-test-124',
        jobType: JobType.ImageDescription,
        attachments: [], // Empty array - invalid
        personality: {
          id: 'test-id',
          name: 'Test',
          displayName: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
          contextWindowTokens: 100000,
          characterInfo: 'Test',
          personalityTraits: 'Test',
        },
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const result = imageDescriptionJobDataSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(result.error.issues[0].message).toContain(
          'At least one image attachment is required'
        );
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should parse payloads with version 1', () => {
      const payloadV1: LLMGenerationJobData = {
        requestId: 'version-test-123',
        jobType: JobType.LLMGeneration,
        version: 1, // Explicit version
        personality: {
          id: 'test-id',
          name: 'Test',
          displayName: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
          contextWindowTokens: 100000,
          characterInfo: 'Test',
          personalityTraits: 'Test',
        },
        message: 'Test',
        context: {
          userId: 'user-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-123',
        },
      };

      const result = llmGenerationJobDataSchema.safeParse(payloadV1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
      }
    });

    it('should default to version 1 when version field is missing', () => {
      const payloadWithoutVersion = {
        requestId: 'version-test-124',
        jobType: JobType.LLMGeneration,
        // version field intentionally omitted
        personality: {
          id: 'test-id',
          name: 'Test',
          displayName: 'Test',
          slug: 'test',
          systemPrompt: 'Test',
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
          contextWindowTokens: 100000,
          characterInfo: 'Test',
          personalityTraits: 'Test',
        },
        message: 'Test',
        context: {
          userId: 'user-123',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-123',
        },
      };

      const result = llmGenerationJobDataSchema.parse(payloadWithoutVersion);
      expect(result.version).toBe(1);
    });

    // Future: When we add version 2, test backward compatibility here
    // it('should handle version 2 payloads with new fields', () => { ... });
    // it('should reject version 3 payloads (unsupported)', () => { ... });
  });
});
