/**
 * Tests for Shapes.inc Credential Routes
 *
 * Tests POST, DELETE, and GET /status handlers for shapes.inc session cookie management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    encryptApiKey: vi.fn().mockReturnValue({
      iv: 'mock-iv-value',
      content: 'mock-encrypted-content',
      tag: 'mock-tag-value',
    }),
  };
});

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
  requireProvisionedUser: vi.fn(() =>
    vi.fn((_req: unknown, _res: unknown, next: () => void) => next())
  ),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock the preflight so tests don't hit shapes.inc. Default to 'valid' so the
// happy-path tests don't need per-case wiring; error-path tests override per call.
// Strictly typed so a typo in a mockResolvedValueOnce call (e.g., 'inconclusve')
// would fail type-check rather than silently misdirect the test.
import type { PreflightOutcome } from '../../../services/ShapesPreflight.js';
const mockProbeShapesSession = vi
  .fn<(sessionCookie: string) => Promise<PreflightOutcome>>()
  .mockResolvedValue('valid');
vi.mock('../../../services/ShapesPreflight.js', () => ({
  probeShapesSession: (cookie: string) => mockProbeShapesSession(cookie),
}));

import { createShapesAuthRoutes } from './auth.js';
import type { PrismaClient } from '@tzurot/common-types';
import { findRoute, getRouteHandler } from '../../../test/expressRouterUtils.js';

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    upsert: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
  },
  persona: {
    create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }),
  },
  userCredential: {
    upsert: vi.fn().mockResolvedValue({ id: 'cred-uuid-123' }),
    findFirst: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue({}),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }),
      },
      persona: {
        create: vi.fn().mockResolvedValue({ id: 'persona-uuid-123' }),
      },
    };
    await callback(mockTx);
  }),
};

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('Shapes Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset preflight mock default after clearAllMocks wipes the implementation.
    mockProbeShapesSession.mockResolvedValue('valid');
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createShapesAuthRoutes(mockPrisma as unknown as PrismaClient);
      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have POST, DELETE, and GET routes', () => {
      const router = createShapesAuthRoutes(mockPrisma as unknown as PrismaClient);

      expect(findRoute(router, 'post', '/')).toBeDefined();
      expect(findRoute(router, 'delete', '/')).toBeDefined();
      expect(findRoute(router, 'get', '/status')).toBeDefined();
    });
  });

  describe('POST / (store credentials)', () => {
    async function callStoreHandler(
      body: Record<string, unknown>,
      prisma = mockPrisma
    ): Promise<{ req: Request & { userId: string }; res: Response }> {
      const { req, res } = createMockReqRes(body);
      const router = createShapesAuthRoutes(prisma as unknown as PrismaClient);
      const handler = getRouteHandler(router, 'post', '/');
      await handler(req, res);
      return { req, res };
    }

    it('should reject missing sessionCookie', async () => {
      const { res } = await callStoreHandler({});

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
    });

    it('should reject empty sessionCookie', async () => {
      const { res } = await callStoreHandler({ sessionCookie: '   ' });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject a cookie with an unexpected name', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: 'randomCookie=value',
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('__Secure-better-auth.session_token'),
        })
      );
    });

    it('should reject a cookie whose name is embedded but not at the start (prefix defense)', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: 'fake-prefix__Secure-better-auth.session_token=value',
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject a legacy Auth0 cookie (appSession format)', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: 'appSession=legacy-value',
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject the expected cookie name with an empty value', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: '__Secure-better-auth.session_token=',
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject a value shorter than the minimum length', async () => {
      // 8-char value; the min is 32. Matches bot-client modal's parse-time
      // check so there's no gate that accepts what the other rejects.
      const { res } = await callStoreHandler({
        sessionCookie: '__Secure-better-auth.session_token=tooShort',
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('32-512 characters') })
      );
    });

    it('should reject a value containing disallowed characters', async () => {
      // 32 chars of allowed characters + a space → passes the length gate and
      // fails on the token-shape regex. Important that the length passes here
      // so this test exercises the character-class rejection path specifically,
      // not the length path (which has its own test above).
      const { res } = await callStoreHandler({
        sessionCookie: `__Secure-better-auth.session_token=${'a'.repeat(30)} bb`,
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('alphanumeric') })
      );
    });

    it('should reject a value longer than the maximum length', async () => {
      // Pathological oversize input — 10 KB of alphanumeric passes the shape
      // regex but must be rejected by the length ceiling so it can't reach
      // the preflight fetch with a multi-KB Cookie header.
      const { res } = await callStoreHandler({
        sessionCookie: `__Secure-better-auth.session_token=${'a'.repeat(10000)}`,
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should encrypt and upsert a valid Better Auth session cookie', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: '__Secure-better-auth.session_token=opaque-better-auth-token-value-12345',
      });

      expect(mockPrisma.userCredential.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            iv: 'mock-iv-value',
            content: 'mock-encrypted-content',
            tag: 'mock-tag-value',
            service: 'shapes_inc',
            credentialType: 'session_cookie',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    describe('preflight outcomes', () => {
      const VALID_COOKIE =
        '__Secure-better-auth.session_token=opaque-better-auth-token-value-12345';

      it('persists the cookie when preflight returns "valid"', async () => {
        mockProbeShapesSession.mockResolvedValueOnce('valid');
        const { res } = await callStoreHandler({ sessionCookie: VALID_COOKIE });

        expect(mockProbeShapesSession).toHaveBeenCalledWith(VALID_COOKIE);
        expect(mockPrisma.userCredential.upsert).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('rejects the cookie and does NOT persist when preflight returns "invalid"', async () => {
        mockProbeShapesSession.mockResolvedValueOnce('invalid');
        const { res } = await callStoreHandler({ sessionCookie: VALID_COOKIE });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('shapes.inc rejected this session cookie'),
          })
        );
        expect(mockPrisma.userCredential.upsert).not.toHaveBeenCalled();
      });

      it('persists the cookie when preflight returns "inconclusive" (graceful degradation)', async () => {
        // Transient shapes.inc failures must not block saving valid credentials.
        mockProbeShapesSession.mockResolvedValueOnce('inconclusive');
        const { res } = await callStoreHandler({ sessionCookie: VALID_COOKIE });

        expect(mockPrisma.userCredential.upsert).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('does NOT run the preflight when format validation already rejects', async () => {
        // tooShort fails the shape check before the preflight would be called.
        await callStoreHandler({
          sessionCookie: '__Secure-better-auth.session_token=tooShort',
        });

        expect(mockProbeShapesSession).not.toHaveBeenCalled();
      });
    });
  });

  describe('DELETE / (remove credentials)', () => {
    async function callDeleteHandler(
      prisma = mockPrisma
    ): Promise<{ req: Request & { userId: string }; res: Response }> {
      const { req, res } = createMockReqRes();
      const router = createShapesAuthRoutes(prisma as unknown as PrismaClient);
      const handler = getRouteHandler(router, 'delete', '/');
      await handler(req, res);
      return { req, res };
    }

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const { res } = await callDeleteHandler();

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when credential not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue(null);
      const { res } = await callDeleteHandler();

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should delete credential and return success', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue({ id: 'cred-uuid-123' });

      const { res } = await callDeleteHandler();

      expect(mockPrisma.userCredential.delete).toHaveBeenCalledWith({
        where: { id: 'cred-uuid-123' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('GET /status', () => {
    async function callStatusHandler(
      prisma = mockPrisma
    ): Promise<{ req: Request & { userId: string }; res: Response }> {
      const { req, res } = createMockReqRes();
      const router = createShapesAuthRoutes(prisma as unknown as PrismaClient);
      const handler = getRouteHandler(router, 'get', '/status');
      await handler(req, res);
      return { req, res };
    }

    it('should return hasCredentials: false when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const { res } = await callStatusHandler();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hasCredentials: false }));
    });

    it('should return hasCredentials: false when credential not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue(null);
      const { res } = await callStatusHandler();

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hasCredentials: false }));
    });

    it('should return hasCredentials: true with timestamps', async () => {
      const now = new Date('2026-02-16T12:00:00Z');
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
      mockPrisma.userCredential.findFirst.mockResolvedValue({
        createdAt: now,
        lastUsedAt: null,
        expiresAt: null,
      });

      const { res } = await callStatusHandler();

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          hasCredentials: true,
          storedAt: now.toISOString(),
          lastUsedAt: null,
          expiresAt: null,
        })
      );
    });
  });
});
