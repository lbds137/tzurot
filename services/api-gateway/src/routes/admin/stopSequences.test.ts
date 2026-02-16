/**
 * Tests for Admin Stop Sequence Stats Routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { createStopSequenceRoutes } from './stopSequences.js';

// Mock the logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

function createMockRedis(
  overrides: {
    total?: string | null;
    bySequence?: Record<string, string>;
    byModel?: Record<string, string>;
    startedAt?: string | null;
  } = {}
) {
  const mockRedis = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'stop_seq:total') return Promise.resolve(overrides.total ?? null);
      if (key === 'stop_seq:started_at') return Promise.resolve(overrides.startedAt ?? null);
      return Promise.resolve(null);
    }),
    hgetall: vi.fn().mockImplementation((key: string) => {
      if (key === 'stop_seq:by_sequence') return Promise.resolve(overrides.bySequence ?? {});
      if (key === 'stop_seq:by_model') return Promise.resolve(overrides.byModel ?? {});
      return Promise.resolve({});
    }),
  } as unknown as Redis;

  return mockRedis;
}

function createApp(redis: Redis) {
  const app = express();
  app.use('/admin/stop-sequences', createStopSequenceRoutes(redis));
  return app;
}

describe('GET /admin/stop-sequences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return stats from Redis', async () => {
    const redis = createMockRedis({
      total: '42',
      bySequence: { '\nUser:': '30', '\nHuman:': '12' },
      byModel: { 'gpt-4': '25', 'claude-3': '17' },
      startedAt: '2026-02-10T00:00:00.000Z',
    });
    const app = createApp(redis);

    const res = await request(app).get('/admin/stop-sequences');

    expect(res.status).toBe(200);
    expect(res.body.totalActivations).toBe(42);
    expect(res.body.bySequence['\nUser:']).toBe(30);
    expect(res.body.bySequence['\nHuman:']).toBe(12);
    expect(res.body.byModel['gpt-4']).toBe(25);
    expect(res.body.byModel['claude-3']).toBe(17);
    expect(res.body.startedAt).toBe('2026-02-10T00:00:00.000Z');
  });

  it('should handle empty Redis keys gracefully', async () => {
    const redis = createMockRedis();
    const app = createApp(redis);

    const res = await request(app).get('/admin/stop-sequences');

    expect(res.status).toBe(200);
    expect(res.body.totalActivations).toBe(0);
    expect(res.body.bySequence).toEqual({});
    expect(res.body.byModel).toEqual({});
    expect(res.body.startedAt).toBeDefined();
  });
});
