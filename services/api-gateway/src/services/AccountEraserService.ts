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
  RetentionIneligibleError,
  type AccountDeletionMode,
  type AccountDeletionSummary,
} from './AccountDeletionService.js';
import { settleOffDb } from './retention/purgeAudit.js';

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
  /** Operator/run label recorded in the retention audit ledger (retention only). */
  readonly runContext?: string | null;
}

/** The off-DB cleanup inputs — the subset of a summary that outlives the DB rows. */
export interface OffDbCleanupTargets {
  readonly characterSlugs: string[];
  readonly characterIds: string[];
}

export class AccountEraserService {
  constructor(private readonly deps: AccountEraserDeps) {}

  /**
   * Erase the account (DB + off-DB) in the given mode; returns the deletion
   * summary. Propagates `SuperuserDeletionError` from the DB half (the caller
   * maps it to a 403). Off-DB steps are best-effort and never fail the erase —
   * the DB rows are already gone, and every off-DB effect self-heals or
   * TTL-expires.
   *
   * Returns **null** when a retention target failed the in-transaction
   * eligibility re-check (D4): they became active since the cohort was
   * selected, the transaction rolled back, and nothing was deleted. That is a
   * normal, expected outcome of a resumable purge loop rather than a failure,
   * so it is a return value and not a thrown error at this boundary.
   */
  // Only the retention path can return null — self-serve has no eligibility
  // predicate to fail, because the user themselves asked. The overloads keep
  // that out of the delete route rather than making it null-check an outcome it
  // can never receive.
  async erase(opts: AccountEraseOptions & { mode: 'self-serve' }): Promise<AccountDeletionSummary>;
  async erase(
    opts: AccountEraseOptions & { mode: 'retention' }
  ): Promise<AccountDeletionSummary | null>;
  async erase(opts: AccountEraseOptions): Promise<AccountDeletionSummary | null> {
    const { userId, discordUserId, mode, runContext = null } = opts;
    let summary: AccountDeletionSummary;
    try {
      summary = await new AccountDeletionService(this.deps.prisma).deleteAccount(
        userId,
        discordUserId,
        mode,
        runContext
      );
    } catch (error) {
      if (error instanceof RetentionIneligibleError) {
        logger.info({ discordUserId }, 'Retention purge aborted — user is active again');
        return null;
      }
      throw error;
    }

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

    const offDbOk = await this.cleanupOffDb(discordUserId, summary);

    // Settle the audit row's reconciliation status (D15). A `failed` row is the
    // retry queue the reconciliation sweep drains — the erase itself still
    // succeeded, because the DB rows are already gone either way.
    if (summary.auditLogId !== null) {
      try {
        await settleOffDb(this.deps.prisma, summary.auditLogId, offDbOk ? 'done' : 'failed');
      } catch (error) {
        // Left at 'pending', which the sweep also picks up — the ledger's
        // default state is already the safe one.
        logger.warn({ err: error }, 'Failed to settle purge-audit off-DB status');
      }
    }
    return summary;
  }

  /**
   * Best-effort post-transaction cleanup for cached/filesystem state that
   * outlives the DB rows but self-heals or TTL-expires. Failures are logged,
   * never thrown — the account is already gone. Runs concurrently (every task
   * swallows its own error) so per-character work doesn't stack sequentially.
   *
   * Returns whether every step succeeded, which is what the retention audit
   * ledger records and what the reconciliation sweep re-runs against. Public
   * because that sweep replays exactly this work from a ledger row long after
   * the erase returned.
   */
  async cleanupOffDb(discordUserId: string, summary: OffDbCleanupTargets): Promise<boolean> {
    const { redis, cacheInvalidationService } = this.deps;
    // Every task resolves to whether it succeeded; none reject. Failing loudly
    // here would abort the sibling tasks, and the account is already gone — the
    // right response to a failure is to record it, not to stop cleaning up.
    const tasks: Promise<boolean>[] = [
      (async () => {
        if (redis === undefined) {
          return true;
        }
        // Settle both sweeps independently — a transient failure on one mode
        // must not skip the other (a 'forever' session has no TTL to fall back
        // on, so a skipped sweep would orphan the key indefinitely).
        const results = await Promise.allSettled(
          (['incognito', 'fresh'] as const).map(mode =>
            new MemoryModeSessionManager(redis, mode).disableAll(discordUserId)
          )
        );
        let ok = true;
        for (const result of results) {
          if (result.status === 'rejected') {
            logger.warn({ err: result.reason }, 'Post-deletion memory-mode cleanup failed');
            ok = false;
          }
        }
        return ok;
      })(),
      ...summary.characterIds.map(async personalityId => {
        try {
          await cacheInvalidationService?.invalidatePersonality(personalityId);
          return true;
        } catch (error) {
          logger.warn({ err: error, personalityId }, 'Post-deletion cache invalidation failed');
          return false;
        }
      }),
      // Avatars are served filesystem-first; without the unlink, deleted
      // characters' avatars stay publicly downloadable forever. (Re-homed
      // retention survivors aren't in `characterSlugs`, so their avatars stay.)
      // This is the ONLY off-DB step with no self-healing fallback, which is
      // why the audit ledger persists these slugs for the retry sweep.
      ...summary.characterSlugs.map(async slug => {
        try {
          await deleteAllAvatarVersions(slug, 'Account delete');
          return true;
        } catch (error) {
          logger.warn({ err: error, slug }, 'Post-deletion avatar unlink failed');
          return false;
        }
      }),
    ];
    const outcomes = await Promise.all(tasks);
    return outcomes.every(ok => ok);
  }
}
