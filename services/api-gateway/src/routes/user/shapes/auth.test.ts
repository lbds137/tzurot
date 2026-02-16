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
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
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

    it('should reject cookie missing appSession.0', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: 'appSession.1=value',
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('appSession.0'),
        })
      );
    });

    it('should reject cookie missing appSession.1', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: 'appSession.0=value',
      });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should encrypt and upsert valid cookie', async () => {
      const { res } = await callStoreHandler({
        sessionCookie: 'appSession.0=part0; appSession.1=part1',
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
