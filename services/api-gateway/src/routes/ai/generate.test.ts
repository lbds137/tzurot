/**
 * Generate Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { handleAiGenerate } from './generate.js';
import { JobStatus, JOB_PREFIXES } from '@tzurot/common-types/constants/queue';
import type { RouteDeps } from '../routeDeps.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

// Mock dependencies. The dedup cache is one stable object across calls so the
// suite can assert on it (and on its ordering against createJobChain).
const mockDedupCache = vi.hoisted(() => ({
  reserve: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../../utils/deduplicationCache.js', () => ({
  getDeduplicationCache: vi.fn(() => mockDedupCache),
}));

// `llmJobIdFor` stays REAL: the route derives the reserved job id with it, and
// mocking it would hide a drift between the route's id and the enqueued one.
vi.mock('../../utils/jobChainOrchestrator.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/jobChainOrchestrator.js')>(
    '../../utils/jobChainOrchestrator.js'
  );
  return {
    ...actual,
    createJobChain: vi.fn().mockResolvedValue('llm-req-123'),
  };
});

// `sendCustomSuccess` is wrapped (delegating to the real one by default) so a
// single test can make a POST-enqueue statement throw. Nothing else in the
// module is stubbed.
vi.mock('../../utils/responseHelpers.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/responseHelpers.js')>(
    '../../utils/responseHelpers.js'
  );
  return { ...actual, sendCustomSuccess: vi.fn(actual.sendCustomSuccess) };
});

const { createJobChain } = await import('../../utils/jobChainOrchestrator.js');
const mockCreateJobChain = vi.mocked(createJobChain);
const { sendCustomSuccess } = await import('../../utils/responseHelpers.js');
const mockSendCustomSuccess = vi.mocked(sendCustomSuccess);

/** A body that passes validation and reaches the reserve→enqueue seam. */
const validBody = {
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
    kind: 'envelope' as const,
    rawAssemblyInputs: { rawMessageContent: 'hello' },
    userId: 'user-123',
    channelId: 'channel-123',
  },
};

describe('POST /api/internal/ai/generate', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDedupCache.reserve.mockResolvedValue({ kind: 'reserved' });
    mockDedupCache.release.mockResolvedValue(undefined);
    mockCreateJobChain.mockResolvedValue('llm-req-123');

    // Create Express app with generate router
    app = express();
    app.use(express.json());
    // handleAiGenerate reads only `deps.llmConfigResolver` (optional). With an
    // empty stub it's undefined, so createJobChain (mocked here) is invoked with
    // no resolver and falls back to the seed personality — exercising the
    // back-compat path. `{} as unknown as RouteDeps` is clearer than `as never`.
    app.post('/generate', handleAiGenerate({ ...stubRouteResolvers() } as unknown as RouteDeps));
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
          kind: 'envelope' as const,
          rawAssemblyInputs: { rawMessageContent: 'hello' },
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
    // A rejected request must not burn a reservation: the window is keyed by
    // content, so reserving for a 400 would suppress the user's corrected
    // resend. Correct by inspection today; this makes a regression go red.
    expect(mockDedupCache.reserve).not.toHaveBeenCalled();
  });

  it("rejects a context without kind:'envelope' with a clean 400 (legacy tolerance retired)", async () => {
    // The HTTP schema keeps kind optional for construction-site ergonomics;
    // the route's narrowing guard is what turns an absent discriminant into
    // a 400 instead of an opaque enqueue failure at the job schema.
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

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/envelope/);
    // Same short-circuit as the schema-validation case above: the envelope
    // guard sits BEFORE reserve(), so a rejected payload leaves the window free.
    expect(mockDedupCache.reserve).not.toHaveBeenCalled();
  });

  describe('deduplication reservation', () => {
    it('reserves BEFORE the job chain is enqueued', async () => {
      const response = await request(app).post('/generate').send(validBody);

      expect(response.status).toBe(202);
      // Ordering, not mere presence: the pre-fix code enqueued first and cached
      // after, so "both were called" would pass on the bug this guards.
      expect(mockDedupCache.reserve.mock.invocationCallOrder[0]).toBeLessThan(
        mockCreateJobChain.mock.invocationCallOrder[0] as number
      );
    });

    it('reserves under the same job id the chain will use', async () => {
      const response = await request(app).post('/generate').send(validBody);

      const [, reservedRequestId, reservedJobId] = mockDedupCache.reserve.mock.calls[0] as [
        unknown,
        string,
        string,
      ];
      expect(reservedRequestId).toBe(response.body.requestId);
      // Against the source constant, not a re-typed literal: hardcoding 'llm-'
      // here would assert the test's assumption equals itself. The literal wire
      // form is pinned once, in jobChainOrchestrator.test.ts.
      expect(reservedJobId).toBe(
        `${JOB_PREFIXES.LLM_GENERATION}${response.body.requestId as string}`
      );
    });

    it('releases under the SAME job id it reserved, so the delete can prove ownership', async () => {
      // release() compare-and-deletes on this id. If the route passed a
      // different one, the delete would silently no-op and the reservation
      // would block the client's retry for the full window.
      mockCreateJobChain.mockRejectedValue(new Error('queue down'));

      await request(app).post('/generate').send(validBody);

      const reservedJobId = (mockDedupCache.reserve.mock.calls[0] as [unknown, string, string])[2];
      expect(mockDedupCache.release.mock.calls[0]?.[1]).toBe(reservedJobId);
    });

    it('returns 503 and enqueues nothing when the reservation throws', async () => {
      mockDedupCache.reserve.mockRejectedValue(new Error('Redis connection lost'));

      const response = await request(app).post('/generate').send(validBody);

      expect(response.status).toBe(503);
      expect(mockCreateJobChain).not.toHaveBeenCalled();
    });

    it('returns the cached job without enqueueing on a duplicate', async () => {
      mockDedupCache.reserve.mockResolvedValue({
        kind: 'duplicate',
        cached: {
          requestId: 'req-existing',
          jobId: 'llm-req-existing',
          timestamp: Date.now(),
          expiresAt: Date.now() + 5000,
        },
      });

      const response = await request(app).post('/generate').send(validBody);

      expect(response.status).toBe(200);
      // sendSuccess wraps the payload — the duplicate response shape is unchanged
      expect(response.body).toMatchObject({
        success: true,
        data: {
          jobId: 'llm-req-existing',
          requestId: 'req-existing',
          status: JobStatus.Queued,
        },
      });
      expect(mockCreateJobChain).not.toHaveBeenCalled();
    });

    it('releases the reservation when the enqueue fails', async () => {
      mockCreateJobChain.mockRejectedValue(new Error('queue down'));

      await request(app).post('/generate').send(validBody);

      expect(mockDedupCache.release).toHaveBeenCalledTimes(1);
    });

    it('does NOT release when a statement after a successful enqueue throws', async () => {
      // The job genuinely exists at this point, so dropping its reservation
      // would let a concurrent duplicate enqueue a second real job — a
      // narrower version of the race the reservation closes. Pins that the
      // try/catch is scoped to createJobChain and not to the success path.
      mockSendCustomSuccess.mockImplementationOnce(() => {
        throw new Error('serialization blew up after the job was queued');
      });

      await request(app).post('/generate').send(validBody);

      expect(mockCreateJobChain).toHaveBeenCalledTimes(1);
      expect(mockDedupCache.release).not.toHaveBeenCalled();
    });
  });
});
