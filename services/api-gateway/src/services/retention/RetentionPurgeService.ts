/**
 * RetentionPurgeService — cohort selection + preview (Retention Phase 2, D2/D3/D4).
 *
 * Owns THE eligibility predicate. D3 requires exactly one, consumed by the
 * preview (this PR), the daily nag, and the purge itself (both PR-D) — so the
 * count the operator reviews can never drift from the set the purge acts on.
 *
 * This service is READ-ONLY. It selects and reports; it deletes nothing. The
 * per-user purge (which re-evaluates this same predicate inside its transaction
 * to close the preview→purge TOCTOU window) lands in PR-D.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { findCrossUserReachIds } from './crossUserReach.js';

/**
 * The single retention window (epic decision: ONE 180-day window, not the
 * rejected flat-90d). Inactivity is measured from last_active_at, falling back
 * to created_at when the tracking clock never stamped (NULL = "no known
 * activity", never "active now").
 */
export const RETENTION_WINDOW_DAYS = 180;

/**
 * Cohort share of the userbase that annotates the report with a warning (the
 * Phase-2 circuit breaker is a WARNING, not a halt — the operator sees the
 * batch and decides). The hard ceiling that even --force can't bypass is a
 * purge-time gate and lands with the purge (PR-D).
 */
export const BREAKER_WARN_FRACTION = 0.15;

/** Why a user is purge-eligible — the two unreachable signals (D13). */
export type PurgeReason = 'unreachable' | 'account_gone';

export interface PurgeCohortRow {
  userId: string;
  discordId: string;
  /** Effective inactivity anchor: last_active_at ?? created_at. */
  inactiveSince: Date;
  reason: PurgeReason;
}

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

interface CohortSqlRow {
  userId: string;
  discordId: string;
  inactiveSince: Date;
  accountGone: boolean;
}

export class RetentionPurgeService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * THE eligibility predicate (D4). Unreachable-or-gone AND inactive past the
   * window AND not the bot owner AND not exempted. `retention_exempt` also
   * self-excludes the Orphaned-Characters sentinel, so re-homed characters are
   * never purged out from under the users they were preserved for.
   *
   * Unbounded by design: the cohort IS the answer, and truncating it would
   * under-report the very number the breaker exists to police. The breaker's
   * percentage annotation is what flags an implausibly large result.
   */
  async selectPurgeCohort(): Promise<PurgeCohortRow[]> {
    const rows = await this.prisma.$queryRaw<CohortSqlRow[]>`
      SELECT u.id AS "userId",
             u.discord_id AS "discordId",
             COALESCE(u.last_active_at, u.created_at) AS "inactiveSince",
             (u.discord_account_gone_at IS NOT NULL) AS "accountGone"
      FROM users u
      WHERE (u.dm_undeliverable_since IS NOT NULL OR u.discord_account_gone_at IS NOT NULL)
        AND COALESCE(u.last_active_at, u.created_at)
              < now() - make_interval(days => ${RETENTION_WINDOW_DAYS})
        AND u.is_superuser = false
        AND u.retention_exempt = false
      ORDER BY COALESCE(u.last_active_at, u.created_at) ASC
    `;
    return rows.map(row => ({
      userId: row.userId,
      discordId: row.discordId,
      inactiveSince: row.inactiveSince,
      // A gone account is the stronger signal, so it wins the label when both
      // are stamped (it also drives the faster purge policy in PR-D).
      reason: row.accountGone ? 'account_gone' : 'unreachable',
    }));
  }

  /**
   * The operator-facing report: who is eligible and what would happen to their
   * characters, with the breaker annotation.
   *
   * Walks the cohort per-user for the character split. That is N+1-shaped by
   * construction, which is fine HERE and only here: the cohort is bounded in
   * practice (tens of users — a cohort large enough for this to matter is
   * itself the anomaly the breaker warning exists to surface), and the command
   * is an interactive, operator-run read.
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

    const users: RetentionPreviewUser[] = [];
    for (const row of cohort) {
      users.push({
        discordId: row.discordId,
        inactiveSince: row.inactiveSince.toISOString(),
        reason: row.reason,
        ownedCharacters: await this.splitOwnedCharacters(row.userId),
      });
    }

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
