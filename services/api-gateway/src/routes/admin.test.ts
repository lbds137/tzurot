/**
 * Admin Routes Tests
 * Tests for owner-only administrative endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createAdminRouter } from './admin.js';
import type { PrismaClient } from '@prisma/client';

// Mock DatabaseSyncService
const mockSync = vi.fn();
vi.mock('../services/DatabaseSyncService.js', () => ({
  DatabaseSyncService: class {
    sync = mockSync;
  },
}));

// Mock PrismaClient
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock getConfig to return database URLs
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getConfig: () => ({
      ...(actual as any).getConfig(),
      DEV_DATABASE_URL: 'postgresql://dev-url',
      PROD_DATABASE_URL: 'postgresql://prod-url',
    }),
  };
});

// Mock dependencies
vi.mock('../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (_req: unknown, _res: unknown, next: () => void) => {
    next(); // Bypass auth for testing
  },
}));
vi.mock('../utils/imageProcessor.js', () => ({
  optimizeAvatar: vi.fn().mockResolvedValue({
    buffer: Buffer.from('optimized-image-data'),
    originalSizeKB: 300,
    processedSizeKB: 150,
    quality: 85,
    exceedsTarget: false,
  }),
}));

// Create mock Prisma client
const createMockPrismaClient = () => ({
  personality: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  llmConfig: {
    findFirst: vi.fn(),
  },
  personalityDefaultConfig: {
    create: vi.fn(),
  },
});

// Create mock CacheInvalidationService
const createMockCacheInvalidationService = () => ({
  invalidatePersonality: vi.fn().mockResolvedValue(undefined),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
});

describe('Admin Routes', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;
  let cacheInvalidationService: ReturnType<typeof createMockCacheInvalidationService>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    prisma = createMockPrismaClient();

    // Create mock cache invalidation service
    cacheInvalidationService = createMockCacheInvalidationService();

    // Create Express app with admin router
    app = express();
    app.use(express.json());
    app.use(
      '/admin',
      createAdminRouter(prisma as unknown as PrismaClient, cacheInvalidationService as any)
    );
  });

  describe('POST /admin/personality', () => {
    it('should create a new personality with required fields', async () => {
      prisma.personality.findUnique.mockResolvedValue(null); // Slug doesn't exist
      prisma.personality.create.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly and knowledgeable',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null); // No default config

      const response = await request(app)
        .post('/admin/personality')
        .send({
          name: 'Test Bot',
          slug: 'test-bot',
          characterInfo: 'A helpful assistant',
          personalityTraits: 'Friendly and knowledgeable',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.personality).toMatchObject({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
      });
      expect(prisma.personality.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Test Bot',
          slug: 'test-bot',
          characterInfo: 'A helpful assistant',
          personalityTraits: 'Friendly and knowledgeable',
          voiceEnabled: false,
          imageEnabled: false,
        }),
      });
    });

    it('should reject creation with missing required fields', async () => {
      const response = await request(app)
        .post('/admin/personality')
        .send({
          name: 'Test Bot',
          // Missing slug, characterInfo, personalityTraits
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject creation with invalid slug format', async () => {
      const response = await request(app)
        .post('/admin/personality')
        .send({
          name: 'Test Bot',
          slug: 'Invalid Slug!', // Contains uppercase and special chars
          characterInfo: 'A helpful assistant',
          personalityTraits: 'Friendly',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject creation when slug already exists', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'existing-123',
        slug: 'test-bot',
      } as never);

      const response = await request(app)
        .post('/admin/personality')
        .send({
          name: 'Test Bot',
          slug: 'test-bot',
          characterInfo: 'A helpful assistant',
          personalityTraits: 'Friendly',
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('PATCH /admin/personality/:slug', () => {
    it('should update an existing personality', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Updated Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      const response = await request(app)
        .patch('/admin/personality/test-bot')
        .send({
          name: 'Updated Bot',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.personality.name).toBe('Updated Bot');
      expect(prisma.personality.update).toHaveBeenCalledWith({
        where: { slug: 'test-bot' },
        data: { name: 'Updated Bot' },
      });
    });

    it('should return 404 when personality does not exist', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .patch('/admin/personality/nonexistent')
        .send({
          name: 'Updated Bot',
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /admin/db-sync', () => {
    beforeEach(() => {
      mockSync.mockClear();
    });

    it('should perform database sync successfully', async () => {
      mockSync.mockResolvedValue({
        totalTables: 3,
        tablesProcessed: 3,
        totalRowsSynced: 150,
        changes: [
          { table: 'personalities', inserted: 5, updated: 10, deleted: 0 },
          { table: 'llm_configs', inserted: 2, updated: 1, deleted: 0 },
        ],
      });

      const response = await request(app)
        .post('/admin/db-sync')
        .send({ dryRun: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.totalTables).toBe(3);
      expect(response.body.totalRowsSynced).toBe(150);
      expect(mockSync).toHaveBeenCalledWith({ dryRun: false });
    });

    it('should perform dry run when requested', async () => {
      mockSync.mockResolvedValue({
        totalTables: 3,
        tablesProcessed: 3,
        totalRowsSynced: 0,
        changes: [],
        dryRun: true,
      });

      const response = await request(app)
        .post('/admin/db-sync')
        .send({ dryRun: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.dryRun).toBe(true);
      expect(mockSync).toHaveBeenCalledWith({ dryRun: true });
    });

    it('should default to dryRun false when not specified', async () => {
      mockSync.mockResolvedValue({
        totalTables: 0,
        tablesProcessed: 0,
        totalRowsSynced: 0,
        changes: [],
      });

      const response = await request(app)
        .post('/admin/db-sync')
        .send({});

      expect(response.status).toBe(200);
      expect(mockSync).toHaveBeenCalledWith({ dryRun: false });
    });

    it('should handle sync errors gracefully', async () => {
      mockSync.mockRejectedValue(new Error('Connection refused'));

      const response = await request(app)
        .post('/admin/db-sync')
        .send({ dryRun: false });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });
  });
});
