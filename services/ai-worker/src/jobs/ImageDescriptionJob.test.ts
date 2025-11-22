/**
 * Tests for Image Description Job Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processImageDescriptionJob } from './ImageDescriptionJob.js';
import type { Job } from 'bullmq';
import type { ImageDescriptionJobData, LoadedPersonality } from '@tzurot/common-types';
import { JobType, CONTENT_TYPES } from '@tzurot/common-types';

// Mock describeImage and withRetry
vi.mock('../services/MultimodalProcessor.js', () => ({
  describeImage: vi.fn(),
}));

vi.mock('../utils/retryService.js', () => ({
  withRetry: vi.fn(),
}));

// Import the mocked modules
import { describeImage } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retryService.js';

// Get mocked functions
const mockDescribeImage = vi.mocked(describeImage);
const mockWithRetry = vi.mocked(withRetry);

describe('ImageDescriptionJob', () => {
  const mockPersonality: LoadedPersonality = {
    id: 'test-personality',
    name: 'Test',
    displayName: 'Test Personality',
    slug: 'test',
    systemPrompt: 'Test prompt',
    model: 'gpt-4-vision-preview',
    visionModel: 'gpt-4-vision-preview',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 100000,
    characterInfo: 'Test character',
    personalityTraits: 'Helpful',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: describeImage returns mock description
    mockDescribeImage.mockResolvedValue('Mocked image description');

    // Default: withRetry calls the function and returns successful result
    mockWithRetry.mockImplementation(async fn => {
      const value = await fn();
      return {
        value,
        attempts: 1,
        totalTimeMs: 2000,
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processImageDescriptionJob', () => {
    it('should successfully describe single image', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-image',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const result = await processImageDescriptionJob(job);

      expect(result).toEqual({
        requestId: 'test-req-image',
        success: true,
        descriptions: [
          {
            url: 'https://example.com/image1.png',
            description: 'Mocked image description',
          },
        ],
        metadata: {
          processingTimeMs: expect.any(Number),
          imageCount: 1,
          failedCount: 0,
        },
      });

      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxAttempts: 3,
          operationName: 'Image description (image1.png)',
        })
      );
    });

    it('should process multiple images in parallel', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-multi',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
          {
            url: 'https://example.com/image2.jpg',
            name: 'image2.jpg',
            contentType: CONTENT_TYPES.IMAGE_JPG,
            size: 2048,
          },
          {
            url: 'https://example.com/image3.webp',
            name: 'image3.webp',
            contentType: CONTENT_TYPES.IMAGE_WEBP,
            size: 1536,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-image-multi',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Return different descriptions for each image
      let callCount = 0;
      mockWithRetry.mockImplementation(async fn => {
        const result = await fn();
        callCount++;
        return {
          value: `Description ${callCount}`,
          attempts: 1,
          totalTimeMs: 2000,
        };
      });

      mockDescribeImage.mockImplementation(async attachment => {
        if (attachment.name === 'image1.png') return 'Description 1';
        if (attachment.name === 'image2.jpg') return 'Description 2';
        if (attachment.name === 'image3.webp') return 'Description 3';
        return 'Unknown';
      });

      const result = await processImageDescriptionJob(job);

      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(3);
      expect(result.descriptions[0].url).toBe('https://example.com/image1.png');
      expect(result.descriptions[1].url).toBe('https://example.com/image2.jpg');
      expect(result.descriptions[2].url).toBe('https://example.com/image3.webp');
      expect(result.metadata.imageCount).toBe(3);

      // Should call withRetry once per image (parallel processing)
      expect(mockWithRetry).toHaveBeenCalledTimes(3);
    });

    it('should use withRetry wrapper for each image', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-retry',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-image-retry',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Simulate retry succeeding on 2nd attempt
      mockWithRetry.mockImplementation(async fn => {
        const result = await fn();
        return {
          value: result,
          attempts: 2,
          totalTimeMs: 4500,
        };
      });

      const result = await processImageDescriptionJob(job);

      expect(result.success).toBe(true);
      expect(result.descriptions[0].description).toBe('Mocked image description');
      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxAttempts: 3,
        })
      );
    });

    it('should return failure result when all retries exhausted', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-fail',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/failed.png',
            name: 'failed.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-image-fail',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // Simulate withRetry failing after all attempts
      mockWithRetry.mockRejectedValue(new Error('Vision model timeout after 3 attempts'));

      const result = await processImageDescriptionJob(job);

      // With graceful degradation, when ALL images fail, we return error with details
      expect(result.requestId).toBe('test-req-image-fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('All images failed processing');
      expect(result.error).toContain('Details:'); // Enhanced error includes failure details
    });

    it('should reject invalid attachment type (audio instead of image)', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-invalid',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/audio.ogg',
            name: 'audio.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 2048,
          } as any, // Type mismatch intentional for test
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-image-invalid',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const result = await processImageDescriptionJob(job);

      expect(result).toMatchObject({
        requestId: 'test-req-image-invalid',
        success: false,
        error: expect.stringContaining('Invalid attachment type'),
        metadata: expect.any(Object),
      });

      // Should NOT call withRetry for invalid input
      expect(mockWithRetry).not.toHaveBeenCalled();
    });

    it('should reject if any attachment is invalid (mixed types)', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-mixed',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
          {
            url: 'https://example.com/audio.ogg',
            name: 'audio.ogg',
            contentType: CONTENT_TYPES.AUDIO_OGG,
            size: 2048,
          } as any, // Invalid
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-image-mixed',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      const result = await processImageDescriptionJob(job);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid attachment type');
      expect(mockWithRetry).not.toHaveBeenCalled();
    });

    it('should handle partial failures in parallel processing', async () => {
      const jobData: ImageDescriptionJobData = {
        requestId: 'test-req-image-partial',
        jobType: JobType.ImageDescription,
        attachments: [
          {
            url: 'https://example.com/image1.png',
            name: 'image1.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
          {
            url: 'https://example.com/image2.png',
            name: 'image2.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            size: 1024,
          },
        ],
        personality: mockPersonality,
        context: {
          userId: 'user-123',
          channelId: 'channel-456',
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-456',
        },
      };

      const job = {
        id: 'image-test-req-image-partial',
        data: jobData,
      } as Job<ImageDescriptionJobData>;

      // First image succeeds, second fails
      let callCount = 0;
      mockWithRetry.mockImplementation(async fn => {
        callCount++;
        if (callCount === 1) {
          const result = await fn();
          return {
            value: result,
            attempts: 1,
            totalTimeMs: 2000,
          };
        } else {
          throw new Error('Vision model error');
        }
      });

      mockDescribeImage.mockResolvedValue('Success description');

      const result = await processImageDescriptionJob(job);

      // With graceful degradation, job succeeds with partial results
      expect(result.success).toBe(true);
      expect(result.descriptions).toHaveLength(1); // Only successful image
      expect(result.descriptions[0].url).toBe('https://example.com/image1.png');
      expect(result.metadata.imageCount).toBe(1);
      expect(result.metadata.failedCount).toBe(1); // Track failures
    });
  });
});
