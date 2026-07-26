/**
 * RetentionPurgeService — cohort preview + the per-user purge (Phase 2, D2–D5).
 *
 * The eligibility predicate itself lives in `eligibility.ts` so preview, nag,
 * and purge provably share one definition (D3) — the count an operator reviews
 * can never drift from the set the purge acts on.
 *
 * The purge is PER-USER by design (D2): one account per HTTP call, each within
 * its own 60s erasure transaction. A per-batch endpoint would blow Railway's
 * ~60s request timeout partway through and leave a partial, unrecorded purge.
 * The CLI loops; resuming is simply re-running it, since each purge removes its
 * own user from the cohort.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { AccountEraserService, type AccountEraserDeps } from '../AccountEraserService.js';
import type { AccountDeletionSummary } from '../AccountDeletionService.js';
import { findCrossUserReachIds } from './crossUserReach.js';
import {
  countEligibleUsers,
  selectEligibleUsers,
  type PurgeCohortRow,
  type PurgeReason,
} from './eligibility.js';
import { findPendingOffDbRows, recordPurgeFailure, settleOffDb } from './purgeAudit.js';

const logger = createLogger('RetentionPurgeService');

/**
 * Cohort share of the userbase that ANNOTATES the report with a warning (the
 * Phase-2 breaker is a warning, not a halt — the operator sees the batch and
 * decides).
 */
export const BREAKER_WARN_FRACTION = 0.15;

/**
 * Cohort share at which the purge REFUSES to run without an explicit
 * `breakerOverride`. This is the guard against a tracking-signal glitch
 * mass-flagging the userbase: `--force` skips the interactive prompt but
 * deliberately cannot skip this, so a scripted run can never wipe a quarter of
 * the userbase on one bad flag. Enforced server-side (not only in the CLI) so
 * the ceiling holds for any caller.
 */
export const BREAKER_HARD_FRACTION = 0.25;

export interface RetentionPreviewUser {
  discordId: string;
  inactiveSince: string;
  reason: PurgeReason;
  ownedCharacters: {
    /** Nobody else uses them — they die with the account. */
    toDelete: number;
    /** Other users have data on them — re-homed to the orphan sentinel (D11). */
    toReHome: number;
  };
}

export interface RetentionPreview {
  users: RetentionPreviewUser[];
  totals: {
    eligibleCount: number;
    userbaseCount: number;
    percentOfUserbase: number;
    charactersToDelete: number;
    charactersToReHome: number;
    /** Cohort exceeds BREAKER_WARN_FRACTION of the userbase — review closely. */
    breakerWarning: boolean;
  };
}

/**
 * Why a purge call did nothing. Every one of these is a NORMAL outcome the CLI
 * reports and moves past — only an unexpected throw is a failure.
 */
export type PurgeSkipReason =
  /** No user row with that Discord id — already purged, or never existed. */
  | 'already_gone'
  /** The predicate no longer holds: they became active since the preview (D4). */
  | 'no_longer_eligible'
  /** The cohort exceeds the hard ceiling and no override was given. */
  | 'breaker_tripped';

export type PurgeOutcome =
  | { status: 'purged'; discordId: string; charactersDeleted: number; charactersReHomed: number }
  | { status: 'skipped'; discordId: string; reason: PurgeSkipReason; detail?: string };

export interface PurgeUserOptions {
  discordId: string;
  /** Operator/run label recorded in the audit ledger. */
  runContext: string | null;
  /** Bypass the hard ceiling. Requires a deliberate, separate operator flag. */
  breakerOverride?: boolean;
}

export class RetentionPurgeService {
  constructor(private readonly deps: AccountEraserDeps) {}

  private get prisma(): PrismaClient {
    return this.deps.prisma;
  }

  /** THE eligibility predicate (D3/D4) — see `eligibility.ts`. */
  async selectPurgeCohort(): Promise<PurgeCohortRow[]> {
    return selectEligibleUsers(this.prisma);
  }

