/**
 * One-time historical backfill of User.last_active_at (retention Phase 1).
 *
 * last_active_at is maintained forward by the activity-stamp path, but a fresh
 * column is NULL for every existing user. Defaulting it to ship-time would hand
 * a years-abandoned account a fresh 180-day inactivity window for no benefit
 * (the "zombie cohort"), so this backfill seeds it from the user's genuine
 * historical activity instead.
 *
 * The value is the MAX over these per-user activity signals:
 *  - usage_logs.created_at       — every AI generation (durable; the strongest signal)
 *  - conversation_history.created_at via personas.owner_id — per user message
 *  - personas GREATEST(created_at, updated_at)      — the user's own persona CRUD
 *  - personalities GREATEST(created_at, updated_at) — the user's character CRUD
 *  - memories.created_at via personas.owner_id      — a stored memory ≈ conversation time
 *
 * Deliberate exclusions (both would push last_active_at LATER than real activity,
 * which is the unsafe direction — an inflated clock never gets purged):
 *  - memory_facts: created_at is fact-EXTRACTION time (facts are derived from
 *    memories asynchronously, and were themselves backfilled), not user activity.
 *  - memories/conversation via personality_id: that owner is the character's
 *    CREATOR, not whoever chatted with it — the wrong person. Only persona-owner
 *    attribution (the user's own conversational identity) counts; memories with a
 *    NULL persona_id are skipped (those users are covered by usage_logs anyway).
 *
 * Guardrails, mirroring repair-fact-timestamps:
 *  - FORWARD-ONLY into a fresh column, but idempotent: a row is only touched when
 *    the computed activity is newer than the stored value (or the stored value is
 *    NULL), so re-running is a no-op.
 *  - dry-run buckets the eligible rows by how stale the computed value is, so the
 *    ">180d" bucket previews how many accounts would already be past the window.
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  confirmProductionOperation,
} from '../utils/env-runner.js';
import { getPrismaForEnv } from '../memory/prisma-env.js';

export interface BackfillLastActiveOptions {
  env: Environment;
  dryRun?: boolean;
  force?: boolean;
}

interface PrismaLike {
  $queryRawUnsafe: <T = unknown>(query: string) => Promise<T>;
  $executeRawUnsafe: (query: string) => Promise<number>;
}

/**
 * The eligible set: each user's newest genuine activity, restricted to users
 * where it would advance last_active_at. A single self-contained SELECT (no
 * CTEs of its own) so both the analysis and the UPDATE wrap the SAME body —
 * the eligibility filter can never drift between them.
 */
const ELIGIBLE_SELECT = `
  SELECT latest.user_id, latest.last_active
  FROM (
    SELECT user_id, MAX(ts) AS last_active
    FROM (
      SELECT ul.user_id AS user_id, ul.created_at AS ts
      FROM usage_logs ul
      UNION ALL
      SELECT p.owner_id, ch.created_at
      FROM conversation_history ch
      JOIN personas p ON p.id = ch.persona_id
      UNION ALL
      SELECT p.owner_id, GREATEST(p.created_at, p.updated_at)
      FROM personas p
      UNION ALL
      SELECT pl.owner_id, GREATEST(pl.created_at, pl.updated_at)
      FROM personalities pl
      UNION ALL
      SELECT mp.owner_id, m.created_at
      FROM memories m
      JOIN personas mp ON mp.id = m.persona_id
    ) activity
    WHERE user_id IS NOT NULL AND ts IS NOT NULL
    GROUP BY user_id
  ) latest
  JOIN users u ON u.id = latest.user_id
  WHERE u.last_active_at IS NULL OR latest.last_active > u.last_active_at
`;

export interface BackfillScope {
  total: number;
  buckets: { bucket: string; n: number }[];
}

/** Count the eligible rows and bucket by how stale the computed value is (the dry-run report). */
export async function analyzeScope(prisma: PrismaLike): Promise<BackfillScope> {
  const buckets = await prisma.$queryRawUnsafe<{ bucket: string; n: number }[]>(
    `WITH eligible AS (${ELIGIBLE_SELECT})
     SELECT CASE
              WHEN last_active > NOW() - INTERVAL '30 days'  THEN 'a: <30d (active)'
              WHEN last_active > NOW() - INTERVAL '180 days' THEN 'b: 30-180d'
              ELSE 'c: >180d (already past the inactivity window)'
            END AS bucket, COUNT(*)::int AS n
     FROM eligible GROUP BY 1 ORDER BY 1`
  );
  const total = buckets.reduce((sum, row) => sum + Number(row.n), 0);
  return { total, buckets };
}

/** Apply the backfill from the same eligible set; returns rows updated. */
export async function executeBackfill(prisma: PrismaLike): Promise<number> {
  return prisma.$executeRawUnsafe(
    `WITH eligible AS (${ELIGIBLE_SELECT})
     UPDATE users u
     SET last_active_at = eligible.last_active
     FROM eligible
     WHERE u.id = eligible.user_id`
  );
}

/** Entry point for \`pnpm ops retention:backfill-last-active\`. */
export async function backfillLastActive(options: BackfillLastActiveOptions): Promise<void> {
  const { env, dryRun = false, force = false } = options;
  validateEnvironment(env);
  showEnvironmentBanner(env);
  if (env === 'prod' && !dryRun && !force) {
    const confirmed = await confirmProductionOperation(
      'backfill users.last_active_at from history'
    );
    if (!confirmed) {
      console.log(chalk.yellow('\nOperation cancelled.'));
      return;
    }
  }

  const { prisma, disconnect } = await getPrismaForEnv(env);
  try {
    const scope = await analyzeScope(prisma);
    console.log(chalk.bold('\nBackfill scope (users whose last_active_at would advance):'));
    for (const row of scope.buckets) {
      console.log(`  ${row.bucket}: ${row.n}`);
    }
    console.log(`  total eligible: ${scope.total}`);

    if (scope.total === 0) {
      console.log(
        chalk.green('\nNothing to backfill — every user already has an up-to-date last_active_at.')
      );
      return;
    }
    if (dryRun) {
      console.log(chalk.yellow('\nDry run — no rows updated.'));
      return;
    }

    const updated = await executeBackfill(prisma);
    console.log(
      chalk.green(`\n✅ Backfilled last_active_at on ${updated} users (re-run is a no-op).`)
    );
  } finally {
    await disconnect();
  }
}
