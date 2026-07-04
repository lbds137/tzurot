import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleRecentUsers } from './usersRecent.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

describe('GET /internal/users/recent', () => {
  let mockPrisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = { $queryRaw: vi.fn() };
    app = express();
    app.get(
      '/internal/users/recent',
      handleRecentUsers({ prisma: mockPrisma as unknown as PrismaClient })
    );
  });

  it('returns the list of recently active Discord IDs with default sinceDays=30', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { discord_id: '111111111111111111' },
      { discord_id: '222222222222222222' },
    ]);

    const response = await request(app).get('/internal/users/recent');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      discordIds: ['111111111111111111', '222222222222222222'],
      sinceDays: 30,
    });
    // Tagged-template invocation: first arg is the static-strings array,
    // bound parameters follow as positional rest args.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.any(Array), 30, 1000);
  });

  it('honors custom sinceDays query param', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const response = await request(app).get('/internal/users/recent?sinceDays=90');

    expect(response.status).toBe(200);
    expect(response.body.sinceDays).toBe(90);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.any(Array), 90, 1000);
  });

  it('returns empty list when no users match', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const response = await request(app).get('/internal/users/recent');

    expect(response.status).toBe(200);
    expect(response.body.discordIds).toEqual([]);
    expect(response.body.total).toBeUndefined();
  });

  it('accepts sinceDays=365 (max allowed)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const response = await request(app).get('/internal/users/recent?sinceDays=365');

    expect(response.status).toBe(200);
    expect(response.body.sinceDays).toBe(365);
  });

  it('rejects sinceDays=0 with 400', async () => {
    const response = await request(app).get('/internal/users/recent?sinceDays=0');

    expect(response.status).toBe(400);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects negative sinceDays with 400', async () => {
    const response = await request(app).get('/internal/users/recent?sinceDays=-5');

    expect(response.status).toBe(400);
  });

  it('rejects non-numeric sinceDays with 400', async () => {
    const response = await request(app).get('/internal/users/recent?sinceDays=abc');

    expect(response.status).toBe(400);
  });

  it('rejects sinceDays > 365 with 400', async () => {
    const response = await request(app).get('/internal/users/recent?sinceDays=999');

    expect(response.status).toBe(400);
  });

  it('returns 500 when the DB query throws', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const response = await request(app).get('/internal/users/recent');

    expect(response.status).toBe(500);
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it('filters non-snowflake discord_ids from the DB result and warns', async () => {
    // Real-world: DB schema enforces snowflake format, but data-drift
    // (migration leakage, test contamination) could produce malformed rows.
    // The handler should drop them rather than failing the whole batch.
    mockPrisma.$queryRaw.mockResolvedValue([
      { discord_id: '111111111111111111' }, // valid
      { discord_id: 'not-a-snowflake' }, // invalid — should be filtered
      { discord_id: '222222222222222222' }, // valid
    ]);

    const response = await request(app).get('/internal/users/recent');

    expect(response.status).toBe(200);
    expect(response.body.discordIds).toEqual(['111111111111111111', '222222222222222222']);
  });
});