  /**
   * The operator-facing report: who is eligible and what would happen to their
   * characters, with the breaker annotation.
   */
  async buildPreview(): Promise<RetentionPreview> {
    // Denominator is ALL users, deliberately — including the handful that can
    // never be eligible (bot owner, retention_exempt, the orphan sentinel). The
    // breaker asks "how much of the userbase would this run erase?", and a
    // purgeable-population denominator would make the percentage drift every
    // time an exemption is added rather than when real churn changes.
    const [cohort, userbaseCount] = await Promise.all([
      this.selectPurgeCohort(),
      this.prisma.user.count(),
    ]);

    // Concurrent, not sequential: the daily nag calls this on a schedule, so a
    // per-user round-trip chain would put the whole cohort's latency on a timer.
    const users: RetentionPreviewUser[] = await Promise.all(
      cohort.map(async row => ({
        discordId: row.discordId,
        inactiveSince: row.inactiveSince.toISOString(),
        reason: row.reason,
        ownedCharacters: await this.splitOwnedCharacters(row.userId),
      }))
    );

    const charactersToDelete = users.reduce((sum, u) => sum + u.ownedCharacters.toDelete, 0);
    const charactersToReHome = users.reduce((sum, u) => sum + u.ownedCharacters.toReHome, 0);
    const percentOfUserbase =
      userbaseCount === 0 ? 0 : Math.round((users.length / userbaseCount) * 1000) / 10;

    return {
      users,
      totals: {
        eligibleCount: users.length,
        userbaseCount,
        percentOfUserbase,
        charactersToDelete,
        charactersToReHome,
        breakerWarning: userbaseCount > 0 && users.length / userbaseCount > BREAKER_WARN_FRACTION,
      },
    };
  }

  /**
   * Purge ONE account (D2). Idempotent: a user who is already gone, or who no
   * longer satisfies the predicate, is reported as skipped rather than as an
   * error — the CLI loop must be safe to re-run after any interruption.
   *
   * The TOCTOU re-check (D4) is NOT here: it runs inside the erasure
   * transaction, because any check out here would reopen the window it closes.
   */
  async purgeUser(options: PurgeUserOptions): Promise<PurgeOutcome> {
    const { discordId, runContext, breakerOverride = false } = options;

    // Existence first, THEN the ceiling. The order matters for the reported
    // reason, not for safety: a target that no longer exists has nothing to
    // erase, so answering `breaker_tripped` would be actively misleading about
    // why nothing happened. The ceiling still gates every actual deletion —
    // this lookup is a read, so "no erasure without passing the breaker" holds
    // either way. It also skips two COUNT(*)s on a no-op call.
    const user = await this.prisma.user.findUnique({
      where: { discordId },
      select: { id: true },
    });
    if (user === null) {
      return { status: 'skipped', discordId, reason: 'already_gone' };
    }

    if (!breakerOverride) {
      const tripped = await this.checkHardCeiling();
      if (tripped !== null) {
        return { status: 'skipped', discordId, reason: 'breaker_tripped', detail: tripped };
      }
    }

    const summary = await this.eraseAndAudit(user.id, discordId, runContext);
    if (summary === null) {
      // The in-transaction re-check found them active again and rolled back.
      return { status: 'skipped', discordId, reason: 'no_longer_eligible' };
    }

    logger.warn(
      { discordId, runContext, charactersDeleted: summary.characters },
      'RETENTION PURGE COMPLETED'
    );
    return {
      status: 'purged',
      discordId,
      charactersDeleted: summary.characters,
      charactersReHomed: summary.charactersReHomed,
    };
  }

