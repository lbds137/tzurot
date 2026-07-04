/**
 * Generate Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { handleAiGenerate } from './generate.js';
import { JobStatus } from '@tzurot/common-types/constants/queue';
import type { RouteDeps } from '../routeDeps.js';

// Mock dependencies
vi.mock('../../utils/deduplicationCache.js', () => ({
  getDeduplicationCache: vi.fn(() => ({
    checkDuplicate: vi.fn().mockResolvedValue(null),
    cacheRequest: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../utils/jobChainOrchestrator.js', () => ({
  createJobChain: vi.fn().mockResolvedValue('llm-req-123'),
}));

describe('POST /generate', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create Express app with generate router
    app = express();
    app.use(express.json());
    // handleAiGenerate reads only `deps.llmConfigResolver` (optional). With an
    // empty stub it's undefined, so createJobChain (mocked here) is invoked with
    // no resolver and falls back to the seed personality — exercising the
    // back-compat path. `{} as unknown as RouteDeps` is clearer than `as never`.
    app.post('/generate', handleAiGenerate({} as unknown as RouteDeps));
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
          ownerId: 'owner-uuid-test',
          systemPrompt: 'You are a helpful assistant',
          model: 'anthropic/claude-sonnet-4.5',
          provider: 'openrouter',
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
