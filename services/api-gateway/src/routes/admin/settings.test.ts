/**
 * Tests for Admin Settings Routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminSettingsRoutes } from './settings.js';
import type { PrismaClient } from '@tzurot/common-types';
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
const MOCK_SETTING_UUID = '550e8400-e29b-41d4-a716-446655440001';

function createMockPrisma(): {
  botSettings: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  user: {
    findFirst: ReturnType<typeof vi.fn>;
  };
} {
  return {
    botSettings: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  };
}

describe('Admin Settings Routes', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(true);

    mockPrisma = createMockPrisma();
    // Set default return values
    mockPrisma.user.findFirst.mockResolvedValue({ id: MOCK_USER_UUID });
    mockPrisma.botSettings.findMany.mockResolvedValue([]);
    mockPrisma.botSettings.findUnique.mockResolvedValue(null);
    mockPrisma.botSettings.upsert.mockResolvedValue({
      id: MOCK_SETTING_UUID,
      key: 'test',
      value: 'test',
      description: null,
      updatedBy: MOCK_USER_UUID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

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
    it('should list all settings', async () => {
      const mockSettings = [
        {
          id: MOCK_SETTING_UUID,
          key: 'extended_context_default',
          value: 'false',
          description: 'Default extended context setting',
          updatedBy: MOCK_USER_UUID,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
        },
      ];
      mockPrisma.botSettings.findMany.mockResolvedValue(mockSettings);

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body.settings).toHaveLength(1);
      expect(response.body.settings[0].key).toBe('extended_context_default');
      expect(response.body.settings[0].value).toBe('false');
    });

    it('should return empty array when no settings exist', async () => {
      mockPrisma.botSettings.findMany.mockResolvedValue([]);

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(200);
      expect(response.body.settings).toEqual([]);
    });

    it('should reject non-owners', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(app).get('/admin/settings');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /admin/settings/:key', () => {
    it('should get a specific setting', async () => {
      const mockSetting = {
        id: MOCK_SETTING_UUID,
        key: 'extended_context_default',
        value: 'true',
        description: 'Default extended context setting',
        updatedBy: MOCK_USER_UUID,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };
      mockPrisma.botSettings.findUnique.mockResolvedValue(mockSetting);

      const response = await request(app).get('/admin/settings/extended_context_default');

      expect(response.status).toBe(200);
      expect(response.body.found).toBe(true);
      expect(response.body.setting.key).toBe('extended_context_default');
      expect(response.body.setting.value).toBe('true');
    });

    it('should return found=false for non-existent setting', async () => {
      mockPrisma.botSettings.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/admin/settings/nonexistent');

      expect(response.status).toBe(200);
      expect(response.body.found).toBe(false);
      expect(response.body.setting).toBeUndefined();
    });

    it('should reject non-owners', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(app).get('/admin/settings/extended_context_default');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });
  });

  /**
   * CONTRACT TESTS
   *
   * These tests verify the API contract requirements:
   * - Admin settings routes require X-User-Id header for isBotOwner() check
   * - Without userId, requests should be rejected with 403
   *
   * This prevents the bug where bot-client's adminFetch() was not sending
   * the X-User-Id header, causing all admin settings requests to fail.
   */
  describe('CONTRACT: userId requirement', () => {
    let appWithoutUserId: express.Express;

    beforeEach(() => {
      // Create app WITHOUT userId middleware to test missing userId scenario
      appWithoutUserId = express();
      appWithoutUserId.use(express.json());
      // Intentionally NOT injecting userId - simulating adminFetch without X-User-Id
      appWithoutUserId.use(
        '/admin/settings',
        createAdminSettingsRoutes(mockPrisma as unknown as PrismaClient)
      );
    });

    it('should reject GET request without userId (isBotOwner check fails)', async () => {
      // When isBotOwner receives undefined, it should return false
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(appWithoutUserId).get('/admin/settings');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
      // Verify isBotOwner was called with undefined (missing userId)
      expect(mockIsBotOwner).toHaveBeenCalledWith(undefined);
    });

    it('should reject PUT request without userId', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(appWithoutUserId)
        .put('/admin/settings/extended_context_default')
        .send({ value: 'true' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
      expect(mockIsBotOwner).toHaveBeenCalledWith(undefined);
    });
  });

  describe('PUT /admin/settings/:key', () => {
    it('should create a new setting', async () => {
      const createdSetting = {
        id: MOCK_SETTING_UUID,
        key: 'extended_context_default',
        value: 'true',
        description: 'Default extended context setting',
        updatedBy: MOCK_USER_UUID,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      mockPrisma.botSettings.findUnique.mockResolvedValue(null); // Setting doesn't exist
      mockPrisma.botSettings.upsert.mockResolvedValue(createdSetting);

      const response = await request(app).put('/admin/settings/extended_context_default').send({
        value: 'true',
        description: 'Default extended context setting',
      });

      expect(response.status).toBe(201);
      expect(response.body.created).toBe(true);
      expect(response.body.setting.key).toBe('extended_context_default');
      expect(response.body.setting.value).toBe('true');
    });

    it('should update an existing setting', async () => {
      const existingSetting = {
        id: MOCK_SETTING_UUID,
        key: 'extended_context_default',
        value: 'false',
        description: 'Old description',
        updatedBy: MOCK_USER_UUID,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };
      const updatedSetting = {
        ...existingSetting,
        value: 'true',
        updatedAt: new Date('2024-01-02'),
      };
      mockPrisma.botSettings.findUnique.mockResolvedValue(existingSetting);
      mockPrisma.botSettings.upsert.mockResolvedValue(updatedSetting);

      const response = await request(app).put('/admin/settings/extended_context_default').send({
        value: 'true',
      });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(false);
      expect(response.body.setting.value).toBe('true');
    });

    it('should reject invalid request body', async () => {
      const response = await request(app).put('/admin/settings/extended_context_default').send({
        // Missing value field
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should reject non-owners', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const response = await request(app).put('/admin/settings/extended_context_default').send({
        value: 'true',
      });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });

    it('should return 404 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const response = await request(app).put('/admin/settings/extended_context_default').send({
        value: 'true',
      });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('NOT_FOUND');
    });
  });
});
