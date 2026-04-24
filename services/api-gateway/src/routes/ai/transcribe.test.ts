/**
 * Transcribe Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createTranscribeRoute } from './transcribe.js';
import type { Queue, QueueEvents, Job } from 'bullmq';
import { JobStatus } from '@tzurot/common-types';

// Create mock BullMQ queue
const createMockQueue = () => ({
  add: vi.fn(),
  getJob: vi.fn(),
  getWaitingCount: vi.fn().mockResolvedValue(0),
  getActiveCount: vi.fn().mockResolvedValue(0),
  getCompletedCount: vi.fn().mockResolvedValue(0),
  getFailedCount: vi.fn().mockResolvedValue(0),
});

// Create mock QueueEvents
const createMockQueueEvents = () => ({
  on: vi.fn(),
  off: vi.fn(),
});

describe('POST /transcribe', () => {
  let app: Express;
  let aiQueue: ReturnType<typeof createMockQueue>;
  let queueEvents: ReturnType<typeof createMockQueueEvents>;

  beforeEach(() => {
    vi.clearAllMocks();

    aiQueue = createMockQueue();
    queueEvents = createMockQueueEvents();

    app = express();
    app.use(express.json());
    app.use(
      '/transcribe',
      createTranscribeRoute(aiQueue as unknown as Queue, queueEvents as unknown as QueueEvents)
    );
  });

  it('should create transcription job and return job ID', async () => {
    const mockJob = {
      id: 'audio-req-123',
    } as Job;
    aiQueue.add.mockResolvedValue(mockJob);

    const response = await request(app)
      .post('/transcribe')
      .send({
        attachments: [
          {
            url: 'https://example.com/audio.ogg',
            contentType: 'audio/ogg',
            name: 'audio.ogg',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jobId: 'audio-req-123',
      status: JobStatus.Queued,
    });
    expect(aiQueue.add).toHaveBeenCalled();
  });

  it('should reject request without attachments', async () => {
    const response = await request(app).post('/transcribe').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should pass userId to job data when provided', async () => {
    const mockJob = {
      id: 'audio-req-456',
    } as Job;
    aiQueue.add.mockResolvedValue(mockJob);

    await request(app)
      .post('/transcribe')
      .send({
        attachments: [
          {
            url: 'https://example.com/audio.ogg',
            contentType: 'audio/ogg',
          },
        ],
        userId: '123456789',
      });

    expect(aiQueue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        context: expect.objectContaining({
          userId: '123456789',
        }),
      }),
      expect.any(Object)
    );
  });

  it('should default userId to system when not provided', async () => {
    const mockJob = {
      id: 'audio-req-789',
    } as Job;
    aiQueue.add.mockResolvedValue(mockJob);

    await request(app)
      .post('/transcribe')
      .send({
        attachments: [
          {
            url: 'https://example.com/audio.ogg',
            contentType: 'audio/ogg',
          },
        ],
      });

    expect(aiQueue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        context: expect.objectContaining({
          userId: 'system',
        }),
      }),
      expect.any(Object)
    );
  });
});
