/**
 * Denylist Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import {
  handleAddDenylistEntry,
  handleGetDenylistCache,
  handleListDenylistEntries,
  handleRemoveDenylistEntry,
} from './denylist.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../routeDeps.js';

// Mock AuthMiddleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  extractOwnerId: () => '999999999999999999',
}));

// Mock isBotOwner
vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (id: string) => id === '999999999999999999',
  };
});

const createMockPrisma = () => ({
  denylistedEntity: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({
      id: 'test-uuid',
      type: 'USER',
      discordId: '123456789012345678',
      scope: 'BOT',
      scopeId: '*',
      mode: 'BLOCK',
      reason: null,
      addedBy: '999999999999999999',
      addedAt: new Date(),
    }),
    delete: vi.fn().mockResolvedValue({}),
  },
});

const createMockDenylistInvalidation = () => ({
  publishAdd: vi.fn().mockResolvedValue(undefined),
  publishRemove: vi.fn().mockResolvedValue(undefined),
  publishReloadAll: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
});

/**
 * Register the four denylist handlers on the paths
 * `routes/_generated/mounts.ts` mounts them at. Auth composition
 * (`requireUserAuth` + `requireOwnerAuth` on the three admin routes, none on
 * the service-only `/cache` hydration endpoint) is owned by the generated
 * mounts and pinned by `mounts.component.test.ts` plus the conformance
 * fixtures, so these suites exercise the handlers themselves.
 */
function mountDenylistRoutes(app: Express, deps: RouteDeps): void {
  app.get('/api/admin/denylist', handleListDenylistEntries(deps));
  app.get('/api/internal/denylist/cache', handleGetDenylistCache(deps));
  app.post('/api/admin/denylist', handleAddDenylistEntry(deps));
  app.delete(
    '/api/admin/denylist/:type/:discordId/:scope/:scopeId',
    handleRemoveDenylistEntry(deps)
  );
}

