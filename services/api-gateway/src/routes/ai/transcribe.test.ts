/**
 * Transcribe Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { handleAiTranscribe } from './transcribe.js';
import type { Queue, QueueEvents, Job } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { JobStatus } from '@tzurot/common-types/constants/queue';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

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

const createMockPrisma = () =>
  ({
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  }) as unknown as PrismaClient;

describe('POST /transcribe', () => {
  let app: Express;
  let aiQueue: ReturnType<typeof createMockQueue>;
  let queueEvents: ReturnType<typeof createMockQueueEvents>;
  let prisma: PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();

    aiQueue = createMockQueue();
    queueEvents = createMockQueueEvents();
    prisma = createMockPrisma();

    app = express();
    app.use(express.json());
    app.post(
      '/transcribe',
      handleAiTranscribe({
        ...stubRouteResolvers(),
        prisma,
        aiQueue: aiQueue as unknown as Queue,
        queueEvents: queueEvents as unknown as QueueEvents,
      })
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

  describe('?wait=true → showModelFooter resolution', () => {
    const audioAttachments = [
      { url: 'https://example.com/audio.ogg', contentType: 'audio/ogg', name: 'audio.ogg' },
    ];

    const buildJob = () => {
      const job = {
        id: 'audio-req-w',
        waitUntilFinished: vi.fn().mockResolvedValue({
          requestId: 'req-w',
          success: true,
          content: 'Hello there',
          provider: 'mistral',
          attachmentUrl: audioAttachments[0].url,
          attachmentName: audioAttachments[0].name,
        }),
      } as unknown as Job;
      aiQueue.add.mockResolvedValue(job);
      return job;
    };

    it('returns showModelFooter=true when the user opted in (or default)', async () => {
      buildJob();
      (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        configDefaults: { showModelFooter: true },
      });

      const response = await request(app)
        .post('/transcribe?wait=true')
        .send({ attachments: audioAttachments, userId: '111222333' });

      expect(response.status).toBe(200);
      expect(response.body.result.showModelFooter).toBe(true);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { discordId: '111222333' },
        select: { configDefaults: true },
      });
    });

    it('returns showModelFooter=false when the user explicitly opted out', async () => {
      buildJob();
      (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        configDefaults: { showModelFooter: false },
      });

      const response = await request(app)
        .post('/transcribe?wait=true')
        .send({ attachments: audioAttachments, userId: '111222333' });

      expect(response.body.result.showModelFooter).toBe(false);
    });

    it('returns showModelFooter=true when no user row matches the Discord ID (hardcoded fallback)', async () => {
      buildJob();
      // findFirst returning null → no user row found; falls back to default (true)
      (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/transcribe?wait=true')
        .send({ attachments: audioAttachments, userId: '111222333' });

      expect(response.body.result.showModelFooter).toBe(true);
    });

    it('returns showModelFooter=true for system userId without touching Prisma', async () => {
      buildJob();

      const response = await request(app)
        .post('/transcribe?wait=true')
        .send({ attachments: audioAttachments }); // no userId → defaults to 'system'

      expect(response.body.result.showModelFooter).toBe(true);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('fails open with showModelFooter=true on DB error (preserves footer rendering)', async () => {
      buildJob();
      (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection refused')
      );

      const response = await request(app)
        .post('/transcribe?wait=true')
        .send({ attachments: audioAttachments, userId: '111222333' });

      expect(response.body.result.showModelFooter).toBe(true);
    });

    it('does NOT resolve showModelFooter on the async-polling path (?wait=false)', async () => {
      // The non-wait branch returns the job ID for later polling and skips
      // the user-preference resolution. A polling caller receives no
      // showModelFooter field on the result; bot-client (the sole caller
      // today) always uses ?wait=true, but pinning this contract prevents
      // a future refactor from silently making the toggle inconsistent
      // across the two response shapes.
      buildJob();

      const response = await request(app)
        .post('/transcribe') // ?wait=false (the default)
        .send({ attachments: audioAttachments, userId: '111222333' });

      // Non-wait response is the queued-job envelope, not a full transcript.
      expect(response.body.status).toBe('queued');
      expect(response.body.result).toBeUndefined();
      // Critically: Prisma is never consulted on this path. Pinning the
      // specific `findFirst` call shape because that's what
      // resolveShowModelFooter uses today — if the implementation switches
      // to a different lookup (e.g., findUnique), this assertion needs to
      // follow.
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
  });
});
