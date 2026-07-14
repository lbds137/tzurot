/**
 * Fact valid_from repair (memory 1b redirect, slice A).
 *
 * memory_facts.valid_from was historically set to WRITE time, so a bulk
 * backfill of months-old episodes minted facts that look fresh to the
 * recency tiebreak — at repair time 57% of active facts carried valid_from
 * more than six months newer than their newest source episode, making
 * "recency" mean "backfill batch time".
 *
 * The repair sets valid_from to the newest SOURCE episode's created_at (the
 * same semantic the extraction write path now uses), with these guardrails:
 *  - BACKWARD-ONLY: rows are touched only when the computed source time is
 *    strictly older than the stored valid_from — re-running is a no-op, and
 *    a fact can never be made to look fresher than it already claims.
 *  - corrected-tier and user-locked rows are never touched (their timestamps
 *    are user-command time, which is correct as-is).
 *  - facts whose source episodes are missing (deleted, empty provenance)
 *    are left alone — no COALESCE guessing.
 *
 * Superseded/forgotten rows ARE repaired: they never surface in retrieval,
 * but honest timestamps keep future analytics and revival semantics sane.
 */

import chalk from 'chalk';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  confirmProductionOperation,
} from '../utils/env-runner.js';
import { getPrismaForEnv } from './prisma-env.js';

export interface RepairFactTimestampsOptions {
  env: Environment;
  dryRun?: boolean;
  force?: boolean;
}

interface PrismaLike {
  $queryRawUnsafe: <T = unknown>(query: string) => Promise<T>;
  $executeRawUnsafe: (query: string) => Promise<number>;
}

/** The repairable set: per-fact newest source time, eligible rows only. */
const REPAIR_SCOPE_CTE = `
  SELECT mf.id, mf.valid_from, MAX(m.created_at) AS newest_source
  FROM memory_facts mf
  CROSS JOIN LATERAL UNNEST(mf.source_memory_ids) AS s(src)
  JOIN memories m ON m.id = s.src::uuid
  WHERE mf.tier != 'corrected' AND mf.is_locked = false
  GROUP BY mf.id, mf.valid_from
  HAVING MAX(m.created_at) < mf.valid_from
`;

export interface RepairScope {
  total: number;
  buckets: { bucket: string; n: number }[];
}

/** Count the repairable rows and bucket their skew (the dry-run report). */
export async function analyzeRepairScope(prisma: PrismaLike): Promise<RepairScope> {
  const buckets = await prisma.$queryRawUnsafe<{ bucket: string; n: number }[]>(
    `WITH repair AS (${REPAIR_SCOPE_CTE})
     SELECT CASE
              WHEN valid_from - newest_source < INTERVAL '2 days' THEN 'a: <2d'
              WHEN valid_from - newest_source < INTERVAL '30 days' THEN 'b: 2-30d'
              WHEN valid_from - newest_source < INTERVAL '180 days' THEN 'c: 1-6mo'
              ELSE 'd: >6mo'
            END AS bucket, COUNT(*)::int AS n
     FROM repair GROUP BY 1 ORDER BY 1`
  );
  const total = buckets.reduce((sum, row) => sum + Number(row.n), 0);
  return { total, buckets };
}

/** Apply the backward-only repair; returns rows updated. */
export async function executeRepair(prisma: PrismaLike): Promise<number> {
  return prisma.$executeRawUnsafe(
    `WITH repair AS (${REPAIR_SCOPE_CTE})
     UPDATE memory_facts mf
     SET valid_from = repair.newest_source, updated_at = NOW()
     FROM repair
     WHERE mf.id = repair.id`
  );
}

/** Entry point for \`pnpm ops memory:repair-fact-timestamps\`. */
export async function repairFactTimestamps(options: RepairFactTimestampsOptions): Promise<void> {
  const { env, dryRun = false, force = false } = options;
  validateEnvironment(env);
  showEnvironmentBanner(env);
  if (env === 'prod' && !dryRun && !force) {
    const confirmed = await confirmProductionOperation('rewrite memory_facts.valid_from in place');
    if (!confirmed) {
      console.log(chalk.yellow('\nOperation cancelled.'));
      return;
    }
  }

  const { prisma, disconnect } = await getPrismaForEnv(env);
  try {
    const scope = await analyzeRepairScope(prisma);
    console.log(chalk.bold('\nRepair scope (valid_from newer than newest source episode):'));
    for (const row of scope.buckets) {
      console.log(`  ${row.bucket}: ${row.n}`);
    }
    console.log(`  total repairable: ${scope.total}`);

    if (scope.total === 0) {
      console.log(
        chalk.green('\nNothing to repair — every eligible fact already has source-time valid_from.')
      );
      return;
    }
    if (dryRun) {
      console.log(chalk.yellow('\nDry run — no rows updated.'));
      return;
    }

    const updated = await executeRepair(prisma);
    console.log(
      chalk.green(
        `\n✅ Repaired valid_from on ${updated} facts (backward-only; re-run is a no-op).`
      )
    );
  } finally {
    await disconnect();
  }
}
