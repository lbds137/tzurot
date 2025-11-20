/**
 * Transcribe Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createTranscribeRoute } from './transcribe.js';
import type { Queue, QueueEvents, Job } from 'bullmq';
import { JobStatus } from '@tzurot/common-types';
import type { AttachmentStorageService } from '../../services/AttachmentStorageService.js';

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

// Create mock AttachmentStorageService
const createMockAttachmentStorage = () => ({
  downloadAndStore: vi.fn().mockImplementation(async (_requestId, attachments) => attachments),
  cleanup: vi.fn().mockResolvedValue(undefined),
});

describe('POST /transcribe', () => {
  let app: Express;
  let aiQueue: ReturnType<typeof createMockQueue>;
  let queueEvents: ReturnType<typeof createMockQueueEvents>;
  let attachmentStorage: ReturnType<typeof createMockAttachmentStorage>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mocks
    aiQueue = createMockQueue();
    queueEvents = createMockQueueEvents();
    attachmentStorage = createMockAttachmentStorage();

    // Create Express app with transcribe router
    app = express();
    app.use(express.json());
    app.use(
      '/transcribe',
      createTranscribeRoute(
        aiQueue as unknown as Queue,
        queueEvents as unknown as QueueEvents,
        attachmentStorage as unknown as AttachmentStorageService
      )
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
});
