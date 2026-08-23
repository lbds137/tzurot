/**
 * POST /api/admin/db-sync
 * Bidirectional database synchronization between dev and prod
 */

import { type Request, type RequestHandler, type Response } from 'express';
import { getConfig } from '@tzurot/common-types/config/config';
import { DbSyncSchema } from '@tzurot/common-types/schemas/api/admin';
import { transientPoolOptions } from '@tzurot/common-types/services/poolConfig';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { PrismaPg } from '@prisma/adapter-pg';
import { DatabaseSyncService } from '../../services/DatabaseSyncService.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { getOrCreateUserService } from '../../services/AuthMiddleware.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-db-sync');

/**
 * True when this run actually wrote rows to the named table. A dry run
 * writes nothing, and a table whose scan produced no pending writes leaves a
 * zeroed stats entry. `conflicts` is a resolution counter rather than a write
 * count, so it is excluded. Both polarities are pinned by this route's tests.
 */
function syncWroteTable(
  result: { stats: Record<string, { devToProd: number; prodToDev: number; deleted: number }> },
  tableName: string,
  dryRun: boolean
): boolean {
  if (dryRun) {
    return false;
  }
  const stats = result.stats[tableName];
  if (stats === undefined) {
    return false;
  }
  return stats.devToProd + stats.prodToDev + stats.deleted > 0;
}

/**
 * POST /api/admin/db-sync — named handler export consumed by the
 * generated mounts.ts codegen. The returned `RequestHandler` is
 * composition-ready; middleware (auth, rate limiters) is applied by
 * the caller at the mount site.
 */
export const handleDbSync = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = DbSyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { dryRun, allowSchemaSkew } = parseResult.data;
    const config = getConfig();

    // Verify database URLs are configured
    if (
      config.DEV_DATABASE_URL === undefined ||
      config.DEV_DATABASE_URL.length === 0 ||
      config.PROD_DATABASE_URL === undefined ||
      config.PROD_DATABASE_URL.length === 0
    ) {
      return sendError(
        res,
        ErrorResponses.configurationError(
          'Both DEV_DATABASE_URL and PROD_DATABASE_URL must be configured'
        )
      );
    }

    logger.info({ dryRun, allowSchemaSkew }, 'Starting database sync');

    // Create Prisma clients for dev and prod databases using driver adapters.
    // transientPoolOptions caps these short-lived cross-env sync pools and gives
    // them a finite acquisition timeout (the adapter ignores connection_limit).
    const devAdapter = new PrismaPg({
      connectionString: config.DEV_DATABASE_URL,
      ...transientPoolOptions(),
    });
    const devClient = new PrismaClient({ adapter: devAdapter });

    const prodAdapter = new PrismaPg({
      connectionString: config.PROD_DATABASE_URL,
      ...transientPoolOptions(),
    });
    const prodClient = new PrismaClient({ adapter: prodAdapter });

    // Execute sync - the service handles connect/disconnect internally
    const syncService = new DatabaseSyncService(devClient, prodClient);
    const result = await syncService.sync({ dryRun, allowSchemaSkew });

    logger.info({ result }, 'Database sync complete');

    if (syncWroteTable(result, 'users', dryRun)) {
      // A sync writes bulk, unenumerable rows — no per-user id list to target,
      // so the local provisioning cache needs a full clear rather than
      // per-user eviction (contrast the per-user invalidation on the
      // set-default-persona / account-delete routes, where the changed id IS
      // known).
      //   (1) Evict THIS process synchronously (tightest fix; no round-trip).
      getOrCreateUserService(deps.prisma).clearCache();
      //   (2) Broadcast so every OTHER process (ai-worker's context pipeline
      //       has its own long-lived UserService) drops its cache too.
      try {
        await deps.userCacheInvalidation?.invalidateAll();
      } catch (error) {
        // Swallowed: THIS process was cleared synchronously above, and the
        // sync already committed, so the request must still succeed. Blast
        // radius of a failed broadcast: other processes' UserService caches
        // stay stale until the ~1h TTL. Bounded, self-healing.
        logger.warn({ err: error }, 'Post-sync user-cache broadcast failed');
      }
    }

    if (
      syncWroteTable(result, 'personas', dryRun) ||
      syncWroteTable(result, 'user_personality_configs', dryRun) ||
      syncWroteTable(result, 'users', dryRun)
    ) {
      // All THREE tables feed PersonaResolver: `personas` (the rows), the
      // override table (which persona applies per personality), and `users`
      // (`default_persona_id` — the same field whose change makes the
      // set-default route broadcast on this channel). A sync bulk-writes any
      // of them without going through the routes that publish per-user
      // invalidation, so a write to any staleness-poisons the same cache.
      // Broadcast-only:
      // the subscribers on this channel live in ai-worker; the gateway holds
      // no subscribed persona resolver to clear locally (its private
      // instances are a separately-tracked gap).
      try {
        await deps.personaCacheInvalidation?.invalidateAll();
      } catch (error) {
        // Swallowed for the same reason as the users half: the sync already
        // committed. Blast radius: subscribed resolver caches stay stale for
        // one resolver TTL. Bounded, self-healing.
        logger.warn({ err: error }, 'Post-sync persona-cache broadcast failed');
      }
    }

    sendCustomSuccess(res, {
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  });
