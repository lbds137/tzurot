/**
 * Tests for Validated Queue Wrapper
 *
 * Tests the defensive wrapper around BullMQ queue.add() that validates
 * job payloads before enqueueing them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addValidatedJob, addValidatedJobs } from './validatedQueue.js';
import { JobType, CONTENT_TYPES } from '@tzurot/common-types';
import type { Queue, Job } from 'bullmq';

// Create a mock queue
function createMockQueue(): Queue {
  return {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' } as Job),
  } as unknown as Queue;
}

// Valid job payloads for each type
const validLLMJobData = {
  requestId: 'req-123',
  jobType: JobType.LLMGeneration,
  personality: {
    id: 'personality-123',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    systemPrompt: 'You are a test bot',
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 4096,
    characterInfo: 'A friendly test bot',
    personalityTraits: 'Helpful, kind',
  },
  message: 'Hello, world!',
  context: {
    userId: 'user-123',
    channelId: 'channel-123',
  },
  responseDestination: {
    type: 'discord' as const,
    channelId: 'channel-123',
  },
};

const validAudioJobData = {
  requestId: 'req-456',
  jobType: JobType.AudioTranscription,
  attachment: {
    url: 'https://example.com/audio.ogg',
    name: 'voice-message.ogg',
    contentType: CONTENT_TYPES.AUDIO_OGG,
    size: 1024,
    isVoiceMessage: true,
  },
  context: {
    userId: 'user-123',
    channelId: 'channel-123',
  },
  responseDestination: {
    type: 'discord' as const,
    channelId: 'channel-123',
  },
};

// Shared personality for jobs that require it
const testPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  systemPrompt: 'You are a test bot',
  model: 'gpt-4',
  temperature: 0.7,
  maxTokens: 1000,
  contextWindowTokens: 4096,
  characterInfo: 'A friendly test bot',
  personalityTraits: 'Helpful, kind',
};

const validImageJobData = {
  requestId: 'req-789',
  jobType: JobType.ImageDescription,
  attachments: [
    {
      url: 'https://example.com/image.png',
      name: 'photo.png',
      contentType: CONTENT_TYPES.IMAGE_PNG,
      size: 2048,
    },
  ],
  personality: testPersonality,
  context: {
    userId: 'user-123',
    channelId: 'channel-123',
  },
  responseDestination: {
    type: 'discord' as const,
    channelId: 'channel-123',
  },
};

describe('validatedQueue', () => {
  let mockQueue: Queue;

  beforeEach(() => {
    mockQueue = createMockQueue();
    vi.clearAllMocks();
  });

  describe('addValidatedJob', () => {
    describe('LLM Generation Jobs', () => {
      it('should add valid LLM job to queue', async () => {
        const job = await addValidatedJob(mockQueue, JobType.LLMGeneration, validLLMJobData, {
          jobId: 'llm-job-123',
        });

        expect(mockQueue.add).toHaveBeenCalledTimes(1);
        expect(mockQueue.add).toHaveBeenCalledWith(JobType.LLMGeneration, validLLMJobData, {
          jobId: 'llm-job-123',
        });
        expect(job).toEqual({ id: 'mock-job-id' });
      });

      it('should reject LLM job with missing personality', async () => {
        const invalidData = {
          ...validLLMJobData,
          personality: undefined,
        };

        await expect(
          addValidatedJob(mockQueue, JobType.LLMGeneration, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });

      it('should reject LLM job with missing responseDestination', async () => {
        const invalidData = {
          ...validLLMJobData,
          responseDestination: undefined,
        };

        await expect(
          addValidatedJob(mockQueue, JobType.LLMGeneration, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });

      it('should reject LLM job with missing contextWindowTokens in personality', async () => {
        const invalidData = {
          ...validLLMJobData,
          personality: {
            ...validLLMJobData.personality,
            contextWindowTokens: undefined,
          },
        };

        await expect(
          addValidatedJob(mockQueue, JobType.LLMGeneration, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });

      it('should reject LLM job with missing characterInfo in personality', async () => {
        const invalidData = {
          ...validLLMJobData,
          personality: {
            ...validLLMJobData.personality,
            characterInfo: undefined,
          },
        };

        await expect(
          addValidatedJob(mockQueue, JobType.LLMGeneration, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });
    });

    describe('Audio Transcription Jobs', () => {
      it('should add valid audio job to queue', async () => {
        const job = await addValidatedJob(
          mockQueue,
          JobType.AudioTranscription,
          validAudioJobData,
          { jobId: 'audio-job-456' }
        );

        expect(mockQueue.add).toHaveBeenCalledTimes(1);
        expect(mockQueue.add).toHaveBeenCalledWith(JobType.AudioTranscription, validAudioJobData, {
          jobId: 'audio-job-456',
        });
        expect(job).toEqual({ id: 'mock-job-id' });
      });

      it('should reject audio job with missing attachment', async () => {
        const invalidData = {
          ...validAudioJobData,
          attachment: undefined,
        };

        await expect(
          addValidatedJob(mockQueue, JobType.AudioTranscription, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });

      it('should reject audio job with missing attachment URL', async () => {
        const invalidData = {
          ...validAudioJobData,
          attachment: {
            ...validAudioJobData.attachment,
            url: undefined,
          },
        };

        await expect(
          addValidatedJob(mockQueue, JobType.AudioTranscription, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });
    });

    describe('Image Description Jobs', () => {
      it('should add valid image job to queue', async () => {
        const job = await addValidatedJob(mockQueue, JobType.ImageDescription, validImageJobData, {
          jobId: 'image-job-789',
        });

        expect(mockQueue.add).toHaveBeenCalledTimes(1);
        expect(mockQueue.add).toHaveBeenCalledWith(JobType.ImageDescription, validImageJobData, {
          jobId: 'image-job-789',
        });
        expect(job).toEqual({ id: 'mock-job-id' });
      });

      it('should reject image job with missing attachments', async () => {
        const invalidData = {
          ...validImageJobData,
          attachments: undefined,
        };

        await expect(
          addValidatedJob(mockQueue, JobType.ImageDescription, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });

      it('should reject image job with empty attachments array', async () => {
        const invalidData = {
          ...validImageJobData,
          attachments: [],
        };

        await expect(
          addValidatedJob(mockQueue, JobType.ImageDescription, invalidData)
        ).rejects.toThrow(/Invalid.*job data/i);

        expect(mockQueue.add).not.toHaveBeenCalled();
      });
    });

    describe('Job options', () => {
      it('should pass job options to queue.add', async () => {
        const opts = {
          jobId: 'custom-job-id',
          priority: 1,
          delay: 1000,
        };

        await addValidatedJob(mockQueue, JobType.LLMGeneration, validLLMJobData, opts);

        expect(mockQueue.add).toHaveBeenCalledWith(JobType.LLMGeneration, validLLMJobData, opts);
      });

      it('should work without job options', async () => {
        await addValidatedJob(mockQueue, JobType.LLMGeneration, validLLMJobData);

        expect(mockQueue.add).toHaveBeenCalledWith(
          JobType.LLMGeneration,
          validLLMJobData,
          undefined
        );
      });
    });
  });

  describe('addValidatedJobs', () => {
    it('should add multiple valid jobs to queue', async () => {
      const jobs = [
        {
          jobType: JobType.AudioTranscription,
          jobData: validAudioJobData,
          opts: { jobId: 'audio-1' },
        },
        {
          jobType: JobType.ImageDescription,
          jobData: validImageJobData,
          opts: { jobId: 'image-1' },
        },
      ];

      const result = await addValidatedJobs(mockQueue, jobs);

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('should reject batch if any job is invalid (atomic operation)', async () => {
      const jobs = [
        { jobType: JobType.AudioTranscription, jobData: validAudioJobData },
        {
          jobType: JobType.ImageDescription,
          jobData: { ...validImageJobData, attachments: undefined },
        }, // Invalid
      ];

      await expect(addValidatedJobs(mockQueue, jobs)).rejects.toThrow(/Invalid.*job data/i);

      // Atomic: no jobs should be added if any validation fails
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should handle empty jobs array', async () => {
      const result = await addValidatedJobs(mockQueue, []);

      expect(result).toHaveLength(0);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should validate all jobs before adding any', async () => {
      // First job is invalid, second is valid
      const jobs = [
        {
          jobType: JobType.AudioTranscription,
          jobData: { ...validAudioJobData, attachment: undefined },
        },
        { jobType: JobType.LLMGeneration, jobData: validLLMJobData },
      ];

      await expect(addValidatedJobs(mockQueue, jobs)).rejects.toThrow(/Invalid.*job data/i);

      // Neither job should be added
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should preserve job order in results', async () => {
      let callOrder = 0;
      (mockQueue.add as any).mockImplementation(() => {
        return Promise.resolve({ id: `job-${++callOrder}` });
      });

      const jobs = [
        { jobType: JobType.AudioTranscription, jobData: validAudioJobData },
        { jobType: JobType.ImageDescription, jobData: validImageJobData },
        { jobType: JobType.LLMGeneration, jobData: validLLMJobData },
      ];

      const result = await addValidatedJobs(mockQueue, jobs);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 'job-1' });
      expect(result[1]).toEqual({ id: 'job-2' });
      expect(result[2]).toEqual({ id: 'job-3' });
    });
  });

  describe('Error messages', () => {
    it('should include job type in error message', async () => {
      const invalidData = { ...validLLMJobData, personality: undefined };

      try {
        await addValidatedJob(mockQueue, JobType.LLMGeneration, invalidData);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain(JobType.LLMGeneration);
      }
    });

    it('should include validation errors in message', async () => {
      const invalidData = { ...validAudioJobData, attachment: undefined };

      try {
        await addValidatedJob(mockQueue, JobType.AudioTranscription, invalidData);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Errors');
      }
    });
  });
});
