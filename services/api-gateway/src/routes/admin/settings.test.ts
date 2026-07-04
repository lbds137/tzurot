/**
 * Tests for Admin Settings Routes (Singleton Pattern)
 *
 * AdminSettings uses a singleton pattern with a fixed UUID.
 * GET /admin/settings - Returns the singleton
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminSettingsRoutes } from './settings.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import express from 'express';
import request from 'supertest';
import { getAllRoutes } from '../../test/expressRouterUtils.js';

// Mock isBotOwner - must be before vi.mock to be hoisted
const mockIsBotOwner = vi.fn().mockReturnValue(true);

// Mock dependencies
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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (...args: unknown[]) => mockIsBotOwner(...args),
  };
});

// Mock AuthMiddleware so requireOwnerAuth() routes through the same
// mockIsBotOwner that the inline isAuthorizedForRead path uses. Without
// this, requireOwnerAuth would call the real isValidOwner -> config check
// (which has no BOT_OWNER_ID in .env.test), failing all PATCH/DELETE tests.
// isAuthorizedForRead stays real because GET / still uses it inline (the
// service-only path can't migrate to middleware).
vi.mock('../../services/AuthMiddleware.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/AuthMiddleware.js')>();
  return {
    ...actual,
    requireOwnerAuth:
      () =>
      (
        req: { userId?: string },
        res: { status: (n: number) => { json: (b: unknown) => void } },
        next: () => void
      ): void => {
        if (mockIsBotOwner(req.userId)) {
          next();
        } else {
          res
            .status(403)
            .json({ error: 'UNAUTHORIZED', message: 'Only bot owners can modify this' });
        }
      },
  };
});

// Mock user ID middleware
const MOCK_USER_ID = 'owner-discord-id';
const MOCK_USER_UUID = '550e8400-e29b-41d4-a716-446655440000';

function createMockPrisma(): {
  adminSettings: {
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: {
    findFirst: ReturnType<typeof vi.fn>;
  };
} {
  return {
    adminSettings: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  };
}

function createDefaultSettings(
  overrides: Partial<{
    id: string;
    updatedBy: string | null;
    configDefaults: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: ADMIN_SETTINGS_SINGLETON_ID,
    updatedBy: null,
    configDefaults: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('Admin Settings Routes (Singleton)', () => {
  describe('middleware composition', () => {
    it('GET / stays inline-auth (service-only allowed); PATCH/DELETE use middleware', () => {
      // settings.ts has a mixed auth shape: GET supports service-only calls
      // (bot-client hydrates admin settings at startup with no userId), so it
      // can't migrate to requireOwnerAuth() middleware. PATCH and DELETE are
      // owner-only writes — they got the standard requireOwnerAuth middleware
      // in this PR. Lock the asymmetry in by asserting the resulting stack
      // lengths.
      const router = createAdminSettingsRoutes({
        prisma: createMockPrisma() as unknown as PrismaClient,
      });
      const routes = getAllRoutes(router);
      const byPath = new Map(routes.map(r => [`${r.methods[0]} ${r.path}`, r]));
      expect(byPath.get('get /')?.stackLength, 'GET / must stay inline-auth (1 handler)').toBe(1);
      expect(
        byPath.get('patch /config-defaults')?.stackLength,
        'PATCH /config-defaults must use requireOwnerAuth middleware'
      ).toBeGreaterThanOrEqual(2);
      expect(
        byPath.get('delete /config-defaults')?.stackLength,
        'DELETE /config-defaults must use requireOwnerAuth middleware'
      ).toBeGreaterThanOrEqual(2);
    });
  });

  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(true);

    mockPrisma = createMockPrisma();
    // Set default return values
    mockPrisma.user.findFirst.mockResolvedValue({ id: MOCK_USER_UUID });
    mockPrisma.adminSettings.upsert.mockResolvedValue(createDefaultSettings());

    app = express();
    app.use(express.json());
    // Inject userId and X-User-Id header. PATCH/DELETE use requireOwnerAuth(),
    // which reads ownerId via extractOwnerId() from the X-User-Id header.
    // GET still consults req.userId via the inline isAuthorizedForRead check.
    app.use((req, _res, next) => {
      (req as express.Request & { userId: string }).userId = MOCK_USER_ID;
      req.headers['x-user-id'] = MOCK_USER_ID;
      next();
    });
    app.use(
      '/admin/settings',
      createAdminSettingsRoutes({ prisma: mockPrisma as unknown as PrismaClient })
    );
    // Add error handler
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: err.message, stack: err.stack });
      }
    );
  });

  describe('GET /admin/settings', () => {
    it('should return the AdminSettings singleton', async () => {
      const settings = createDefaultSettings();
      mockPrisma.adminSettings.upsert.mockResolvedValue(settings);

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(ADMIN_SETTINGS_SINGLETON_ID);
    });

    it('should create singleton with defaults if not exists', async () => {
      // upsert creates with defaults if not exists
      mockPrisma.adminSettings.upsert.mockResolvedValue(createDefaultSettings());

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(200);

      // Verify upsert was called with singleton ID
      expect(mockPrisma.adminSettings.upsert).toHaveBeenCalledWith({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        create: { id: ADMIN_SETTINGS_SINGLETON_ID },
        update: {},
      });
    });

    it('should reject non-owners when userId is provided', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });
  });

  /**
   * CONTRACT TESTS
   *
   * These tests verify the API contract requirements:
   * - GET without userId: allowed (service-only operation, e.g., bot reading settings)
   * - GET with userId: requires bot owner (user-initiated)
   */
  describe('CONTRACT: userId requirement', () => {
    let appWithoutUserId: express.Express;

    beforeEach(() => {
      // Create app WITHOUT userId middleware to test service-only scenario
      appWithoutUserId = express();
      appWithoutUserId.use(express.json());
      // Intentionally NOT injecting userId - simulating internal service call
      appWithoutUserId.use(
        '/admin/settings',
        createAdminSettingsRoutes({ prisma: mockPrisma as unknown as PrismaClient })
      );
    });

    it('should allow GET request without userId (service-only operation)', async () => {
      // Service-only operation - no userId means no isBotOwner check needed
      mockPrisma.adminSettings.upsert.mockResolvedValue(createDefaultSettings());

      const response = await request(appWithoutUserId).get('/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(ADMIN_SETTINGS_SINGLETON_ID);
      // isBotOwner should NOT be called for service-only operations
      expect(mockIsBotOwner).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /admin/settings/config-defaults', () => {
    it('should accept flat body and update configDefaults', async () => {
      const updatedSettings = createDefaultSettings({
        configDefaults: { maxMessages: 42 },
        updatedBy: MOCK_USER_UUID,
      });
      mockPrisma.adminSettings.update.mockResolvedValue(updatedSettings);

      const response = await request(app)
        .patch('/admin/settings/config-defaults')
        .send({ maxMessages: 42 });

      expect(response.status).toBe(200);
      expect(response.body.configDefaults).toEqual({ maxMessages: 42 });
    });

    it('should reject non-owners', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(app)
        .patch('/admin/settings/config-defaults')
        .send({ maxMessages: 30 });

      expect(response.status).toBe(403);
    });

    it('should reject invalid config format', async () => {
      const response = await request(app)
        .patch('/admin/settings/config-defaults')
        .send({ maxMessages: 'not-a-number' });

      expect(response.status).toBe(400);
    });

    it('should merge with existing configDefaults', async () => {
      mockPrisma.adminSettings.upsert.mockResolvedValue(
        createDefaultSettings({ configDefaults: { maxImages: 5 } })
      );

      const updatedSettings = createDefaultSettings({
        configDefaults: { maxImages: 5, maxMessages: 30 },
        updatedBy: MOCK_USER_UUID,
      });
      mockPrisma.adminSettings.update.mockResolvedValue(updatedSettings);

      const response = await request(app)
        .patch('/admin/settings/config-defaults')
        .send({ maxMessages: 30 });

      expect(response.status).toBe(200);
      expect(response.body.configDefaults).toEqual({ maxImages: 5, maxMessages: 30 });
    });

    it('should set updatedBy on update', async () => {
      const updatedSettings = createDefaultSettings({
        configDefaults: { maxMessages: 30 },
        updatedBy: MOCK_USER_UUID,
      });
      mockPrisma.adminSettings.update.mockResolvedValue(updatedSettings);

      const response = await request(app)
        .patch('/admin/settings/config-defaults')
        .send({ maxMessages: 30 });

      expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            updatedBy: MOCK_USER_UUID,
          }),
        })
      );
      expect(response.status).toBe(200);
    });

    it('should swallow cascade invalidation errors', async () => {
      const mockInvalidation = {
        invalidateAdmin: vi.fn().mockRejectedValue(new Error('Redis down')),
      };

      const appWithInvalidation = express();
      appWithInvalidation.use(express.json());
      appWithInvalidation.use((req, _res, next) => {
        (req as express.Request & { userId: string }).userId = MOCK_USER_ID;
        next();
      });
      appWithInvalidation.use(
        '/admin/settings',
        createAdminSettingsRoutes({
          prisma: mockPrisma as unknown as PrismaClient,
          cascadeInvalidation: mockInvalidation as never,
        })
      );

      const updatedSettings = createDefaultSettings({
        configDefaults: { maxMessages: 30 },
        updatedBy: MOCK_USER_UUID,
      });
      mockPrisma.adminSettings.update.mockResolvedValue(updatedSettings);

      const response = await request(appWithInvalidation)
        .patch('/admin/settings/config-defaults')
        .send({ maxMessages: 30 });

      expect(response.status).toBe(200);
      expect(mockInvalidation.invalidateAdmin).toHaveBeenCalled();
    });
  });

  describe('DELETE /admin/settings/config-defaults', () => {
    it('should clear configDefaults and return success', async () => {
      mockPrisma.adminSettings.update.mockResolvedValue(
        createDefaultSettings({ configDefaults: null, updatedBy: MOCK_USER_UUID })
      );

      const response = await request(app).delete('/admin/settings/config-defaults');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            configDefaults: expect.anything(), // Prisma.JsonNull
            updatedBy: MOCK_USER_UUID,
          }),
        })
      );
    });

    it('should reject non-owners', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(app).delete('/admin/settings/config-defaults');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });

    it('should ensure singleton exists before clearing', async () => {
      mockPrisma.adminSettings.update.mockResolvedValue(createDefaultSettings());

      await request(app).delete('/admin/settings/config-defaults');

      // upsert is called first (getOrCreateSettings), then update
      expect(mockPrisma.adminSettings.upsert).toHaveBeenCalledBefore(
        mockPrisma.adminSettings.update
      );
    });

    it('should trigger cascade invalidation', async () => {
      const mockInvalidation = {
        invalidateAdmin: vi.fn().mockResolvedValue(undefined),
      };

      const appWithInvalidation = express();
      appWithInvalidation.use(express.json());
      appWithInvalidation.use((req, _res, next) => {
        (req as express.Request & { userId: string }).userId = MOCK_USER_ID;
        next();
      });
      appWithInvalidation.use(
        '/admin/settings',
        createAdminSettingsRoutes({
          prisma: mockPrisma as unknown as PrismaClient,
          cascadeInvalidation: mockInvalidation as never,
        })
      );

      mockPrisma.adminSettings.update.mockResolvedValue(createDefaultSettings());

      const response = await request(appWithInvalidation).delete('/admin/settings/config-defaults');

      expect(response.status).toBe(200);
      expect(mockInvalidation.invalidateAdmin).toHaveBeenCalled();
    });
  });
});
