/**
 * Tests for POST /internal/users/dm-undeliverable
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleStampUserDmUndeliverable } from './usersDmUndeliverable.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

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

const mockStampDmPermanentFailure = vi.fn();
vi.mock('../../services/retention/dmFailureStamps.js', () => ({
  stampDmPermanentFailure: (...args: unknown[]) =>
    (mockStampDmPermanentFailure as (...args: unknown[]) => unknown)(...args),
}));

const VALID_DISCORD_ID = '123456789012345678';
const USER_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('POST /api/internal/users/dm-undeliverable', () => {
  let mockFindUnique: ReturnType<typeof vi.fn>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique = vi.fn();
    const mockPrisma = { user: { findUnique: mockFindUnique } };
    app = express();
    app.use(express.json());
    app.post(
      '/internal/users/dm-undeliverable',
      handleStampUserDmUndeliverable({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      })
    );
  });

  it('stamps a known user and forwards the user UUID + error code across the seam', async () => {
    mockFindUnique.mockResolvedValue({ id: USER_UUID });
    mockStampDmPermanentFailure.mockResolvedValue(1);

    const response = await request(app)
      .post('/internal/users/dm-undeliverable')
      .send({ discordId: VALID_DISCORD_ID, errorCode: '50007' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stamped: true });
    // The row is resolved by the Discord snowflake, not by the internal id —
    // without this the handler could look up the wrong column and still pass,
    // because the mock returns the row for any argument.
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { discordId: VALID_DISCORD_ID } })
    );
    // Canary: must fail if the handler passes discordId instead of the
    // resolved user UUID.
    expect(mockStampDmPermanentFailure).toHaveBeenCalledWith(expect.anything(), USER_UUID, '50007');
  });

  it('no-ops when the user has no row (unprovisioned DM target)', async () => {
    mockFindUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/internal/users/dm-undeliverable')
      .send({ discordId: VALID_DISCORD_ID, errorCode: '50007' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stamped: false });
    expect(mockStampDmPermanentFailure).not.toHaveBeenCalled();
  });

  it('reports stamped:false when the stamp helper guards the write (0 rows)', async () => {
    mockFindUnique.mockResolvedValue({ id: USER_UUID });
    mockStampDmPermanentFailure.mockResolvedValue(0);

    const response = await request(app)
      .post('/internal/users/dm-undeliverable')
      .send({ discordId: VALID_DISCORD_ID, errorCode: '20026' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ stamped: false });
  });

  it('rejects a non-snowflake discordId with Zod validation', async () => {
    const response = await request(app)
      .post('/internal/users/dm-undeliverable')
      .send({ discordId: 'not-a-snowflake', errorCode: '50007' });

    expect(response.status).toBe(400);
    expect(mockStampDmPermanentFailure).not.toHaveBeenCalled();
  });

  it('rejects a missing errorCode', async () => {
    const response = await request(app)
      .post('/internal/users/dm-undeliverable')
      .send({ discordId: VALID_DISCORD_ID });

    expect(response.status).toBe(400);
    expect(mockStampDmPermanentFailure).not.toHaveBeenCalled();
  });
});
