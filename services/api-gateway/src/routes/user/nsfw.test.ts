/**
 * NSFW Routes Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';
import { createNsfwRoutes } from './nsfw.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

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

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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
  // Mock auth middleware — sets req.userId AND the provisioned fields the
  // route handler reads via getOrCreateInternalUser / resolveProvisionedUserId.
  app.use((req, _res, next) => {
    (req as any).userId = '123456789012345678';
    (req as any).provisionedUserId = 'user-uuid-123';
    (req as any).provisionedDefaultPersonaId = 'persona-uuid-default';
    next();
  });
  app.use('/nsfw', createNsfwRoutes({ ...stubRouteResolvers(), prisma: mockPrisma as any }));
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
      mockPrisma.user.findUnique.mockResolvedValueOnce({
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
      mockPrisma.user.findUnique.mockResolvedValueOnce({
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
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

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
      mockPrisma.user.findUnique.mockResolvedValueOnce({
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
      mockPrisma.user.findUnique.mockResolvedValueOnce({
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

    it('should self-heal inconsistent state (verified=true with null timestamp)', async () => {
      // Invariant violation: verified flag set but no timestamp.
      // Per 03-database.md, this shouldn't exist, but defensively the handler
      // falls through to the re-verify path which writes a fresh timestamp.
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        nsfwVerified: true,
        nsfwVerifiedAt: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        nsfwVerified: true,
        nsfwVerifiedAt: new Date(),
      });

      const response = await request(app).post('/nsfw/verify');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.body.nsfwVerified).toBe(true);
      expect(response.body.alreadyVerified).toBe(false); // re-verified, not already
      expect(response.body.nsfwVerifiedAt).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });
  });
});
