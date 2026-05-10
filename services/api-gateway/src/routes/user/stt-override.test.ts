/**
 * Tests for /user/stt-override routes.
 *
 * Mirrors the tts-override.test.ts pattern: mocks Prisma + the auth/handler
 * middleware at the boundary, then exercises each route handler directly
 * via the router stack.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';

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

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    generateUserPersonalityConfigUuid: vi.fn(() => 'upc-uuid-1'),
  };
});

const { createSttOverrideRoutes } = await import('./stt-override.js');

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
  personality: { findFirst: vi.fn() },
  userPersonalityConfig: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  user: { findUnique: vi.fn(), update: vi.fn() },
};

const mockCache = { invalidateUserStt: vi.fn().mockResolvedValue(undefined) };

function buildRouter() {
  return createSttOverrideRoutes(mockPrisma as never, mockCache as never);
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('user/stt-override routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns the user list of per-personality STT overrides', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: 'p-1',
          personality: { name: 'Alice' },
          sttProviderId: 'mistral',
        },
      ]);
      const handler = extractHandler(buildRouter(), 'get', '/');
      const { res, json, status } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(json).toHaveBeenCalledWith({
        overrides: [{ personalityId: 'p-1', personalityName: 'Alice', providerId: 'mistral' }],
      });
    });
  });

  describe('PUT /', () => {
    it('upserts the per-personality STT override and returns the summary', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({ id: VALID_UUID, name: 'Alice' });
      mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({
        personalityId: VALID_UUID,
        personality: { name: 'Alice' },
        sttProviderId: 'elevenlabs',
      });
      const handler = extractHandler(buildRouter(), 'put', '/');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({ body: { personalityId: VALID_UUID, providerId: 'elevenlabs' } }),
        res
      );

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({
        override: {
          personalityId: VALID_UUID,
          personalityName: 'Alice',
          providerId: 'elevenlabs',
        },
      });
      // Cache invalidation flows through the mocked tryInvalidateCache
      // wrapper; direct assertion on mockCache.invalidateUserStt would fail
      // because the wrapper is a vi.fn() no-op. Wrapper coverage lives in
      // configOverrideHelpers tests.
    });

    it('rejects unknown providers via Zod validation', async () => {
      const handler = extractHandler(buildRouter(), 'put', '/');
      const { res, status, json } = makeMockRes();

      await handler(
        makeMockReq({ body: { personalityId: VALID_UUID, providerId: 'whisper' } }),
        res
      );

      expect(status).toHaveBeenCalledWith(400);
      expect(mockPrisma.userPersonalityConfig.upsert).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalled();
    });
  });

  describe('PUT /default', () => {
    it('writes User.defaultSttProviderId and returns the value', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      const handler = extractHandler(buildRouter(), 'put', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ body: { providerId: 'mistral' } }), res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { defaultSttProviderId: 'mistral' },
      });
      expect(json).toHaveBeenCalledWith({ default: { providerId: 'mistral' } });
    });
  });

  describe('DELETE /default', () => {
    it('returns wasSet:false when no default was set (idempotent)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ defaultSttProviderId: null });
      const handler = extractHandler(buildRouter(), 'delete', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: false });
    });

    it('clears the default when one was set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ defaultSttProviderId: 'mistral' });
      mockPrisma.user.update.mockResolvedValue({});
      const handler = extractHandler(buildRouter(), 'delete', '/default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { defaultSttProviderId: null },
      });
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: true });
    });
  });

  describe('DELETE /:personalityId', () => {
    it('returns wasSet:false when no override existed', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'delete', '/:personalityId');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { personalityId: 'p-1' } }), res);

      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: false });
    });

    it('clears an existing per-personality STT override', async () => {
      mockPrisma.userPersonalityConfig.findFirst.mockResolvedValue({
        id: 'upc-1',
        sttProviderId: 'mistral',
        personality: { name: 'Alice' },
      });
      mockPrisma.userPersonalityConfig.update.mockResolvedValue({});
      const handler = extractHandler(buildRouter(), 'delete', '/:personalityId');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { personalityId: 'p-1' } }), res);

      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledWith({
        where: { id: 'upc-1' },
        data: { sttProviderId: null },
      });
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: true });
    });
  });
});
