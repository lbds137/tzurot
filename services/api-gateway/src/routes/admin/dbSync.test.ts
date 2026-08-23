/**
 * Database Sync Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleDbSync } from './dbSync.js';
import type { RouteDeps } from '../routeDeps.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import { getOrCreateUserService } from '../../services/AuthMiddleware.js';

// Mock DatabaseSyncService
const mockSync = vi.fn();
vi.mock('../../services/DatabaseSyncService.js', () => ({
  DatabaseSyncService: class {
    sync = mockSync;
  },
}));

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest) so `getOrCreateUserService` is the real
// implementation — its WeakMap-keyed cache is what `clearCache()` targets.
vi.mock('../../services/AuthMiddleware.js');

// Mock PrismaClient and getConfig
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      ...actual.getConfig(),
      DEV_DATABASE_URL: 'postgresql://dev-url',
      PROD_DATABASE_URL: 'postgresql://prod-url',
    }),
  };
});

vi.mock('@tzurot/common-types/services/prisma', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/services/prisma')>(
    '@tzurot/common-types/services/prisma'
  );
  return {
    ...actual,
    PrismaClient: class MockPrismaClient {
      $connect = vi.fn().mockResolvedValue(undefined);
      $disconnect = vi.fn().mockResolvedValue(undefined);
    },
  };
});

/** The real `SyncResult` shape (`stats` keyed by table name). */
function makeSyncResult(
  overrides: Partial<{
    stats: Record<
      string,
      { devToProd: number; prodToDev: number; conflicts: number; deleted: number }
    >;
  }> = {}
): {
  schemaVersion: string;
  stats: Record<
    string,
    { devToProd: number; prodToDev: number; conflicts: number; deleted: number }
  >;
  warnings: string[];
  info: string[];
  deletions: never[];
  deletionsTruncated: boolean;
} {
  return {
    schemaVersion: 'v1',
    stats: {},
    warnings: [],
    info: [],
    deletions: [],
    deletionsTruncated: false,
    ...overrides,
  };
}

