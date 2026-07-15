/**
 * Tests for /user/tts-override routes.
 *
 * Same handler-extraction pattern as tts-config.test.ts. Mocks prisma at
 * the boundary so handlers can be exercised without DB or Express stack.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: () => (_req: Request, _res: Response, next: () => void) => next(),
  requireProvisionedUser: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock('../../utils/resolveProvisionedUserId.js', () => ({
  resolveProvisionedUserId: vi.fn(() => 'user-uuid-1'),
}));

vi.mock('../../utils/configOverrideHelpers.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/configOverrideHelpers.js')>();
  return {
    ...actual,
    tryInvalidateCache: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@tzurot/common-types/utils/deterministicUuid', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/utils/deterministicUuid')
  >('@tzurot/common-types/utils/deterministicUuid');
  return {
    ...actual,
    generateUserPersonalityConfigUuid: vi.fn(() => 'upc-uuid-1'),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const { createTtsOverrideRoutes } = await import('./tts-override.js');

function makeMockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  return {
    res: { status, json } as unknown as Response,
    json,
    status,
  };
}

function makeMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    userId: '111111111111111111',
    params: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
  };
}

function extractHandler(router: Router, method: string, path: string) {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  const layer = stack.find(
    l => l.route?.path === path && l.route?.methods[method.toLowerCase()] === true
  );
  if (!layer?.route) {
    throw new Error(`Handler for ${method} ${path} not found`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const mockPrisma = {
  ttsConfig: {
    findFirst: vi.fn(),
  },
  personality: {
    findFirst: vi.fn(),
  },
  userPersonalityConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  // The clear-default handler reads the system free default off the
  // AdminSettings pointer; null = no free default configured.
  adminSettings: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

const mockCache = {
  invalidateUserTtsConfig: vi.fn().mockResolvedValue(undefined),
  invalidateConfigUsers: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
};

function buildRouter() {
  return createTtsOverrideRoutes({
    ...stubRouteResolvers(),
    prisma: mockPrisma as never,
    ttsConfigCacheInvalidation: mockCache as never,
  });
}

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';

describe('user/tts-override routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockPrisma.userPersonalityConfig.findUnique).mockResolvedValue(null);
  });

  describe('GET / (list overrides)', () => {
    it('returns formatted overrides', async () => {
      vi.mocked(mockPrisma.userPersonalityConfig.findMany).mockResolvedValue([
        {
          personalityId: 'p1',
          personality: { name: 'Alice' },
          ttsConfigId: 'c1',
          ttsConfig: { name: 'kyutai-self-hosted' },
        },
      ]);
      const handler = extractHandler(buildRouter(), 'GET', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(mockPrisma.userPersonalityConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ttsConfigId: { not: null } }),
        })
      );
      expect(json).toHaveBeenCalledWith({
        overrides: [
          {
            personalityId: 'p1',
            personalityName: 'Alice',
            configId: 'c1',
            configName: 'kyutai-self-hosted',
          },
        ],
      });
    });

    it('handles empty list', async () => {
      vi.mocked(mockPrisma.userPersonalityConfig.findMany).mockResolvedValue([]);
      const handler = extractHandler(buildRouter(), 'GET', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(json).toHaveBeenCalledWith({ overrides: [] });
    });
  });

  describe('PUT / (set override)', () => {
    it('returns 400 on invalid UUID', async () => {
      const handler = extractHandler(buildRouter(), 'PUT', '/');
      const { res } = makeMockRes();

      await handler(
        makeMockReq({ body: { personalityId: 'not-uuid', configId: VALID_UUID_A } }),
        res
      );
      expect(mockPrisma.userPersonalityConfig.upsert).not.toHaveBeenCalled();
    });

    it('returns 404 when personality not found', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'PUT', '/');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({ body: { personalityId: VALID_UUID_A, configId: VALID_UUID_B } }),
        res
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
          message: expect.stringContaining('Personality'),
        })
      );
    });

    it('returns 404 when TTS config is not accessible to the user', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue({
        id: VALID_UUID_A,
        name: 'Alice',
      });
      vi.mocked(mockPrisma.ttsConfig.findFirst).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'PUT', '/');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({ body: { personalityId: VALID_UUID_A, configId: VALID_UUID_B } }),
        res
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
          message: expect.stringContaining('TtsConfig'),
        })
      );
    });

    it('upserts UserPersonalityConfig.ttsConfigId on happy path', async () => {
      vi.mocked(mockPrisma.personality.findFirst).mockResolvedValue({
        id: VALID_UUID_A,
        name: 'Alice',
      });
      vi.mocked(mockPrisma.ttsConfig.findFirst).mockResolvedValue({
        id: VALID_UUID_B,
        name: 'kyutai-self-hosted',
      });
      vi.mocked(mockPrisma.userPersonalityConfig.upsert).mockResolvedValue({
        personalityId: VALID_UUID_A,
        personality: { name: 'Alice' },
        ttsConfigId: VALID_UUID_B,
        ttsConfig: { name: 'kyutai-self-hosted' },
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/');
      const { res, status, json } = makeMockRes();

      await handler(
        makeMockReq({ body: { personalityId: VALID_UUID_A, configId: VALID_UUID_B } }),
        res
      );

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ ttsConfigId: VALID_UUID_B }),
          update: { ttsConfigId: VALID_UUID_B },
        })
      );
      expect(status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          override: expect.objectContaining({ configId: VALID_UUID_B }),
        })
      );
    });
  });

  describe('GET /default', () => {
    it('returns null default when none set', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({
        defaultTtsConfigId: null,
        defaultTtsConfig: null,
      });
      const handler = extractHandler(buildRouter(), 'GET', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(json).toHaveBeenCalledWith({
        default: { configId: null, configName: null },
      });
    });

    it('returns the default when set', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({
        defaultTtsConfigId: 'c1',
        defaultTtsConfig: { name: 'kyutai-self-hosted' },
      });
      const handler = extractHandler(buildRouter(), 'GET', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(json).toHaveBeenCalledWith({
        default: { configId: 'c1', configName: 'kyutai-self-hosted' },
      });
    });
  });

  describe('PUT /default', () => {
    it('returns 404 when config not accessible', async () => {
      vi.mocked(mockPrisma.ttsConfig.findFirst).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'PUT', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ body: { configId: VALID_UUID_A } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('updates user.defaultTtsConfigId on happy path', async () => {
      vi.mocked(mockPrisma.ttsConfig.findFirst).mockResolvedValue({
        id: VALID_UUID_A,
        name: 'kyutai-self-hosted',
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ body: { configId: VALID_UUID_A } }), res);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { defaultTtsConfigId: VALID_UUID_A },
      });
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          default: { configId: VALID_UUID_A, configName: 'kyutai-self-hosted' },
        })
      );
    });
  });

  describe('DELETE /default', () => {
    it('returns idempotent success with wasSet:false when no default exists', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ defaultTtsConfigId: null });
      vi.mocked(mockPrisma.ttsConfig.findFirst).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'DELETE', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({
        deleted: true,
        wasSet: false,
        newEffectiveDefault: null,
      });
    });

    it('clears defaultTtsConfigId when one is set, returning wasSet: true', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ defaultTtsConfigId: 'c1' });
      vi.mocked(mockPrisma.ttsConfig.findFirst).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'DELETE', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { defaultTtsConfigId: null },
      });
      // Symmetric with the no-op `wasSet: false` branch — clients can branch
      // on `wasSet` alone to tell "actually cleared" from "already empty".
      expect(json).toHaveBeenCalledWith({
        deleted: true,
        wasSet: true,
        newEffectiveDefault: null,
      });
    });

    it('includes newEffectiveDefault on the no-op path when free default exists', async () => {
      // Coverage: the 4th cell in the (wasSet × freeDefault) matrix.
      // Confirms the pointer lookup still runs even when the early-return wasSet:false
      // branch is taken.
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ defaultTtsConfigId: null });
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue({
        freeDefaultTtsConfig: { id: 'free-id', name: 'kyutai-self-hosted' },
      } as never);
      const handler = extractHandler(buildRouter(), 'DELETE', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({
        deleted: true,
        wasSet: false,
        newEffectiveDefault: { id: 'free-id', name: 'kyutai-self-hosted' },
      });
    });

    it('includes the system free default in newEffectiveDefault when one is configured', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ defaultTtsConfigId: 'c1' });
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValue({
        freeDefaultTtsConfig: { id: 'free-id', name: 'kyutai-self-hosted' },
      } as never);
      const handler = extractHandler(buildRouter(), 'DELETE', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);
      // The lookup goes through the AdminSettings pointer, not the stale flag.
      expect(mockPrisma.adminSettings.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { freeDefaultTtsConfig: { select: { id: true, name: true } } },
        })
      );
      expect(json).toHaveBeenCalledWith({
        deleted: true,
        wasSet: true,
        newEffectiveDefault: { id: 'free-id', name: 'kyutai-self-hosted' },
      });
    });
  });

  describe('DELETE /:personalityId (reset override)', () => {
    it('returns idempotent success when no override exists', async () => {
      vi.mocked(mockPrisma.userPersonalityConfig.findFirst).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'DELETE', '/:personalityId');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { personalityId: VALID_UUID_A } }), res);
      expect(mockPrisma.userPersonalityConfig.update).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: false });
    });

    it('returns idempotent success when override exists but ttsConfigId is null', async () => {
      vi.mocked(mockPrisma.userPersonalityConfig.findFirst).mockResolvedValue({
        id: 'upc-1',
        ttsConfigId: null,
        personality: { name: 'Alice' },
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:personalityId');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { personalityId: VALID_UUID_A } }), res);
      expect(mockPrisma.userPersonalityConfig.update).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: false });
    });

    it('clears ttsConfigId when an override is set, returning wasSet: true', async () => {
      vi.mocked(mockPrisma.userPersonalityConfig.findFirst).mockResolvedValue({
        id: 'upc-1',
        ttsConfigId: 'c1',
        personality: { name: 'Alice' },
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:personalityId');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { personalityId: VALID_UUID_A } }), res);
      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledWith({
        where: { id: 'upc-1' },
        data: { ttsConfigId: null },
      });
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: true });
    });
  });
});
