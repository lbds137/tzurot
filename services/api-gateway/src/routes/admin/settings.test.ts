/**
 * Tests for Admin Settings Routes (Singleton Pattern)
 *
 * AdminSettings uses a singleton pattern with a fixed UUID.
 * GET /admin/settings - Returns the singleton
 * PATCH /admin/settings - Updates the singleton
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminSettingsRoutes } from './settings.js';
import { ADMIN_SETTINGS_SINGLETON_ID, type PrismaClient } from '@tzurot/common-types';
import express from 'express';
import request from 'supertest';

// Mock isBotOwner - must be before vi.mock to be hoisted
const mockIsBotOwner = vi.fn().mockReturnValue(true);

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner: (...args: unknown[]) => mockIsBotOwner(...args),
  };
});

// Mock user ID middleware
const MOCK_USER_ID = 'owner-discord-id';
const MOCK_USER_UUID = '550e8400-e29b-41d4-a716-446655440000';

function createMockPrisma(): {
  adminSettings: {
    upsert: ReturnType<typeof vi.fn>;
  };
  user: {
    findFirst: ReturnType<typeof vi.fn>;
  };
} {
  return {
    adminSettings: {
      upsert: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  };
}

function createDefaultSettings(overrides: Partial<{
  id: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  extendedContextDefault: boolean;
  extendedContextMaxMessages: number;
  extendedContextMaxAge: number | null;
  extendedContextMaxImages: number;
}> = {}) {
  return {
    id: ADMIN_SETTINGS_SINGLETON_ID,
    updatedBy: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    extendedContextDefault: false,
    extendedContextMaxMessages: 20,
    extendedContextMaxAge: null,
    extendedContextMaxImages: 10,
    ...overrides,
  };
}

describe('Admin Settings Routes (Singleton)', () => {
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
    // Add middleware to inject userId
    app.use((req, _res, next) => {
      (req as express.Request & { userId: string }).userId = MOCK_USER_ID;
      next();
    });
    app.use('/admin/settings', createAdminSettingsRoutes(mockPrisma as unknown as PrismaClient));
    // Add error handler
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: err.message, stack: err.stack });
      }
    );
  });

  describe('GET /admin/settings', () => {
    it('should return the AdminSettings singleton', async () => {
      const settings = createDefaultSettings({
        extendedContextDefault: true,
        extendedContextMaxMessages: 50,
      });
      mockPrisma.adminSettings.upsert.mockResolvedValue(settings);

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(ADMIN_SETTINGS_SINGLETON_ID);
      expect(response.body.extendedContextDefault).toBe(true);
      expect(response.body.extendedContextMaxMessages).toBe(50);
      expect(response.body.extendedContextMaxAge).toBeNull();
      expect(response.body.extendedContextMaxImages).toBe(10);
    });

    it('should create singleton with defaults if not exists', async () => {
      // upsert creates with defaults if not exists
      mockPrisma.adminSettings.upsert.mockResolvedValue(createDefaultSettings());

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body.extendedContextDefault).toBe(false);
      expect(response.body.extendedContextMaxMessages).toBe(20);

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

  describe('PATCH /admin/settings', () => {
    it('should update extendedContextDefault', async () => {
      const updatedSettings = createDefaultSettings({
        extendedContextDefault: true,
        updatedBy: MOCK_USER_UUID,
        updatedAt: new Date('2024-01-02'),
      });
      mockPrisma.adminSettings.upsert.mockResolvedValue(updatedSettings);

      const response = await request(app)
        .patch('/admin/settings')
        .send({ extendedContextDefault: true });

      expect(response.status).toBe(200);
      expect(response.body.extendedContextDefault).toBe(true);
      expect(response.body.updatedBy).toBe(MOCK_USER_UUID);
    });

    it('should update extendedContextMaxMessages', async () => {
      const updatedSettings = createDefaultSettings({
        extendedContextMaxMessages: 50,
        updatedBy: MOCK_USER_UUID,
      });
      mockPrisma.adminSettings.upsert.mockResolvedValue(updatedSettings);

      const response = await request(app)
        .patch('/admin/settings')
        .send({ extendedContextMaxMessages: 50 });

      expect(response.status).toBe(200);
      expect(response.body.extendedContextMaxMessages).toBe(50);
    });

    it('should update extendedContextMaxAge', async () => {
      const updatedSettings = createDefaultSettings({
        extendedContextMaxAge: 3600,
        updatedBy: MOCK_USER_UUID,
      });
      mockPrisma.adminSettings.upsert.mockResolvedValue(updatedSettings);

      const response = await request(app)
        .patch('/admin/settings')
        .send({ extendedContextMaxAge: 3600 });

      expect(response.status).toBe(200);
      expect(response.body.extendedContextMaxAge).toBe(3600);
    });

    it('should update multiple fields at once', async () => {
      const updatedSettings = createDefaultSettings({
        extendedContextDefault: true,
        extendedContextMaxMessages: 100,
        extendedContextMaxAge: 7200,
        extendedContextMaxImages: 15,
        updatedBy: MOCK_USER_UUID,
      });
      mockPrisma.adminSettings.upsert.mockResolvedValue(updatedSettings);

      const response = await request(app).patch('/admin/settings').send({
        extendedContextDefault: true,
        extendedContextMaxMessages: 100,
        extendedContextMaxAge: 7200,
        extendedContextMaxImages: 15,
      });

      expect(response.status).toBe(200);
      expect(response.body.extendedContextDefault).toBe(true);
      expect(response.body.extendedContextMaxMessages).toBe(100);
      expect(response.body.extendedContextMaxAge).toBe(7200);
      expect(response.body.extendedContextMaxImages).toBe(15);
    });

    it('should reject empty update body', async () => {
      const response = await request(app).patch('/admin/settings').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid field values', async () => {
      const response = await request(app)
        .patch('/admin/settings')
        .send({ extendedContextMaxMessages: 200 }); // Exceeds max of 100

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject non-owners', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(app)
        .patch('/admin/settings')
        .send({ extendedContextDefault: true });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .patch('/admin/settings')
        .send({ extendedContextDefault: true });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('NOT_FOUND');
    });
  });

  /**
   * CONTRACT TESTS
   *
   * These tests verify the API contract requirements:
   * - GET without userId: allowed (service-only operation, e.g., bot reading settings)
   * - GET with userId: requires bot owner (user-initiated)
   * - PATCH always requires userId + bot owner
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
        createAdminSettingsRoutes(mockPrisma as unknown as PrismaClient)
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

    it('should reject PATCH request without userId (modifications require owner)', async () => {
      const response = await request(appWithoutUserId)
        .patch('/admin/settings')
        .send({ extendedContextDefault: true });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
      // isAuthorizedForWrite short-circuits on undefined userId
      expect(mockIsBotOwner).not.toHaveBeenCalled();
    });
  });
});
