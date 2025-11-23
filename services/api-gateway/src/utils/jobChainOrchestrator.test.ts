/**
 * Tests for Job Chain Orchestrator (BullMQ FlowProducer)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJobChain } from './jobChainOrchestrator.js';
import { flowProducer } from '../queue.js';
import {
  JobType,
  type LoadedPersonality,
  type JobContext,
  type ResponseDestination,
  CONTENT_TYPES,
} from '@tzurot/common-types';

// Mock the queue (flowProducer for job dependencies)
vi.mock('../queue.js', () => ({
  flowProducer: {
    add: vi.fn(),
  },
}));

// Mock getConfig
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getConfig: () => ({ QUEUE_NAME: 'test-queue' }),
  };
});

describe('jobChainOrchestrator (FlowProducer)', () => {
  const mockPersonality: LoadedPersonality = {
    id: 'test-id',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    systemPrompt: 'Test prompt',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 4096,
    characterInfo: 'Test character',
    personalityTraits: 'Test traits',
  };

  const mockResponseDestination: ResponseDestination = {
    type: 'discord',
    channelId: 'channel-123',
    webhookUrl: 'https://discord.com/api/webhooks/test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: flowProducer.add returns parent job + children
    (flowProducer.add as any).mockResolvedValue({
      job: { id: 'llm-job-123' },
      children: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('empty attachments edge case', () => {
    it('should create flow with LLM job only (no children) when attachments array is empty', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        attachments: [], // Empty array
      };

      const jobId = await createJobChain({
        requestId: 'req-123',
        personality: mockPersonality,
        message: 'Hello',
        context,
        responseDestination: mockResponseDestination,
      });

      // Should create flow with NO children (LLM only)
      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      expect(flowProducer.add).toHaveBeenCalledWith(
        expect.objectContaining({
          name: JobType.LLMGeneration,
          data: expect.objectContaining({
            requestId: 'req-123',
            jobType: JobType.LLMGeneration,
            personality: mockPersonality,
            message: 'Hello',
            dependencies: undefined, // No dependencies
          }),
          queueName: 'test-queue',
          children: undefined, // No child jobs
        })
      );

      expect(jobId).toBe('llm-job-123');
    });

    it('should create flow with LLM job only when attachments is undefined', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        // attachments not provided
      };

      const jobId = await createJobChain({
        requestId: 'req-456',
        personality: mockPersonality,
        message: 'Hello',
        context,
        responseDestination: mockResponseDestination,
      });

      // Should create flow with NO children
      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const call = (flowProducer.add as any).mock.calls[0][0];
      expect(call.children).toBeUndefined();

      expect(jobId).toBe('llm-job-123');
    });
  });

  describe('with attachments', () => {
    it('should create flow with preprocessing children and LLM parent', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        attachments: [
          {
            url: 'https://example.com/audio.ogg',
            name: 'audio.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 1024,
          },
          {
            url: 'https://example.com/image.png',
            name: 'image.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 2048,
          },
        ],
      };

      const jobId = await createJobChain({
        requestId: 'req-789',
        personality: mockPersonality,
        message: 'What is this?',
        context,
        responseDestination: mockResponseDestination,
      });

      // Should create ONE flow with 2 children (audio + image)
      expect(flowProducer.add).toHaveBeenCalledTimes(1);

      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Check parent job (LLM)
      expect(flowCall.name).toBe(JobType.LLMGeneration);
      expect(flowCall.data.jobType).toBe(JobType.LLMGeneration);
      expect(flowCall.data.dependencies).toHaveLength(2);

      // Check children (preprocessing jobs)
      expect(flowCall.children).toHaveLength(2);
      expect(flowCall.children[0].name).toBe(JobType.AudioTranscription);
      expect(flowCall.children[1].name).toBe(JobType.ImageDescription);

      expect(jobId).toBe('llm-job-123');
    });

    it('should handle multiple audio attachments', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        attachments: [
          {
            url: 'https://example.com/audio1.ogg',
            name: 'audio1.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 1024,
          },
          {
            url: 'https://example.com/audio2.ogg',
            name: 'audio2.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 1024,
          },
        ],
      };

      await createJobChain({
        requestId: 'req-multi',
        personality: mockPersonality,
        message: 'Transcribe these',
        context,
        responseDestination: mockResponseDestination,
      });

      // Should create flow with 2 audio children
      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      expect(flowCall.children).toHaveLength(2);
      expect(flowCall.children.every((c: any) => c.name === JobType.AudioTranscription)).toBe(true);
    });

    it('should handle only image attachments (no audio)', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        attachments: [
          {
            url: 'https://example.com/image.png',
            name: 'image.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 2048,
          },
        ],
      };

      await createJobChain({
        requestId: 'req-img-only',
        personality: mockPersonality,
        message: "What's this?",
        context,
        responseDestination: mockResponseDestination,
      });

      // Should create flow with 1 image child
      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      expect(flowCall.children).toHaveLength(1);
      expect(flowCall.children[0].name).toBe(JobType.ImageDescription);
    });
  });

  describe('FlowProducer guarantees', () => {
    it('should create flow that ensures children complete before parent', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        attachments: [
          {
            url: 'https://example.com/image.png',
            name: 'image.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 2048,
          },
        ],
      };

      await createJobChain({
        requestId: 'req-flow',
        personality: mockPersonality,
        message: "What's this?",
        context,
        responseDestination: mockResponseDestination,
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // FlowProducer structure guarantees children run first
      expect(flowCall).toHaveProperty('children');
      expect(flowCall).toHaveProperty('data');
      expect(flowCall).toHaveProperty('name', JobType.LLMGeneration);

      // Parent has dependency metadata for accessing child results
      expect(flowCall.data.dependencies).toBeDefined();
      expect(flowCall.data.dependencies[0]).toHaveProperty('jobId');
      expect(flowCall.data.dependencies[0]).toHaveProperty('resultKey');
    });
  });

  describe('Runtime Validation', () => {
    describe('LLM Generation Job Validation', () => {
      it('should reject job with missing displayName in personality', async () => {
        const inmockPersonality = {
          ...mockPersonality,
          displayName: undefined, // Missing required field
        };

        await expect(
          createJobChain({
            requestId: 'test-123',
            personality: inmockPersonality as any,
            message: 'Test message',
            context: {
              userId: 'user-123',
              userName: 'User',
              channelId: 'channel-123',
            },
            responseDestination: {
              type: 'discord',
              channelId: 'channel-123',
            },
          })
        ).rejects.toThrow(/validation failed/i);
      });

      it('should reject job with missing contextWindowTokens', async () => {
        const inmockPersonality = {
          ...mockPersonality,
          contextWindowTokens: undefined, // Missing required field
        };

        await expect(
          createJobChain({
            requestId: 'test-123',
            personality: inmockPersonality as any,
            message: 'Test message',
            context: {
              userId: 'user-123',
              channelId: 'channel-123',
            },
            responseDestination: {
              type: 'discord',
              channelId: 'channel-123',
            },
          })
        ).rejects.toThrow(/validation failed/i);
      });

      it('should reject job with missing characterInfo', async () => {
        const inmockPersonality = {
          ...mockPersonality,
          characterInfo: undefined, // Missing required field
        };

        await expect(
          createJobChain({
            requestId: 'test-123',
            personality: inmockPersonality as any,
            message: 'Test message',
            context: {
              userId: 'user-123',
              channelId: 'channel-123',
            },
            responseDestination: {
              type: 'discord',
              channelId: 'channel-123',
            },
          })
        ).rejects.toThrow(/validation failed/i);
      });

      it('should reject job with missing personalityTraits', async () => {
        const inmockPersonality = {
          ...mockPersonality,
          personalityTraits: undefined, // Missing required field
        };

        await expect(
          createJobChain({
            requestId: 'test-123',
            personality: inmockPersonality as any,
            message: 'Test message',
            context: {
              userId: 'user-123',
              channelId: 'channel-123',
            },
            responseDestination: {
              type: 'discord',
              channelId: 'channel-123',
            },
          })
        ).rejects.toThrow(/validation failed/i);
      });

      it('should accept valid LLM generation job', async () => {
        const jobId = await createJobChain({
          requestId: 'test-123',
          personality: mockPersonality,
          message: 'Test message',
          context: {
            userId: 'user-123',
            userName: 'User',
            channelId: 'channel-123',
          },
          responseDestination: {
            type: 'discord',
            channelId: 'channel-123',
          },
        });

        // Should return job ID without throwing
        expect(jobId).toBe('llm-job-123');
      });
    });

    describe('Image Description Job Validation', () => {
      it('should NOT create image job with empty attachments array', async () => {
        await createJobChain({
          requestId: 'test-123',
          personality: mockPersonality,
          message: 'Test',
          context: {
            userId: 'user-123',
            channelId: 'channel-123',
            attachments: [], // Empty - no image job should be created
          },
          responseDestination: {
            type: 'discord',
            channelId: 'channel-123',
          },
        });

        // Verify flowProducer was called without image children
        const flowCall = (flowProducer.add as any).mock.calls[0][0];
        expect(flowCall.children).toBeUndefined();
      });

      it('should create image job with valid attachments', async () => {
        await createJobChain({
          requestId: 'test-123',
          personality: mockPersonality,
          message: 'Test',
          context: {
            userId: 'user-123',
            channelId: 'channel-123',
            attachments: [
              {
                url: 'https://example.com/image.png',
                contentType: 'image/png',
                name: 'image.png',
                size: 1024,
              },
            ],
          },
          responseDestination: {
            type: 'discord',
            channelId: 'channel-123',
          },
        });

        // Verify image job was created as child
        const flowCall = (flowProducer.add as any).mock.calls[0][0];
        expect(flowCall.children).toBeDefined();
        expect(flowCall.children.length).toBeGreaterThan(0);
        const imageJob = flowCall.children.find(
          (child: any) => child.name === JobType.ImageDescription
        );
        expect(imageJob).toBeDefined();
        expect(imageJob.data.attachments).toHaveLength(1);
      });
    });

    describe('Audio Transcription Job Validation', () => {
      it('should NOT create audio job with empty attachments array', async () => {
        await createJobChain({
          requestId: 'test-123',
          personality: mockPersonality,
          message: 'Test',
          context: {
            userId: 'user-123',
            channelId: 'channel-123',
            attachments: [], // Empty - no audio job should be created
          },
          responseDestination: {
            type: 'discord',
            channelId: 'channel-123',
          },
        });

        // Verify flowProducer was called without audio children
        const flowCall = (flowProducer.add as any).mock.calls[0][0];
        expect(flowCall.children).toBeUndefined();
      });

      it('should create audio job with valid voice attachment', async () => {
        await createJobChain({
          requestId: 'test-123',
          personality: mockPersonality,
          message: 'Test',
          context: {
            userId: 'user-123',
            channelId: 'channel-123',
            attachments: [
              {
                url: 'https://example.com/audio.ogg',
                contentType: 'audio/ogg',
                name: 'audio.ogg',
                size: 2048,
                isVoiceMessage: true,
              },
            ],
          },
          responseDestination: {
            type: 'discord',
            channelId: 'channel-123',
          },
        });

        // Verify audio job was created as child
        const flowCall = (flowProducer.add as any).mock.calls[0][0];
        expect(flowCall.children).toBeDefined();
        expect(flowCall.children.length).toBeGreaterThan(0);
        const audioJob = flowCall.children.find(
          (child: any) => child.name === JobType.AudioTranscription
        );
        expect(audioJob).toBeDefined();
        expect(audioJob.data.attachment.isVoiceMessage).toBe(true);
      });
    });
  });
});
