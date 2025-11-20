/**
 * Generate Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createGenerateRoute } from './generate.js';
import { JobStatus } from '@tzurot/common-types';
import type { AttachmentStorageService } from '../../services/AttachmentStorageService.js';

// Mock dependencies
vi.mock('../../utils/requestDeduplication.js', () => ({
  checkDuplicate: vi.fn().mockReturnValue(null),
  cacheRequest: vi.fn(),
}));
vi.mock('../../utils/jobChainOrchestrator.js', () => ({
  createJobChain: vi.fn().mockResolvedValue('llm-req-123'),
}));

// Create mock AttachmentStorageService
const createMockAttachmentStorage = () => ({
  downloadAndStore: vi.fn().mockImplementation(async (_requestId, attachments) => attachments),
  cleanup: vi.fn().mockResolvedValue(undefined),
});

describe('POST /generate', () => {
  let app: Express;
  let attachmentStorage: ReturnType<typeof createMockAttachmentStorage>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mocks
    attachmentStorage = createMockAttachmentStorage();

    // Create Express app with generate router
    app = express();
    app.use(express.json());
    app.use(
      '/generate',
      createGenerateRoute(attachmentStorage as unknown as AttachmentStorageService)
    );
  });

  it('should create a job and return 202 Accepted', async () => {
    const response = await request(app)
      .post('/generate')
      .send({
        personality: {
          id: 'personality-123',
          name: 'TestBot',
          displayName: 'Test Bot',
          slug: 'test-bot',
          systemPrompt: 'You are a helpful assistant',
          model: 'anthropic/claude-sonnet-4.5',
          temperature: 0.7,
          maxTokens: 4096,
          contextWindowTokens: 200000,
          characterInfo: 'A helpful assistant',
          personalityTraits: 'Friendly and knowledgeable',
        },
        message: 'Hello!',
        context: {
          userId: 'user-123',
          channelId: 'channel-123',
        },
      });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      jobId: 'llm-req-123',
      status: JobStatus.Queued,
    });
    expect(response.body.requestId).toBeDefined();
  });

  it('should reject invalid request body', async () => {
    const response = await request(app).post('/generate').send({
      // Missing required fields
      message: 'Hello!',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});
