import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { RetentionPreviewResponseSchema } from '@tzurot/common-types/schemas/api/internal';

const buildPreviewMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/asyncHandler.js', () => ({ asyncHandler: vi.fn(fn => fn) }));
vi.mock('../../services/retention/RetentionPurgeService.js', () => ({
  // Plain function: constructable (arrows are not).
  RetentionPurgeService: function MockRetentionPurgeService() {
    return { buildPreview: buildPreviewMock };
  },
}));

import { handleRetentionPreview } from './retentionPreview.js';
import type { RouteDeps } from '../routeDeps.js';

const PREVIEW = {
  users: [
    {
      discordId: '900000000000000001',
      username: 'inactiveuser',
      inactiveSince: '2025-01-01T00:00:00.000Z',
      reason: 'unreachable' as const,
      ownedCharacters: { toDelete: 1, toReHome: 2 },
    },
  ],
  totals: {
    eligibleCount: 1,
    userbaseCount: 100,
    percentOfUserbase: 1,
    charactersToDelete: 1,
    charactersToReHome: 2,
    breakerWarning: false,
    reachableToNotify: 0,
    inGrace: 0,
    graceExpired: 0,
    bystander: 0,
  },
};

function createMockReqRes() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('GET /api/internal/retention/preview', () => {
  it('returns the service preview in the manifest-declared shape', async () => {
    buildPreviewMock.mockResolvedValue(PREVIEW);
    const { req, res } = createMockReqRes();

    await handleRetentionPreview({} as RouteDeps)(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toEqual(PREVIEW);
    // The wire body must satisfy the contract the generated client parses with.
    expect(RetentionPreviewResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('returns an empty cohort without erroring', async () => {
    buildPreviewMock.mockResolvedValue({
      users: [],
      totals: {
        eligibleCount: 0,
        userbaseCount: 100,
        percentOfUserbase: 0,
        charactersToDelete: 0,
        charactersToReHome: 0,
        breakerWarning: false,
        reachableToNotify: 0,
        inGrace: 0,
        graceExpired: 0,
        bystander: 0,
      },
    });
    const { req, res } = createMockReqRes();

    await handleRetentionPreview({} as RouteDeps)(req, res, vi.fn());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.users).toEqual([]);
    expect(RetentionPreviewResponseSchema.safeParse(payload).success).toBe(true);
  });
});
