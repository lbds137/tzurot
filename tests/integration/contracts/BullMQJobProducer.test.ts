/**
 * Contract Test: BullMQ Job Producer (api-gateway)
 *
 * Validates that api-gateway creates job payloads that conform to the shared
 * Zod schemas. This ensures the producer (api-gateway) and consumer (ai-worker)
 * agree on the job structure.
 *
 * These tests do NOT spin up BullMQ or Redis - they validate the data structure only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  llmGenerationJobDataSchema,
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  JobType,
  type LoadedPersonality,
  type JobContext,
  type ResponseDestination,
} from '@tzurot/common-types';

describe('Contract: BullMQ Job Producer (api-gateway)', () => {
  let mockPersonality: LoadedPersonality;
  let mockContext: JobContext;
  let mockResponseDestination: ResponseDestination;

  beforeAll(() => {
    // Create mock personality data that matches what api-gateway would use
    // This doesn't need to come from database - we're testing payload structure
    mockPersonality = {
      id: 'test-personality-id',
      name: 'TestPersonality',
      displayName: 'Test Personality',
      slug: 'test-personality',
      systemPrompt: 'You are a test AI assistant.',
      model: 'anthropic/claude-3-5-sonnet',
      visionModel: 'anthropic/claude-3-5-sonnet',
      temperature: 0.7,
      maxTokens: 4000,
      contextWindowTokens: 200000,
      characterInfo: 'A helpful test assistant',
      personalityTraits: 'Friendly, helpful, concise',
      personalityTone: 'Professional',
      personalityAge: 'Ageless',
      personalityAppearance: 'Digital entity',
      personalityLikes: 'Helping users',
      personalityDislikes: 'Confusion',
      conversationalGoals: 'Be helpful and clear',
      conversationalExamples: 'User: Hello\nAssistant: Hi there!',
    };

    mockContext = {
      userId: 'test-user-123',
      userName: 'TestUser',
      channelId: 'test-channel-456',
      serverId: 'test-server-789',
      sessionId: 'test-session-abc',
    };

    mockResponseDestination = {
      type: 'discord',
      channelId: 'test-channel-456',
    };
  });

  describe('LLM Generation Job', () => {
    it('should produce a payload that matches the shared contract', () => {
      // Simulate how api-gateway creates an LLM job (from jobChainOrchestrator.ts:202-211)
      const jobData = {
        requestId: 'test-request-123',
        jobType: JobType.LLMGeneration,
        personality: mockPersonality,
        message: 'Hello, AI!',
        context: mockContext,
        responseDestination: mockResponseDestination,
        userApiKey: undefined,
        dependencies: undefined,
      };

      // Validate against shared schema
      const result = llmGenerationJobDataSchema.safeParse(jobData);

      // Assert compliance
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('Schema validation errors:', result.error.format());
      }

      // Snapshot test to catch accidental field removals
      expect(jobData).toMatchSnapshot('llm-generation-job-payload');
    });

    it('should include version field (backward compatibility)', () => {
      const jobData = {
        requestId: 'test-request-124',
        jobType: JobType.LLMGeneration,
        personality: mockPersonality,
        message: 'Test message',
        context: mockContext,
        responseDestination: mockResponseDestination,
      };

      const result = llmGenerationJobDataSchema.parse(jobData);

      // Version field should be added by default
      expect(result.version).toBe(1);
    });

    it('should validate with complex message object', () => {
      const jobData = {
        requestId: 'test-request-125',
        jobType: JobType.LLMGeneration,
        personality: mockPersonality,
        message: { text: 'Hello', attachments: [] }, // Object message
        context: mockContext,
        responseDestination: mockResponseDestination,
      };

      const result = llmGenerationJobDataSchema.safeParse(jobData);
      expect(result.success).toBe(true);
    });
  });

  describe('Audio Transcription Job', () => {
    it('should produce a payload that matches the shared contract', () => {
      // Simulate how api-gateway creates an audio job (from jobChainOrchestrator.ts:103-112)
      const jobData = {
        requestId: 'test-audio-123',
        jobType: JobType.AudioTranscription,
        attachment: {
          url: 'https://example.com/audio.mp3',
          contentType: 'audio/mpeg',
          name: 'recording.mp3',
          size: 1024000,
          isVoiceMessage: true,
          duration: 30,
        },
        context: {
          userId: mockContext.userId,
          channelId: mockContext.channelId,
        },
        responseDestination: mockResponseDestination,
      };

      const result = audioTranscriptionJobDataSchema.safeParse(jobData);

      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('Schema validation errors:', result.error.format());
      }

      expect(jobData).toMatchSnapshot('audio-transcription-job-payload');
    });
  });

  describe('Image Description Job', () => {
    it('should produce a payload that matches the shared contract', () => {
      // Simulate how api-gateway creates an image job (from jobChainOrchestrator.ts:148-158)
      const jobData = {
        requestId: 'test-image-123',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.jpg',
            contentType: 'image/jpeg',
            name: 'photo.jpg',
            size: 2048000,
          },
          {
            url: 'https://example.com/image2.png',
            contentType: 'image/png',
            name: 'screenshot.png',
            size: 1536000,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: mockContext.userId,
          channelId: mockContext.channelId,
        },
        responseDestination: mockResponseDestination,
      };

      const result = imageDescriptionJobDataSchema.safeParse(jobData);

      expect(result.success).toBe(true);
      if (!result.success) {
        console.error('Schema validation errors:', result.error.format());
      }

      expect(jobData).toMatchSnapshot('image-description-job-payload');
    });
  });
});
