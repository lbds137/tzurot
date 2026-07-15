/**
 * Tests for the feedback intake gates (unit; the dedupe query + index run
 * for real in feedback.component.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { handleSubmitFeedback } from './feedback.js';
import { FEEDBACK_LIMITS } from '@tzurot/common-types/constants/feedback';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../routeDeps.js';

const mockRedis = {
  ttl: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn().mockResolvedValue(1),
  setex: vi.fn().mockResolvedValue('OK'),
};

const mockPrisma = {
  userFeedback: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    ...stubRouteResolvers(),
    prisma: mockPrisma as unknown as PrismaClient,
    redis: mockRedis as unknown as RouteDeps['redis'],
    ...overrides,
  } as RouteDeps;
}

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    query: {},
    userId: 'discord-user-123',
    provisionedUserId: 'user-uuid-123',
    provisionedDefaultPersonaId: 'persona-uuid-default',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

async function callSubmit(body: Record<string, unknown>, deps = makeDeps()) {
  const { req, res } = createMockReqRes(body);
  await handleSubmitFeedback(deps)(req, res, vi.fn());
  return { req, res };
}

describe('handleSubmitFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.ttl.mockResolvedValue(-2); // no cooldown key
    mockRedis.incr.mockResolvedValue(1);
    mockPrisma.userFeedback.findFirst.mockResolvedValue(null);
    mockPrisma.userFeedback.create.mockResolvedValue({ id: 'feedback-row-1' });
  });

  it('503s without redis (gates cannot run)', async () => {
    const { res } = await callSubmit({ content: 'hi' }, makeDeps({ redis: undefined }));
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('rejects an active cooldown with the remaining seconds, before any other gate', async () => {
    mockRedis.ttl.mockResolvedValue(42);
    const { res } = await callSubmit({ content: 'valid feedback' });

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.message).toContain('42 seconds');
    // Cheap-first order: cooldown rejection means no counter burn, no DB hit.
    expect(mockRedis.incr).not.toHaveBeenCalled();
    expect(mockPrisma.userFeedback.findFirst).not.toHaveBeenCalled();
  });

  it('rejects past the daily cap without touching the DB', async () => {
    mockRedis.incr.mockResolvedValue(FEEDBACK_LIMITS.DAILY_CAP + 1);
    const { res } = await callSubmit({ content: 'valid feedback' });

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.message).toContain(`${FEEDBACK_LIMITS.DAILY_CAP} per day`);
    expect(mockPrisma.userFeedback.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a near-dup within the window without storing or arming cooldown', async () => {
    mockPrisma.userFeedback.findFirst.mockResolvedValue({ id: 'existing' });
    const { res } = await callSubmit({ content: 'same complaint again' });

    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.message).toContain('already submitted');
    expect(mockPrisma.userFeedback.create).not.toHaveBeenCalled();
    expect(mockRedis.setex).not.toHaveBeenCalled();
  });

  it('stores with a normalized content hash and arms the cooldown ONLY after success', async () => {
    const { res } = await callSubmit({ content: '  The BOT   is great ' });

    const createArgs = mockPrisma.userFeedback.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user-uuid-123');
    // Stored content keeps the user's (trimmed) words; the HASH is normalized.
    expect(createArgs.data.content).toBe('The BOT   is great');
    expect(createArgs.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createArgs.data.id).toMatch(/^[0-9a-f-]{36}$/);

    // Cooldown keyed by the DISCORD id, armed after the row exists.
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'feedback:cooldown:discord-user-123',
      FEEDBACK_LIMITS.COOLDOWN_SECONDS,
      '1'
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, feedbackId: 'feedback-row-1' });
  });

  it('fails OPEN when Redis errors mid-gate — the submission still lands', async () => {
    mockRedis.ttl.mockRejectedValue(new Error('connection dropped'));
    mockRedis.incr.mockRejectedValue(new Error('connection dropped'));
    mockRedis.setex.mockRejectedValueOnce(new Error('connection dropped'));

    const { res } = await callSubmit({ content: 'still gets through' });

    expect(mockPrisma.userFeedback.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('sets the daily counter TTL only on the first increment of the day', async () => {
    await callSubmit({ content: 'first of the day' });
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);

    mockRedis.incr.mockResolvedValue(2);
    await callSubmit({ content: 'second of the day' });
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
  });
});
