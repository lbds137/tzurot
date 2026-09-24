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
import { DB_SYNC_SINGLE_FLIGHT_KEY } from '../../services/sync/dbSyncSingleFlight.js';

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
  describe('db-sync single-flight guard', () => {
    it('refuses a second concurrent request with 409 DB_SYNC_IN_PROGRESS while the first is still running', async () => {
      let resolveSync: (value: unknown) => void = () => {
        /* replaced below */
      };
      const pending = new Promise(resolve => {
        resolveSync = resolve;
      });
      mockSync.mockReturnValueOnce(pending);

      // supertest's Test is lazy — building it does not dispatch until
      // something awaits/.then()s it, so `.then()` is what fires it here.
      let firstStatus = -1;
      const firstRequest = request(app)
        .post('/admin/db-sync')
        .send({ dryRun: false })
        .then(res => {
          firstStatus = res.status;
        });

      await vi.waitFor(() => {
        if (mockSync.mock.calls.length === 0) {
          throw new Error('first request has not reached mockSync yet');
        }
      });

      const secondResponse = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body.code).toBe('DB_SYNC_IN_PROGRESS');
      expect(mockSync).toHaveBeenCalledTimes(1);

      resolveSync(makeSyncResult());
      await firstRequest;
      expect(firstStatus).toBe(200);
    });

    it('releases the guard after a successful sync — a follow-up request syncs', async () => {
      mockSync.mockResolvedValue(makeSyncResult());

      const first = await request(app).post('/admin/db-sync').send({ dryRun: false });
      const second = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(mockSync).toHaveBeenCalledTimes(2);
    });

    it('releases the guard after a failed sync — a follow-up request syncs', async () => {
      mockSync.mockRejectedValueOnce(new Error('boom'));
      mockSync.mockResolvedValueOnce(makeSyncResult());
      const first = await request(app).post('/admin/db-sync').send({ dryRun: false });
      const second = await request(app).post('/admin/db-sync').send({ dryRun: false });
      expect(first.status).toBe(500);
      expect(second.status).toBe(200);
      expect(mockSync).toHaveBeenCalledTimes(2);
    });
    it('503s when deps.redis is undefined, without calling sync', async () => {
      app = buildApp(undefined, undefined, null);

      const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(response.status).toBe(503);
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('a dry run with no Redis configured answers 200 and still syncs', async () => {
      app = buildApp(undefined, undefined, null);
      mockSync.mockResolvedValue(makeSyncResult());

      const response = await request(app).post('/admin/db-sync').send({ dryRun: true });

      expect(response.status).toBe(200);
      expect(mockSync).toHaveBeenCalledWith({ dryRun: true, allowSchemaSkew: false });
    });

    it('503s when redis.set rejects, without calling sync', async () => {
      const brokenRedis = {
        set: vi.fn().mockRejectedValue(new Error('connection reset')),
        get: vi.fn(),
        del: vi.fn(),
      } as unknown as RouteDeps['redis'];
      app = buildApp(undefined, undefined, brokenRedis);

      const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

      expect(response.status).toBe(503);
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('a dry run proceeds and answers 200 while the guard is held by another sync — the held key is untouched', async () => {
      // `createWorkingRedis` returns `RouteDeps['redis']` (`Redis | undefined`)
      // to match the fixture's own declared type, but the factory always
      // constructs a real double — narrow it so this test can seed/read it
      // directly, the way it would a live Redis instance under test.
      const redis = createWorkingRedis() as NonNullable<RouteDeps['redis']>;
      // Seed the guard as already held, mirroring "another token stored in
      // the double" — the dry run below must neither read nor clear it.
      await redis.set(DB_SYNC_SINGLE_FLIGHT_KEY, 'held-by-another-sync', 'PX', 1_800_000, 'NX');
      const setCallsBeforeDryRun = (redis.set as ReturnType<typeof vi.fn>).mock.calls.length;
      app = buildApp(undefined, undefined, redis);
      mockSync.mockResolvedValue(makeSyncResult());

      const response = await request(app).post('/admin/db-sync').send({ dryRun: true });

      expect(response.status).toBe(200);
      expect(mockSync).toHaveBeenCalledWith({ dryRun: true, allowSchemaSkew: false });
      // No new `set` call from the dry run itself.
      expect((redis.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCallsBeforeDryRun);
      expect(redis.del as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
      await expect(redis.get(DB_SYNC_SINGLE_FLIGHT_KEY)).resolves.toBe('held-by-another-sync');
    });

    it('a dry run with the guard free never writes the key: no `set` call on the Redis double', async () => {
      const redis = createWorkingRedis() as NonNullable<RouteDeps['redis']>;
      app = buildApp(undefined, undefined, redis);
      mockSync.mockResolvedValue(makeSyncResult());

      const response = await request(app).post('/admin/db-sync').send({ dryRun: true });

      expect(response.status).toBe(200);
      expect(redis.set as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    });
  });

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

  /**
   * A working single-flight-capable Redis double for `deps.redis` —
   * SET-PX-NX / GET / DEL over one in-memory slot, honoring the guard's
   * contract. Every existing test gets a fresh one by default so the new
   * guard never blocks a pre-existing assertion.
   */
  function createWorkingRedis(): RouteDeps['redis'] {
    let value: string | null = null;
    return {
      set: vi.fn(async (_key: string, val: string) => {
        if (value !== null) {
          return null;
        }
        value = val;
        return 'OK';
      }),
      get: vi.fn(async () => value),
      del: vi.fn(async () => {
        value = null;
        return 1;
      }),
    } as unknown as RouteDeps['redis'];
  }

  function buildApp(
    userCacheInvalidation?: ReturnType<typeof createUserCacheInvalidation>,
    personaCacheInvalidation?: ReturnType<typeof createPersonaCacheInvalidation>,
    // `null` (not the default `undefined`) means "no redis" — JS default
    // params only kick in on an omitted/undefined argument, so a caller that
    // wants `deps.redis` unset must pass `null` explicitly.
    redis: RouteDeps['redis'] | null = createWorkingRedis()
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
      redis: redis === null ? undefined : redis,
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