describe('Denylist Admin Routes', () => {
  let app: Express;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockInvalidation: ReturnType<typeof createMockDenylistInvalidation>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    mockInvalidation = createMockDenylistInvalidation();

    app = express();
    app.use(express.json());
    mountDenylistRoutes(app, {
      ...stubRouteResolvers(),
      prisma: mockPrisma as never,
      denylistInvalidation: mockInvalidation as never,
    });
  });

  describe('GET /api/admin/denylist', () => {
    it('should list all entries', async () => {
      const response = await request(app).get('/api/admin/denylist');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.entries).toEqual([]);
      expect(mockPrisma.denylistedEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      );
    });

    it('should filter by type', async () => {
      await request(app).get('/api/admin/denylist?type=USER');

      expect(mockPrisma.denylistedEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { type: 'USER' } })
      );
    });

    it('should reject invalid type filter', async () => {
      const response = await request(app).get('/api/admin/denylist?type=INVALID');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid type filter');
      expect(mockPrisma.denylistedEntity.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/internal/denylist/cache', () => {
    it('should return all entries for hydration', async () => {
      const response = await request(app).get('/api/internal/denylist/cache');

      expect(response.status).toBe(200);
      expect(response.body.entries).toEqual([]);
      expect(mockPrisma.denylistedEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10_000 })
      );
    });
  });

  describe('POST /api/admin/denylist', () => {
    it('should add a USER + BOT entry', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'USER',
        discordId: '123456789012345678',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.entry).toBeDefined();
      expect(mockPrisma.denylistedEntity.upsert).toHaveBeenCalled();
      expect(mockInvalidation.publishAdd).toHaveBeenCalled();
    });

    it('should add a USER + CHANNEL entry', async () => {
      mockPrisma.denylistedEntity.upsert.mockResolvedValue({
        id: 'test-uuid',
        type: 'USER',
        discordId: '123456789012345678',
        scope: 'CHANNEL',
        scopeId: '987654321',
        mode: 'BLOCK',
        reason: null,
        addedBy: '999999999999999999',
        addedAt: new Date(),
      });

      const response = await request(app).post('/api/admin/denylist').send({
        type: 'USER',
        discordId: '123456789012345678',
        scope: 'CHANNEL',
        scopeId: '987654321',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should add a GUILD + BOT entry', async () => {
      mockPrisma.denylistedEntity.upsert.mockResolvedValue({
        id: 'test-uuid',
        type: 'GUILD',
        discordId: '123456789012345678',
        scope: 'BOT',
        scopeId: '*',
        mode: 'BLOCK',
        reason: null,
        addedBy: '999999999999999999',
        addedAt: new Date(),
      });

      const response = await request(app).post('/api/admin/denylist').send({
        type: 'GUILD',
        discordId: '123456789012345678',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should pass mode through to upsert and publish', async () => {
      mockPrisma.denylistedEntity.upsert.mockResolvedValue({
        id: 'test-uuid',
        type: 'USER',
        discordId: '123456789012345678',
        scope: 'BOT',
        scopeId: '*',
        mode: 'MUTE',
        reason: null,
        addedBy: '999999999999999999',
        addedAt: new Date(),
      });

      const response = await request(app).post('/api/admin/denylist').send({
        type: 'USER',
        discordId: '123456789012345678',
        mode: 'MUTE',
      });

      expect(response.status).toBe(200);
      expect(mockPrisma.denylistedEntity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ mode: 'MUTE' }),
          update: expect.objectContaining({ mode: 'MUTE' }),
        })
      );
      expect(mockInvalidation.publishAdd).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'MUTE' })
      );
    });

    it('should default mode to BLOCK', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'USER',
        discordId: '123456789012345678',
      });

      expect(response.status).toBe(200);
      expect(mockPrisma.denylistedEntity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ mode: 'BLOCK' }),
        })
      );
    });

    it('should reject denying the bot owner', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'USER',
        discordId: '999999999999999999',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('bot owner');
      expect(mockPrisma.denylistedEntity.upsert).not.toHaveBeenCalled();
    });

    it('should reject GUILD with CHANNEL scope', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'GUILD',
        discordId: '123456789012345678',
        scope: 'CHANNEL',
        scopeId: '987654321',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('GUILD type only supports BOT scope');
    });

    it('should reject GUILD with PERSONALITY scope', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'GUILD',
        discordId: '123456789012345678',
        scope: 'PERSONALITY',
        scopeId: 'some-id',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('GUILD type only supports BOT scope');
    });

    it('should reject BOT scope with non-wildcard scopeId', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'USER',
        discordId: '123456789012345678',
        scope: 'BOT',
        scopeId: 'not-wildcard',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('scopeId to be "*"');
    });

    it('should reject CHANNEL scope with wildcard scopeId', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'USER',
        discordId: '123456789012345678',
        scope: 'CHANNEL',
        scopeId: '*',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('requires a specific scopeId');
    });

    it('should reject invalid input', async () => {
      const response = await request(app).post('/api/admin/denylist').send({
        type: 'INVALID',
        discordId: '',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/admin/denylist/:type/:discordId/:scope/:scopeId', () => {
    it('should remove an existing entry', async () => {
      mockPrisma.denylistedEntity.findUnique.mockResolvedValue({
        id: 'test-uuid',
        type: 'USER',
        discordId: '123456789012345678',
        scope: 'BOT',
        scopeId: '*',
        mode: 'BLOCK',
      });

      const response = await request(app).delete(
        '/api/admin/denylist/USER/123456789012345678/BOT/*'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.removed).toBe(true);
      expect(mockPrisma.denylistedEntity.delete).toHaveBeenCalledWith({
        where: { id: 'test-uuid' },
      });
      expect(mockInvalidation.publishRemove).toHaveBeenCalled();
    });

    it('should return 404 for non-existent entry', async () => {
      mockPrisma.denylistedEntity.findUnique.mockResolvedValue(null);

      const response = await request(app).delete(
        '/api/admin/denylist/USER/123456789012345678/BOT/*'
      );

      expect(response.status).toBe(404);
      expect(mockPrisma.denylistedEntity.delete).not.toHaveBeenCalled();
    });

    it('should reject invalid type param', async () => {
      const response = await request(app).delete(
        '/api/admin/denylist/INVALID/123456789012345678/BOT/*'
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid type');
      expect(mockPrisma.denylistedEntity.findUnique).not.toHaveBeenCalled();
    });

    it('should reject invalid scope param', async () => {
      const response = await request(app).delete(
        '/api/admin/denylist/USER/123456789012345678/INVALID/*'
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid scope');
      expect(mockPrisma.denylistedEntity.findUnique).not.toHaveBeenCalled();
    });
  });
});
