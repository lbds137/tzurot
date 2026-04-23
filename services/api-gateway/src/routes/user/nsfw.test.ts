/**
 * NSFW Routes Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import { createNsfwRoutes } from './nsfw.js';

// Mock dependencies
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  persona: {
    create: vi.fn(),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
  $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: 'test-uuid' }),
        update: vi.fn().mockResolvedValue({ id: 'test-uuid' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }),
      },
      persona: {
        create: vi.fn().mockResolvedValue({ id: 'test-persona-id' }),
      },
    };
    return await callback(mockTx);
  }),
};

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../services/AuthMiddleware.js');

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

function createTestApp() {
  const app = express();
  app.use(express.json());
  // Mock auth middleware - sets req.userId
  app.use((req, _res, next) => {
    (req as any).userId = '123456789012345678';
    next();
  });
  app.use('/nsfw', createNsfwRoutes(mockPrisma as any));
  return app;
}

describe('NSFW Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /nsfw', () => {
    it('should return verified status for verified user', async () => {
      const verifiedAt = new Date('2024-01-15T10:00:00Z');
      // First findUnique: getOrCreateUserShell lookup by discordId.
      // Second findUnique: handler's own read by UUID for the NSFW fields.
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'test-uuid' }).mockResolvedValueOnce({
        nsfwVerified: true,
        nsfwVerifiedAt: verifiedAt,
      });

      const response = await request(app).get('/nsfw');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toEqual({
        nsfwVerified: true,
        nsfwVerifiedAt: verifiedAt.toISOString(),
      });
    });

    it('should return not verified for non-verified user', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'test-uuid' }).mockResolvedValueOnce({
        nsfwVerified: false,
        nsfwVerifiedAt: null,
      });

      const response = await request(app).get('/nsfw');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toEqual({
        nsfwVerified: false,
        nsfwVerifiedAt: null,
      });
    });

    it('should return not verified when user row missing after provisioning', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'test-uuid' })
        .mockResolvedValueOnce(null);

      const response = await request(app).get('/nsfw');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toEqual({
        nsfwVerified: false,
        nsfwVerifiedAt: null,
      });
    });
  });

  describe('POST /nsfw/verify', () => {
    it('should verify a new user', async () => {
      // Mock UserService.getOrCreateUser - first call returns existing user ID
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'test-uuid' }) // getOrCreateUser lookup
        .mockResolvedValueOnce({
          // findUnique for existing status check
          nsfwVerified: false,
          nsfwVerifiedAt: null,
        });
      mockPrisma.user.update.mockResolvedValue({
        nsfwVerified: true,
        nsfwVerifiedAt: new Date(),
      });

      const response = await request(app).post('/nsfw/verify');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body.nsfwVerified).toBe(true);
      expect(response.body.alreadyVerified).toBe(false);
      expect(response.body.nsfwVerifiedAt).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('should return already verified for previously verified user', async () => {
      const verifiedAt = new Date('2024-01-15T10:00:00Z');
      // Mock UserService.getOrCreateUser - first call returns existing user ID
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'test-uuid' }) // getOrCreateUser lookup
        .mockResolvedValueOnce({
          // findUnique for existing status check
          nsfwVerified: true,
          nsfwVerifiedAt: verifiedAt,
        });

      const response = await request(app).post('/nsfw/verify');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body).toEqual({
        nsfwVerified: true,
        nsfwVerifiedAt: verifiedAt.toISOString(),
        alreadyVerified: true,
      });
      // Should NOT call update since already verified
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
