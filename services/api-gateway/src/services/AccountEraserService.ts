/**
 * AccountEraserService — the single, mode-aware account-erasure primitive
 * (Retention Phase 2, D1). Composes the DB half (`AccountDeletionService`, one
 * constraints-deferred transaction) with the off-DB half (avatar unlink, Redis
 * session + provisioning-cache eviction, cross-process cache broadcast) that
 * previously lived inline in the self-serve delete route.
 *
 * Both the self-serve delete route and (Phase 2 PR-D) the retention purge call
 * this so complete erasure is defined in ONE place: `deleteAccount()` alone is
 * DB-only and leaves avatars publicly downloadable + stale caches FK-violating.
 *
 * The `mode` shapes the DB half (self-serve deletes owned characters for
 * everyone; retention re-homes cross-user characters to the sentinel). The
 * off-DB half is mode-agnostic — it processes whatever the resulting summary
 * reports as *deleted*, so a retention-re-homed character's avatar/cache is
 * correctly left intact (it isn't in the summary's deleted lists).
 */

import type { Redis } from 'ioredis';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  UserCacheInvalidationService,
  type CacheInvalidationService,
} from '@tzurot/cache-invalidation';
import { deleteAllAvatarVersions } from '../utils/avatarPaths.js';
import { getOrCreateUserService } from './AuthMiddleware.js';
import { MemoryModeSessionManager } from './MemoryModeSessionManager.js';
import {
  AccountDeletionService,
  type AccountDeletionMode,
  type AccountDeletionSummary,
} from './AccountDeletionService.js';

const logger = createLogger('AccountEraserService');

/** The subset of route/service deps the off-DB cleanup needs. `RouteDeps`
 *  satisfies this structurally, so the delete route passes its `deps` directly. */
export interface AccountEraserDeps {
  readonly prisma: PrismaClient;
  readonly redis?: Redis;
  readonly cacheInvalidationService?: CacheInvalidationService;
}

export interface AccountEraseOptions {
  /** Internal user UUID. */
  readonly userId: string;
  /** Discord snowflake (loose-ref sweeps + cache keys are keyed on it). */
  readonly discordUserId: string;
  readonly mode: AccountDeletionMode;
}

export class AccountEraserService {
  constructor(private readonly deps: AccountEraserDeps) {}

  /**
   * Erase the account (DB + off-DB) in the given mode; returns the deletion
   * summary. Propagates `SuperuserDeletionError` from the DB half (the caller
   * maps it to a 403). Off-DB steps are best-effort and never fail the erase —
   * the DB rows are already gone, and every off-DB effect self-heals or
   * TTL-expires.
   */
  async erase(opts: AccountEraseOptions): Promise<AccountDeletionSummary> {
    const { userId, discordUserId, mode } = opts;
    const summary = await new AccountDeletionService(this.deps.prisma).deleteAccount(
      userId,
      discordUserId,
      mode
    );

    // CORRECTNESS-CRITICAL (not best-effort): the provisioning cache still maps
    // this discordId to the just-deleted userId. Without eviction, the user's
    // very next request returns the dead id and any write against it
    // FK-violates (observed on export_jobs_user_id_fkey).
    //   (1) Evict THIS process synchronously (tightest fix; no round-trip).
    getOrCreateUserService(this.deps.prisma).invalidateUser(discordUserId);
    //   (2) Broadcast so every OTHER process (ai-worker's context pipeline has
    //       its own long-lived UserService) drops the mapping too.
    if (this.deps.redis !== undefined) {
      try {
        await new UserCacheInvalidationService(this.deps.redis).invalidateUser(discordUserId);
      } catch (error) {
        // Swallowed: THIS process was evicted synchronously above and the
        // account is already gone, so the erase must still succeed. Blast
        // radius of a failed broadcast: other processes' UserService caches
        // stay stale until the ~1h TTL. Bounded, self-healing.
        logger.warn({ err: error }, 'Post-deletion user-cache broadcast failed');
      }
    }

    await this.cleanupAfterDeletion(discordUserId, summary);
    return summary;
  }

  /**
   * Best-effort post-transaction cleanup for cached/filesystem state that
   * outlives the DB rows but self-heals or TTL-expires. Failures are logged,
   * never thrown — the account is already gone. Runs concurrently (every task
   * swallows its own error) so per-character work doesn't stack sequentially.
   */
  private async cleanupAfterDeletion(
    discordUserId: string,
    summary: AccountDeletionSummary
  ): Promise<void> {
    const { redis, cacheInvalidationService } = this.deps;
    const tasks: Promise<void>[] = [
      (async () => {
        if (redis === undefined) {
          return;
        }
        // Settle both sweeps independently — a transient failure on one mode
        // must not skip the other (a 'forever' session has no TTL to fall back
        // on, so a skipped sweep would orphan the key indefinitely).
        const results = await Promise.allSettled(
          (['incognito', 'fresh'] as const).map(mode =>
            new MemoryModeSessionManager(redis, mode).disableAll(discordUserId)
          )
        );
        for (const result of results) {
          if (result.status === 'rejected') {
            logger.warn({ err: result.reason }, 'Post-deletion memory-mode cleanup failed');
          }
        }
      })(),
      ...summary.characterIds.map(async personalityId => {
        try {
          await cacheInvalidationService?.invalidatePersonality(personalityId);
        } catch (error) {
          logger.warn({ err: error, personalityId }, 'Post-deletion cache invalidation failed');
        }
      }),
      // Avatars are served filesystem-first; without the unlink, deleted
      // characters' avatars stay publicly downloadable forever. (Re-homed
      // retention survivors aren't in `characterSlugs`, so their avatars stay.)
      ...summary.characterSlugs.map(async slug => {
        try {
          await deleteAllAvatarVersions(slug, 'Account delete');
        } catch (error) {
          logger.warn({ err: error, slug }, 'Post-deletion avatar unlink failed');
        }
      }),
    ];
    await Promise.all(tasks);
  }
}
