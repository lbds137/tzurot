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
import type { LlmConfigResolver, VisionConfigResolver } from '@tzurot/config-resolver';

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
    ownerId: 'owner-uuid-test',
    systemPrompt: 'Test prompt',
    model: 'test-model',
    provider: 'openrouter',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 4096,
    characterInfo: 'Test character',
    personalityTraits: 'Test traits',
    voiceEnabled: false,
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

  describe('referenced message attachment preprocessing', () => {
    // Helper to create valid referenced message
    const createReferencedMessage = (
      referenceNumber: number,
      overrides: Partial<{
        content: string;
        attachments: any[];
      }> = {}
    ) => ({
      referenceNumber,
      discordMessageId: `discord-msg-${referenceNumber}`,
      discordUserId: `discord-user-${referenceNumber}`,
      authorDisplayName: `Test User ${referenceNumber}`,
      authorUsername: `testuser${referenceNumber}`,
      timestamp: '2025-11-30T00:00:00Z',
      locationContext: 'Test Guild > #general',
      content: overrides.content ?? 'Test content',
      embeds: '', // Required field
      attachments: overrides.attachments,
    });

    it('should create image preprocessing job for referenced message images', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        referencedMessages: [
          createReferencedMessage(1, {
            content: 'Check out this image!',
            attachments: [
              {
                url: 'https://example.com/ref-image.png',
                name: 'ref-image.png',
                contentType: CONTENT_TYPES.IMAGE_PNG,
                size: 2048,
              },
            ],
          }),
        ],
      };

      await createJobChain({
        requestId: 'req-ref-img',
        personality: mockPersonality,
        message: 'What is in this image?',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Should have 1 image child job for referenced message
      expect(flowCall.children).toHaveLength(1);
      expect(flowCall.children[0].name).toBe(JobType.ImageDescription);
      expect(flowCall.children[0].data.sourceReferenceNumber).toBe(1);
      expect(flowCall.children[0].data.attachments).toHaveLength(1);

      // LLM parent should have dependency with sourceReferenceNumber tracking
      expect(flowCall.data.dependencies).toHaveLength(1);
    });

    it('should create the referenced-image job from the raw envelope when referencedMessages is dropped (thin payload)', async () => {
      // Thin (kind:'envelope') payload: the bot omits context.referencedMessages
      // and ships the same snapshot on rawAssemblyInputs.rawReferencedMessages.
      // The gateway must still spawn the referenced image's vision job — without
      // this, a reply/link to an image goes undescribed under thin (regression
      // that shipped because this case wasn't covered).
      const context: JobContext = {
        kind: 'envelope',
        userId: 'user-123',
        channelId: 'channel-123',
        rawAssemblyInputs: {
          rawMessageContent: 'What is in this image?',
          rawReferencedMessages: [
            createReferencedMessage(1, {
              content: 'Check out this image!',
              attachments: [
                {
                  url: 'https://example.com/ref-image.png',
                  name: 'ref-image.png',
                  contentType: CONTENT_TYPES.IMAGE_PNG,
                  size: 2048,
                },
              ],
            }),
          ],
        },
      } as JobContext;

      await createJobChain({
        requestId: 'req-ref-img-thin',
        personality: mockPersonality,
        message: 'What is in this image?',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.children).toHaveLength(1);
      expect(flowCall.children[0].name).toBe(JobType.ImageDescription);
      expect(flowCall.children[0].data.sourceReferenceNumber).toBe(1);
      expect(flowCall.children[0].data.attachments).toHaveLength(1);
      expect(flowCall.data.dependencies).toHaveLength(1);
    });

    it('should create the referenced-audio job from the raw envelope under thin payload', async () => {
      // Same fallback as the image case — the ?? in createJobChain is
      // attachment-type-agnostic, so referenced voice messages must also
      // transcribe under thin (kind:'envelope', referencedMessages dropped).
      const context: JobContext = {
        kind: 'envelope',
        userId: 'user-123',
        channelId: 'channel-123',
        rawAssemblyInputs: {
          rawMessageContent: 'What did they say?',
          rawReferencedMessages: [
            createReferencedMessage(1, {
              content: 'Listen to this!',
              attachments: [
                {
                  url: 'https://example.com/ref-voice.ogg',
                  name: 'ref-voice.ogg',
                  contentType: CONTENT_TYPES.AUDIO_OGG,
                  size: 1024,
                  isVoiceMessage: true,
                  duration: 5,
                },
              ],
            }),
          ],
        },
      } as JobContext;

      await createJobChain({
        requestId: 'req-ref-audio-thin',
        personality: mockPersonality,
        message: 'What did they say?',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.children).toHaveLength(1);
      expect(flowCall.children[0].name).toBe(JobType.AudioTranscription);
      expect(flowCall.children[0].data.sourceReferenceNumber).toBe(1);
      expect(flowCall.children[0].data.attachment.isVoiceMessage).toBe(true);
      expect(flowCall.data.dependencies).toHaveLength(1);
    });

    it('should create audio preprocessing job for referenced message voice messages', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        referencedMessages: [
          createReferencedMessage(1, {
            content: 'Listen to this!',
            attachments: [
              {
                url: 'https://example.com/ref-voice.ogg',
                name: 'ref-voice.ogg',
                contentType: CONTENT_TYPES.AUDIO_OGG,
                size: 1024,
                isVoiceMessage: true,
                duration: 5,
              },
            ],
          }),
        ],
      };

      await createJobChain({
        requestId: 'req-ref-audio',
        personality: mockPersonality,
        message: 'What did they say?',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Should have 1 audio child job for referenced message
      expect(flowCall.children).toHaveLength(1);
      expect(flowCall.children[0].name).toBe(JobType.AudioTranscription);
      expect(flowCall.children[0].data.sourceReferenceNumber).toBe(1);
      expect(flowCall.children[0].data.attachment.isVoiceMessage).toBe(true);
    });

    it('should create multiple preprocessing jobs for referenced message with mixed attachments', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        referencedMessages: [
          createReferencedMessage(1, {
            content: 'Check this out!',
            attachments: [
              {
                url: 'https://example.com/ref-image.png',
                name: 'ref-image.png',
                contentType: CONTENT_TYPES.IMAGE_PNG,
                size: 2048,
              },
              {
                url: 'https://example.com/ref-voice.ogg',
                name: 'ref-voice.ogg',
                contentType: CONTENT_TYPES.AUDIO_OGG,
                size: 1024,
                isVoiceMessage: true,
                duration: 3,
              },
            ],
          }),
        ],
      };

      await createJobChain({
        requestId: 'req-ref-mixed',
        personality: mockPersonality,
        message: 'What is this about?',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Should have 2 children: 1 audio + 1 image (both from same referenced message)
      expect(flowCall.children).toHaveLength(2);

      const audioJob = flowCall.children.find((c: any) => c.name === JobType.AudioTranscription);
      const imageJob = flowCall.children.find((c: any) => c.name === JobType.ImageDescription);

      expect(audioJob).toBeDefined();
      expect(audioJob.data.sourceReferenceNumber).toBe(1);
      expect(imageJob).toBeDefined();
      expect(imageJob.data.sourceReferenceNumber).toBe(1);
    });

    it('should handle multiple referenced messages with attachments', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        referencedMessages: [
          createReferencedMessage(1, {
            content: 'First image',
            attachments: [
              {
                url: 'https://example.com/ref1-image.png',
                name: 'ref1-image.png',
                contentType: CONTENT_TYPES.IMAGE_PNG,
                size: 2048,
              },
            ],
          }),
          createReferencedMessage(2, {
            content: 'Second image',
            attachments: [
              {
                url: 'https://example.com/ref2-image.png',
                name: 'ref2-image.png',
                contentType: CONTENT_TYPES.IMAGE_PNG,
                size: 1024,
              },
            ],
          }),
        ],
      };

      await createJobChain({
        requestId: 'req-multi-ref',
        personality: mockPersonality,
        message: 'Compare these images',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Should have 2 image child jobs (one per referenced message)
      expect(flowCall.children).toHaveLength(2);
      expect(flowCall.children.every((c: any) => c.name === JobType.ImageDescription)).toBe(true);

      // Verify different sourceReferenceNumbers
      const ref1Job = flowCall.children.find((c: any) => c.data.sourceReferenceNumber === 1);
      const ref2Job = flowCall.children.find((c: any) => c.data.sourceReferenceNumber === 2);
      expect(ref1Job).toBeDefined();
      expect(ref2Job).toBeDefined();
    });

    it('should not create child jobs for referenced messages without attachments', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        referencedMessages: [
          createReferencedMessage(1, {
            content: 'Just text, no attachments',
            attachments: [], // Empty
          }),
          createReferencedMessage(2, {
            content: 'Also just text',
            // attachments undefined
          }),
        ],
      };

      await createJobChain({
        requestId: 'req-no-ref-attach',
        personality: mockPersonality,
        message: 'What about these?',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Should have no children
      expect(flowCall.children).toBeUndefined();
      expect(flowCall.data.dependencies).toBeUndefined();
    });

    it('should combine direct attachments with referenced message attachments', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        // Direct attachments from user's message
        attachments: [
          {
            url: 'https://example.com/direct-image.png',
            name: 'direct-image.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 2048,
          },
        ],
        // Referenced message with its own attachment
        referencedMessages: [
          createReferencedMessage(1, {
            content: 'Referenced image',
            attachments: [
              {
                url: 'https://example.com/ref-image.png',
                name: 'ref-image.png',
                contentType: CONTENT_TYPES.IMAGE_PNG,
                size: 1024,
              },
            ],
          }),
        ],
      };

      await createJobChain({
        requestId: 'req-combined',
        personality: mockPersonality,
        message: 'Compare my image with the referenced one',
        context,
        responseDestination: mockResponseDestination,
      });

      expect(flowProducer.add).toHaveBeenCalledTimes(1);
      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Should have 2 image child jobs: 1 direct + 1 referenced
      expect(flowCall.children).toHaveLength(2);

      // Direct attachment job should NOT have sourceReferenceNumber
      const directJob = flowCall.children.find(
        (c: any) => c.data.sourceReferenceNumber === undefined
      );
      expect(directJob).toBeDefined();
      expect(directJob.name).toBe(JobType.ImageDescription);

      // Referenced attachment job should have sourceReferenceNumber = 1
      const refJob = flowCall.children.find((c: any) => c.data.sourceReferenceNumber === 1);
      expect(refJob).toBeDefined();
      expect(refJob.name).toBe(JobType.ImageDescription);

      // LLM parent should have 2 dependencies
      expect(flowCall.data.dependencies).toHaveLength(2);
    });
  });

  describe('config resolution stamping', () => {
    const imageAttachmentContext = (): JobContext => ({
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
    });

    // The text cascade (LlmConfigResolver, kind='text') stamps personality.model.
    const llmResolverReturning = (model: string, source: string): LlmConfigResolver =>
      ({
        resolveConfig: vi.fn().mockResolvedValue({ config: { model }, source }),
      }) as unknown as LlmConfigResolver;

    // The vision cascade (VisionConfigResolver, kind='vision') stamps
    // personality.visionModel INDEPENDENTLY — its config.model IS the vision model.
    // `fallbacks` seeds the two DB-default readers the stamp also consults for the
    // Phase-4 visionFallbackModels chain (default: neither set → readers return null).
    const visionResolverReturning = (
      model: string,
      fallbacks: { global?: string; free?: string } = {}
    ): VisionConfigResolver =>
      ({
        resolveConfig: vi.fn().mockResolvedValue({ config: { model }, source: 'personality' }),
        getGlobalDefaultConfig: vi
          .fn()
          .mockResolvedValue(
            fallbacks.global !== undefined
              ? { model: fallbacks.global, source: 'personality' }
              : null
          ),
        getFreeDefaultVisionConfig: vi
          .fn()
          .mockResolvedValue(
            fallbacks.free !== undefined ? { model: fallbacks.free, source: 'personality' } : null
          ),
      }) as unknown as VisionConfigResolver;

    it('stamps the resolved text model + vision model onto BOTH the LLM job and the image-description child', async () => {
      await createJobChain({
        requestId: 'req-stamp',
        personality: mockPersonality, // seed model 'test-model'
        message: 'What is this?',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        llmConfigResolver: llmResolverReturning('z-ai/glm-5.2', 'user-default'),
        visionConfigResolver: visionResolverReturning('google/gemma-4-31b-it'),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];

      // Conversation (parent) job carries the user-cascaded model + diagnostic source
      expect(flowCall.data.personality.model).toBe('z-ai/glm-5.2');
      expect(flowCall.data.personality.visionModel).toBe('google/gemma-4-31b-it');
      expect(flowCall.data.configSource).toBe('user-default');

      // Non-model personality fields survive the stamp (spread preserves them).
      expect(flowCall.data.personality.systemPrompt).toBe(mockPersonality.systemPrompt);
      expect(flowCall.data.personality.temperature).toBe(mockPersonality.temperature);

      // Image-description child carries the SAME values (shared stamped personality)
      const imageJob = flowCall.children.find((c: any) => c.name === JobType.ImageDescription);
      expect(imageJob.data.personality.model).toBe('z-ai/glm-5.2');
      expect(imageJob.data.personality.visionModel).toBe('google/gemma-4-31b-it');
    });

    it('stamps the vision model from its OWN cascade, independent of the text source', async () => {
      // Text source is 'personality' (no text override) but vision still resolves +
      // stamps from the independent vision cascade — vision is its own config axis.
      await createJobChain({
        requestId: 'req-vision-indep',
        personality: mockPersonality,
        message: 'What is this?',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        llmConfigResolver: llmResolverReturning('test-model', 'personality'),
        visionConfigResolver: visionResolverReturning('vision-global-default'),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      // Text untouched (source personality), vision stamped from its own resolver.
      expect(flowCall.data.personality.model).toBe('test-model');
      expect(flowCall.data.configSource).toBe('personality');
      expect(flowCall.data.personality.visionModel).toBe('vision-global-default');
    });

    it('does NOT stamp the hardcoded-fallback vision model (bootstrap window)', async () => {
      // source='hardcoded' = the resolver hit MODEL_DEFAULTS.VISION_FALLBACK because no
      // vision globals are seeded yet. Stamping it would force selectVisionModel priority-1
      // to the slow fallback; leaving visionModel unstamped lets priority-2 (main-model
      // vision) win downstream — the whole point of the guard.
      const visionConfigResolver = {
        resolveConfig: vi.fn().mockResolvedValue({
          config: { model: 'qwen/qwen3.5-397b-a17b', source: 'hardcoded' },
          source: 'hardcoded',
        }),
        getGlobalDefaultConfig: vi.fn().mockResolvedValue(null),
        getFreeDefaultVisionConfig: vi.fn().mockResolvedValue(null),
      } as unknown as VisionConfigResolver;

      await createJobChain({
        requestId: 'req-vision-hardcoded',
        personality: mockPersonality, // no seed visionModel
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        visionConfigResolver,
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      // The 397B hardcoded fallback is NOT stamped → visionModel stays unset.
      expect(flowCall.data.personality.visionModel).toBeUndefined();
    });

    it('stamps the visionFallbackModels chain from the global + free vision defaults', async () => {
      await createJobChain({
        requestId: 'req-vision-fallbacks',
        personality: mockPersonality,
        message: 'What is this?',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        visionConfigResolver: visionResolverReturning('primary-vision', {
          global: 'global-vision-default',
          free: 'free-vision-default',
        }),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.visionModel).toBe('primary-vision');
      // The DB-resolved fallback tiers ride along for the worker's runtime retry loop,
      // in global→free order — the worker composes its local native-main + hardcoded tiers.
      expect(flowCall.data.personality.visionFallbackModels).toEqual([
        'global-vision-default',
        'free-vision-default',
      ]);
    });

    it('dedupes the fallback chain when the global + free defaults are the same model', async () => {
      await createJobChain({
        requestId: 'req-vision-fallbacks-dedup',
        personality: mockPersonality,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        visionConfigResolver: visionResolverReturning('primary-vision', {
          global: 'same-model',
          free: 'same-model',
        }),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.visionFallbackModels).toEqual(['same-model']);
    });

    it('omits visionFallbackModels entirely when no DB vision defaults are set', async () => {
      await createJobChain({
        requestId: 'req-vision-no-defaults',
        personality: mockPersonality,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        visionConfigResolver: visionResolverReturning('primary-vision'), // no global/free
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      // Absent, not an empty array — the worker still has its local T2/T5 tiers.
      expect(flowCall.data.personality.visionFallbackModels).toBeUndefined();
    });

    it('does NOT overwrite provider (AuthStep auto-promote relies on the configured provider)', async () => {
      await createJobChain({
        requestId: 'req-provider',
        personality: mockPersonality, // provider: 'openrouter'
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        llmConfigResolver: llmResolverReturning('z-ai/glm-5.2', 'user-default'),
        visionConfigResolver: visionResolverReturning('google/gemma-4-31b-it'),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.provider).toBe('openrouter');
    });

    it('keeps the seed visionModel when no vision resolver is wired', async () => {
      const personalityWithVision: LoadedPersonality = {
        ...mockPersonality,
        visionModel: 'seed-vision',
      };

      await createJobChain({
        requestId: 'req-keep-vision',
        personality: personalityWithVision,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        llmConfigResolver: llmResolverReturning('z-ai/glm-5.2', 'user-default'),
        // visionConfigResolver omitted → visionModel stays at the seed
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.model).toBe('z-ai/glm-5.2');
      expect(flowCall.data.personality.visionModel).toBe('seed-vision');
    });

    it('leaves the seed personality and reports configSource=personality when text source is personality', async () => {
      await createJobChain({
        requestId: 'req-seed',
        personality: mockPersonality,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        llmConfigResolver: llmResolverReturning('test-model', 'personality'),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.model).toBe('test-model');
      expect(flowCall.data.configSource).toBe('personality');
    });

    it('falls back to the seed personality when no resolver is wired (back-compat)', async () => {
      await createJobChain({
        requestId: 'req-no-resolver',
        personality: mockPersonality,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        // both resolvers omitted
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.model).toBe('test-model');
      expect(flowCall.data.configSource).toBe('personality');
    });

    it('falls back to the seed text model when the LLM resolver throws (never blocks job creation)', async () => {
      const llmConfigResolver = {
        resolveConfig: vi.fn().mockRejectedValue(new Error('db down')),
      } as unknown as LlmConfigResolver;

      const jobId = await createJobChain({
        requestId: 'req-throw',
        personality: mockPersonality,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        llmConfigResolver,
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.model).toBe('test-model');
      expect(flowCall.data.configSource).toBe('personality');
      expect(jobId).toBe('llm-job-123');
    });

    it('leaves the vision model on the seed when the vision resolver throws (fail-open)', async () => {
      const personalityWithVision: LoadedPersonality = {
        ...mockPersonality,
        visionModel: 'seed-vision',
      };
      // resolveConfig is the sole thrower — the readers succeed so the test exercises
      // the resolveConfig-throws path specifically (not an incidental missing-method throw).
      const visionConfigResolver = {
        resolveConfig: vi.fn().mockRejectedValue(new Error('db down')),
        getGlobalDefaultConfig: vi.fn().mockResolvedValue(null),
        getFreeDefaultVisionConfig: vi.fn().mockResolvedValue(null),
      } as unknown as VisionConfigResolver;

      const jobId = await createJobChain({
        requestId: 'req-vision-throw',
        personality: personalityWithVision,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        visionConfigResolver,
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.personality.visionModel).toBe('seed-vision');
      expect(jobId).toBe('llm-job-123');
    });

    it('stamps the resolved text + vision models onto referenced-message image jobs', async () => {
      const context: JobContext = {
        userId: 'user-123',
        channelId: 'channel-123',
        referencedMessages: [
          {
            referenceNumber: 1,
            discordMessageId: 'discord-msg-1',
            discordUserId: 'discord-user-1',
            authorDisplayName: 'Ref User',
            authorUsername: 'refuser',
            timestamp: '2025-11-30T00:00:00Z',
            locationContext: 'Test Guild > #general',
            content: 'Look at this',
            embeds: '',
            attachments: [
              {
                url: 'https://example.com/ref-image.png',
                name: 'ref-image.png',
                contentType: CONTENT_TYPES.IMAGE_PNG,
                size: 2048,
              },
            ],
          },
        ],
      };

      await createJobChain({
        requestId: 'req-ref-stamp',
        personality: mockPersonality,
        message: 'What is in this image?',
        context,
        responseDestination: mockResponseDestination,
        llmConfigResolver: llmResolverReturning('z-ai/glm-5.2', 'user-default'),
        visionConfigResolver: visionResolverReturning('google/gemma-4-31b-it'),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      const imageJob = flowCall.children.find((c: any) => c.name === JobType.ImageDescription);
      expect(imageJob.data.personality.model).toBe('z-ai/glm-5.2');
      expect(imageJob.data.personality.visionModel).toBe('google/gemma-4-31b-it');
    });

    it('leaves the seed untouched on an unexpected TTS-tier source (free-default)', async () => {
      // LlmConfigResolver should never return TTS-only tiers; stampResolvedConfig
      // defends against it by leaving the seed personality AND reporting source
      // 'personality' — no "diagnostic lie" where a stamped model contradicts the
      // reported source. The warn log (not asserted here) keeps the violation visible.
      await createJobChain({
        requestId: 'req-free-default',
        personality: mockPersonality,
        message: 'hi',
        context: imageAttachmentContext(),
        responseDestination: mockResponseDestination,
        llmConfigResolver: llmResolverReturning('z-ai/glm-5.2', 'free-default'),
      });

      const flowCall = (flowProducer.add as any).mock.calls[0][0];
      expect(flowCall.data.configSource).toBe('personality');
      // Seed preserved — the unexpected-tier model is NOT stamped.
      expect(flowCall.data.personality.model).toBe('test-model');
    });
  });
});