describe('POST /api/admin/db-sync', () => {
  let app: Express;
  let prismaAsClient: PrismaClient;

  /**
   * Stand-in for the broadcast half of the invalidation. `RouteDeps` types this
   * as the real `UserCacheInvalidationService`, so the cast keeps the seam
   * asserted without constructing a Redis-backed service.
   */
  function createUserCacheInvalidation(): { invalidateAll: ReturnType<typeof vi.fn> } {
    return { invalidateAll: vi.fn().mockResolvedValue(undefined) };
  }

  /** Same stand-in shape for the persona channel — the route only calls `invalidateAll`. */
  function createPersonaCacheInvalidation(): { invalidateAll: ReturnType<typeof vi.fn> } {
    return { invalidateAll: vi.fn().mockResolvedValue(undefined) };
  }

  function buildApp(
    userCacheInvalidation?: ReturnType<typeof createUserCacheInvalidation>,
    personaCacheInvalidation?: ReturnType<typeof createPersonaCacheInvalidation>
  ): Express {
    // A single stable `prisma` reference for the whole test, so the
    // `getOrCreateUserService` WeakMap registry keys line up between the
    // route's internal call and the test's spy.
    prismaAsClient = {} as PrismaClient;
    const deps = {
      prisma: prismaAsClient,
      ...stubRouteResolvers(),
      userCacheInvalidation: userCacheInvalidation as unknown as RouteDeps['userCacheInvalidation'],
      personaCacheInvalidation:
        personaCacheInvalidation as unknown as RouteDeps['personaCacheInvalidation'],
    } satisfies RouteDeps;
    const localApp = express();
    localApp.use(express.json());
    localApp.post('/admin/db-sync', handleDbSync(deps));
    return localApp;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it('should perform database sync successfully', async () => {
    mockSync.mockResolvedValue(
      makeSyncResult({
        stats: { personalities: { devToProd: 5, prodToDev: 10, conflicts: 0, deleted: 0 } },
      })
    );

    const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.schemaVersion).toBe('v1');
    expect(mockSync).toHaveBeenCalledWith({ dryRun: false, allowSchemaSkew: false });
  });

  it('should perform dry run when requested', async () => {
    mockSync.mockResolvedValue(makeSyncResult());

    const response = await request(app).post('/admin/db-sync').send({ dryRun: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockSync).toHaveBeenCalledWith({ dryRun: true, allowSchemaSkew: false });
  });

  it('should default to dryRun false when not specified', async () => {
    mockSync.mockResolvedValue(makeSyncResult());

    const response = await request(app).post('/admin/db-sync').send({});

    expect(response.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith({ dryRun: false, allowSchemaSkew: false });
  });

  it('should handle sync errors gracefully', async () => {
    mockSync.mockRejectedValue(new Error('Connection refused'));

    const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });

  describe('user-cache invalidation on a users-table write', () => {
    it('clears the local cache and broadcasts when the sync wrote to `users`', async () => {
      const userCacheInvalidation = createUserCacheInvalidation();
      app = buildApp(userCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { users: { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 } },
        })
      );
      const clearCacheSpy = vi.spyOn(getOrCreateUserService(prismaAsClient), 'clearCache');

      const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(response.status).toBe(200);
      expect(clearCacheSpy).toHaveBeenCalled();
      expect(userCacheInvalidation.invalidateAll).toHaveBeenCalled();
    });

    it('does nothing when `users` is untouched (absent from stats)', async () => {
      const userCacheInvalidation = createUserCacheInvalidation();
      app = buildApp(userCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { personalities: { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 } },
        })
      );
      const clearCacheSpy = vi.spyOn(getOrCreateUserService(prismaAsClient), 'clearCache');

      await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(clearCacheSpy).not.toHaveBeenCalled();
      expect(userCacheInvalidation.invalidateAll).not.toHaveBeenCalled();
    });

    it('does nothing when `users` stats are all-zero', async () => {
      const userCacheInvalidation = createUserCacheInvalidation();
      app = buildApp(userCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { users: { devToProd: 0, prodToDev: 0, conflicts: 3, deleted: 0 } },
        })
      );
      const clearCacheSpy = vi.spyOn(getOrCreateUserService(prismaAsClient), 'clearCache');

      await request(app).post('/admin/db-sync').send({ dryRun: false });

      // `conflicts` alone must NOT trip the write check — it's a resolution
      // counter, not a write count.
      expect(clearCacheSpy).not.toHaveBeenCalled();
      expect(userCacheInvalidation.invalidateAll).not.toHaveBeenCalled();
    });

    it('does nothing on a dry run even when `users` shows a nonzero count', async () => {
      const userCacheInvalidation = createUserCacheInvalidation();
      app = buildApp(userCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { users: { devToProd: 5, prodToDev: 0, conflicts: 0, deleted: 0 } },
        })
      );
      const clearCacheSpy = vi.spyOn(getOrCreateUserService(prismaAsClient), 'clearCache');

      await request(app).post('/admin/db-sync').send({ dryRun: true });

      expect(clearCacheSpy).not.toHaveBeenCalled();
      expect(userCacheInvalidation.invalidateAll).not.toHaveBeenCalled();
    });

    it('still returns 200 when the broadcast rejects', async () => {
      const userCacheInvalidation = createUserCacheInvalidation();
      userCacheInvalidation.invalidateAll.mockRejectedValue(new Error('redis down'));
      app = buildApp(userCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { users: { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 } },
        })
      );

      const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('persona-cache invalidation on a personas-table write', () => {
    it('broadcasts invalidate-all when the sync wrote to `personas`', async () => {
      const personaCacheInvalidation = createPersonaCacheInvalidation();
      app = buildApp(undefined, personaCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { personas: { devToProd: 2, prodToDev: 1, conflicts: 0, deleted: 0 } },
        })
      );

      const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(response.status).toBe(200);
      expect(personaCacheInvalidation.invalidateAll).toHaveBeenCalled();
    });

    it('broadcasts when only `user_personality_configs` was written (override reassignment)', async () => {
      // PersonaResolver reads the override table too — a sync that reconciles
      // only override assignments must still evict.
      const personaCacheInvalidation = createPersonaCacheInvalidation();
      app = buildApp(undefined, personaCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: {
            personas: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 },
            user_personality_configs: { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 },
          },
        })
      );

      const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(response.status).toBe(200);
      expect(personaCacheInvalidation.invalidateAll).toHaveBeenCalled();
    });

    it('broadcasts when only `users` was written — default_persona_id lives there', async () => {
      // The same field whose change makes the set-default route broadcast on
      // this channel can be rewritten by a users-row LWW sync.
      const personaCacheInvalidation = createPersonaCacheInvalidation();
      app = buildApp(undefined, personaCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: {
            users: { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 },
            personas: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 },
          },
        })
      );

      await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(personaCacheInvalidation.invalidateAll).toHaveBeenCalled();
    });

    it('does not broadcast when none of the persona-feeding tables were written', async () => {
      const personaCacheInvalidation = createPersonaCacheInvalidation();
      app = buildApp(undefined, personaCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: {
            personalities: { devToProd: 3, prodToDev: 0, conflicts: 0, deleted: 0 },
            personas: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 },
          },
        })
      );

      await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(personaCacheInvalidation.invalidateAll).not.toHaveBeenCalled();
    });

    it('does not broadcast on a dry run even when `personas` shows a nonzero count', async () => {
      const personaCacheInvalidation = createPersonaCacheInvalidation();
      app = buildApp(undefined, personaCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { personas: { devToProd: 3, prodToDev: 0, conflicts: 0, deleted: 0 } },
        })
      );

      await request(app).post('/admin/db-sync').send({ dryRun: true });

      expect(personaCacheInvalidation.invalidateAll).not.toHaveBeenCalled();
    });

    it('still returns 200 when the persona broadcast rejects', async () => {
      const personaCacheInvalidation = createPersonaCacheInvalidation();
      personaCacheInvalidation.invalidateAll.mockRejectedValue(new Error('redis down'));
      app = buildApp(undefined, personaCacheInvalidation);
      mockSync.mockResolvedValue(
        makeSyncResult({
          stats: { personas: { devToProd: 1, prodToDev: 0, conflicts: 0, deleted: 0 } },
        })
      );

      const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