  /**
   * Run the erasure, and record a `failed` ledger row if it throws.
   *
   * The success row is written INSIDE the erasure transaction (D14), which is
   * exactly why the failure row cannot be: that transaction rolled back, taking
   * any row written in it along. Without this, an erasure that dies for an
   * unexpected reason — a transaction timeout on a large account, a lost
   * connection — leaves the ledger claiming no attempt was ever made.
   *
   * A rolled-back purge deleted nothing, so this is forensics rather than
   * correctness; it is here because the one operation where "what did we try to
   * do, and when" matters most is the one that erases accounts.
   *
   * NOT recorded: the TOCTOU abort, which the eraser reports as `null` rather
   * than a throw. That one is a routine, expected outcome of a resumable loop —
   * logging it would fill the ledger with non-events.
   */
  private async eraseAndAudit(
    userId: string,
    discordId: string,
    runContext: string | null
  ): Promise<AccountDeletionSummary | null> {
    try {
      return await new AccountEraserService(this.deps).erase({
        userId,
        discordUserId: discordId,
        mode: 'retention',
        runContext,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      try {
        await recordPurgeFailure(this.prisma, discordId, runContext, reason);
      } catch (auditError) {
        // Never let the ledger write mask the real failure — the caller needs
        // the original error, and a swallowed audit write is the lesser loss.
        logger.error({ err: auditError, discordId }, 'Failed to record purge failure');
      }
      throw error;
    }
  }

  /**
   * Retry the off-DB cleanup for every ledger row that still owes it (D15).
   * Returns how many rows were settled and how many are still failing.
   */
  async reconcileOffDb(): Promise<{ settled: number; stillFailing: number }> {
    const pending = await findPendingOffDbRows(this.prisma);
    const eraser = new AccountEraserService(this.deps);
    let settled = 0;
    let stillFailing = 0;
    for (const row of pending) {
      // characterIds is empty by design: cache invalidation is not replayed.
      // Those caches expire on their own (~1h), so by the time a sweep runs the
      // broadcast would be a no-op — only the avatar unlink is worth retrying.
      const ok = await eraser.cleanupOffDb(row.targetDiscordId, {
        characterSlugs: row.characterSlugs,
        characterIds: [],
      });
      await settleOffDb(this.prisma, row.id, ok ? 'done' : 'failed');
      if (ok) {
        settled += 1;
      } else {
        stillFailing += 1;
        logger.warn({ logId: row.id }, 'Off-DB reconciliation retry still failing');
      }
    }
    return { settled, stillFailing };
  }

  /**
   * The hard-ceiling gate. Returns a human-readable reason when the current
   * cohort is too large a share of the userbase to purge unattended, or null
   * when the run may proceed.
   */
  private async checkHardCeiling(): Promise<string | null> {
    const [eligibleCount, userbaseCount] = await Promise.all([
      countEligibleUsers(this.prisma),
      this.prisma.user.count(),
    ]);
    if (userbaseCount === 0 || eligibleCount / userbaseCount <= BREAKER_HARD_FRACTION) {
      return null;
    }
    const percent = Math.round((eligibleCount / userbaseCount) * 1000) / 10;
    return (
      `Circuit breaker: ${String(eligibleCount)} of ${String(userbaseCount)} users ` +
      `(${String(percent)}%) are purge-eligible, above the ` +
      `${String(BREAKER_HARD_FRACTION * 100)}% ceiling. Confirm this is real churn ` +
      'and not a tracking-signal glitch, then re-run with --breaker-override.'
    );
  }

  /** Owned characters split by the same reach signal the purge acts on (D11). */
  private async splitOwnedCharacters(
    userId: string
  ): Promise<{ toDelete: number; toReHome: number }> {
    // Intentionally unbounded (exception to the bounded-findMany rule, same as
    // the eraser's owned-set query): a paginated page would under-report the
    // character impact the operator is deciding on.
    const owned = await this.prisma.personality.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (owned.length === 0) {
      return { toDelete: 0, toReHome: 0 };
    }
    const reHomeIds = await findCrossUserReachIds(
      this.prisma,
      userId,
      owned.map(character => character.id)
    );
    return { toDelete: owned.length - reHomeIds.length, toReHome: reHomeIds.length };
  }
}
