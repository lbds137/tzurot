/**
 * Tests for Job Chain Orchestrator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJobChain } from './jobChainOrchestrator.js';
import { aiQueue } from '../queue.js';
import {
  JobType,
  type LoadedPersonality,
  type JobContext,
  type ResponseDestination,
  CONTENT_TYPES,
} from '@tzurot/common-types';

// Mock the queue
vi.mock('../queue.js', () => ({
  aiQueue: {
    add: vi.fn(),
  },
}));

describe('jobChainOrchestrator', () => {
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
    // Default mock: return job with ID
    (aiQueue.add as any).mockResolvedValue({ id: 'job-123' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('empty attachments edge case', () => {
    it('should create only LLM job when attachments array is empty', async () => {
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

      // Should create exactly 1 job (LLM only, no preprocessing)
      expect(aiQueue.add).toHaveBeenCalledTimes(1);

      // Verify it's the LLM generation job
      expect(aiQueue.add).toHaveBeenCalledWith(
        JobType.LLMGeneration,
        expect.objectContaining({
          requestId: 'req-123',
          jobType: JobType.LLMGeneration,
          personality: mockPersonality,
          message: 'Hello',
          dependencies: undefined, // No dependencies
        }),
        expect.any(Object)
      );

      expect(jobId).toBe('job-123');
    });

    it('should create only LLM job when attachments is undefined', async () => {
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

      // Should create exactly 1 job
      expect(aiQueue.add).toHaveBeenCalledTimes(1);
      expect(aiQueue.add).toHaveBeenCalledWith(
        JobType.LLMGeneration,
        expect.objectContaining({
          dependencies: undefined,
        }),
        expect.any(Object)
      );

      expect(jobId).toBe('job-123');
    });
  });

  describe('with attachments', () => {
    it('should create preprocessing jobs and LLM job with dependencies', async () => {
      let jobIdCounter = 1;
      (aiQueue.add as any).mockImplementation(() => {
        return Promise.resolve({ id: `job-${jobIdCounter++}` });
      });

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

      // Should create 3 jobs: audio + image + LLM
      expect(aiQueue.add).toHaveBeenCalledTimes(3);

      // Check audio job
      expect(aiQueue.add).toHaveBeenCalledWith(
        JobType.AudioTranscription,
        expect.objectContaining({
          jobType: JobType.AudioTranscription,
          attachment: context.attachments![0],
        }),
        expect.any(Object)
      );

      // Check image job
      expect(aiQueue.add).toHaveBeenCalledWith(
        JobType.ImageDescription,
        expect.objectContaining({
          jobType: JobType.ImageDescription,
          attachments: [context.attachments![1]],
        }),
        expect.any(Object)
      );

      // Check LLM job has dependencies
      expect(aiQueue.add).toHaveBeenCalledWith(
        JobType.LLMGeneration,
        expect.objectContaining({
          jobType: JobType.LLMGeneration,
          dependencies: expect.arrayContaining([
            expect.objectContaining({ type: JobType.AudioTranscription }),
            expect.objectContaining({ type: JobType.ImageDescription }),
          ]),
        }),
        expect.any(Object)
      );

      expect(jobId).toBe('job-3'); // Third job created
    });

    it('should handle multiple audio attachments', async () => {
      let jobIdCounter = 1;
      (aiQueue.add as any).mockImplementation(() => {
        return Promise.resolve({ id: `job-${jobIdCounter++}` });
      });

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

      // Should create 3 jobs: audio1 + audio2 + LLM
      expect(aiQueue.add).toHaveBeenCalledTimes(3);

      // Verify both audio jobs were created
      const calls = (aiQueue.add as any).mock.calls;
      const audioJobs = calls.filter(
        (call: any) => call[0] === JobType.AudioTranscription
      );
      expect(audioJobs).toHaveLength(2);
    });

    it('should handle only image attachments (no audio)', async () => {
      let jobIdCounter = 1;
      (aiQueue.add as any).mockImplementation(() => {
        return Promise.resolve({ id: `job-${jobIdCounter++}` });
      });

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

      // Should create 2 jobs: image + LLM
      expect(aiQueue.add).toHaveBeenCalledTimes(2);

      const calls = (aiQueue.add as any).mock.calls;
      expect(calls[0][0]).toBe(JobType.ImageDescription);
      expect(calls[1][0]).toBe(JobType.LLMGeneration);
    });
  });
});
