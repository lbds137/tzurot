/**
 * Tests for /user/stt-override routes.
 *
 * STT is user-scoped — single preference, no per-personality dimension.
 * Routes: GET /, PUT /, DELETE /.
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
  user: { findUnique: vi.fn(), update: vi.fn() },
};

const mockCache = { invalidateUserStt: vi.fn().mockResolvedValue(undefined) };

function buildRouter() {
  return createSttOverrideRoutes({
    prisma: mockPrisma as never,
    sttResolverCacheInvalidation: mockCache as never,
  });
}

describe('user/stt-override routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns the user STT preference when set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ defaultSttProviderId: 'mistral' });
      const handler = extractHandler(buildRouter(), 'get', '/');
      const { res, json, status } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(json).toHaveBeenCalledWith({ default: { providerId: 'mistral' } });
    });

    it('returns null when no preference is set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ defaultSttProviderId: null });
      const handler = extractHandler(buildRouter(), 'get', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(json).toHaveBeenCalledWith({ default: { providerId: null } });
    });

    it('narrows unknown DB strings to null (legacy / out-of-band data defense)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ defaultSttProviderId: 'whisper' });
      const handler = extractHandler(buildRouter(), 'get', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(json).toHaveBeenCalledWith({ default: { providerId: null } });
    });
  });

  describe('PUT /', () => {
    it('writes User.defaultSttProviderId and returns the value', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      const handler = extractHandler(buildRouter(), 'put', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ body: { providerId: 'mistral' } }), res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { defaultSttProviderId: 'mistral' },
      });
      expect(json).toHaveBeenCalledWith({ default: { providerId: 'mistral' } });
    });

    it('rejects unknown providers via Zod validation', async () => {
      const handler = extractHandler(buildRouter(), 'put', '/');
      const { res, status, json } = makeMockRes();

      await handler(makeMockReq({ body: { providerId: 'whisper' } }), res);

      expect(status).toHaveBeenCalledWith(400);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalled();
    });
  });

  describe('DELETE /', () => {
    it('returns wasSet:false when no preference was set (idempotent)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ defaultSttProviderId: null });
      const handler = extractHandler(buildRouter(), 'delete', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: false });
    });

    it('clears the preference when one was set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ defaultSttProviderId: 'mistral' });
      mockPrisma.user.update.mockResolvedValue({});
      const handler = extractHandler(buildRouter(), 'delete', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { defaultSttProviderId: null },
      });
      expect(json).toHaveBeenCalledWith({ deleted: true, wasSet: true });
    });
  });
});
