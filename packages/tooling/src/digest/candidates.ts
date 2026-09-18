/**
 * `pnpm ops digest:candidates` — a read-only report over the recent-days
 * digest selection query.
 *
 * Shares `selectDigestCandidatePairs` with the ai-worker sweep so this
 * report can never drift from what the sweep would actually pick — a
 * duplicated query here would let this report list candidates the sweep
 * would not actually select, or vice versa.
 */

import chalk from 'chalk';
import { getPrismaForEnv } from '../memory/prisma-env.js';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
} from '../utils/env-runner.js';
import { SystemSettingsService } from '@tzurot/common-types/services/SystemSettingsService';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  selectDigestCandidatePairs,
  type DigestCandidatePair,
} from '@tzurot/common-types/services/recentDaysDigestSelection';
import {
  RECENT_DAYS_DIGEST,
  RECENT_DAYS_DIGEST_PROMPT_VERSION,
} from '@tzurot/common-types/constants/recentDaysDigest';

export interface DigestCandidatesOptions {
  env: Environment;
  limit?: number;
}

/** The design's spend rule (docs/proposals/backlog/recent-days-digest.md D8)
 *  multiplies pair count by this: the maximum regenerations a single pair
 *  can receive in a day under `MIN_REGEN_INTERVAL_MS`, not the sweep count. */
const MAX_REGENERATIONS_PER_PAIR_PER_DAY = Math.floor(
  (24 * 60 * 60_000) / RECENT_DAYS_DIGEST.MIN_REGEN_INTERVAL_MS
);
/** The design's G1/G2 daily-generation ceiling this report checks each candidate count against. */
const DAILY_GENERATION_CEILING = 1_440;
/** Rough per-generation token estimate for a pre-sweep spend check (not a billing figure). */
const ESTIMATED_TOKENS_PER_GENERATION = 2_000;

function formatTimestamp(value: Date | null): string {
  return value === null ? 'null' : value.toISOString();
}

function printCandidateLine(pair: DigestCandidatePair): void {
  console.log(
    `  ${pair.personaName} / ${pair.personalitySlug} — ` +
      `status=${pair.digestStatus ?? 'none'} attempts=${pair.digestAttempts ?? 0} ` +
      `watermark=${formatTimestamp(pair.sourceWatermark)} ` +
      `newest_row=${formatTimestamp(pair.newestRowAt)} ` +
      `generated_at=${formatTimestamp(pair.generatedAt)} ` +
      `requested_at=${formatTimestamp(pair.requestedAt)} ` +
      `window_rows=${pair.windowRowCount}`
  );
}

/** Reads `recentDaysDigestEnabled`/`recentDaysDigestPersonalities` the same
 *  way `summarize-sweep.ts` reads its own switches — via the service,
 *  reporting 'unavailable' rather than trusting the fallback constant
 *  silently when the settings row never loaded. */
async function readDigestSettings(
  prisma: PrismaClient
): Promise<{ loaded: boolean; enabled: boolean | null; personalitySlugs: string[] }> {
  const settings = new SystemSettingsService(prisma);
  await settings.prime();
  const loaded = settings.isLoaded();
  return {
    loaded,
    enabled: loaded ? settings.get('recentDaysDigestEnabled') : null,
    personalitySlugs: loaded ? settings.get('recentDaysDigestPersonalities') : [],
  };
}

/** Entry point for `pnpm ops digest:candidates`. */
export async function digestCandidates(options: DigestCandidatesOptions): Promise<void> {
  validateEnvironment(options.env);
  showEnvironmentBanner(options.env);

  const { prisma, disconnect } = await getPrismaForEnv(options.env);
  try {
    const { loaded, enabled, personalitySlugs } = await readDigestSettings(prisma);

    const limit = options.limit ?? RECENT_DAYS_DIGEST.MAX_GENERATIONS_PER_SWEEP;
    const pairs = await selectDigestCandidatePairs(prisma, {
      personalitySlugs,
      promptVersion: RECENT_DAYS_DIGEST_PROMPT_VERSION,
      limit,
    });

    console.log(chalk.bold('\nCandidates:'));
    if (pairs.length === 0) {
      console.log('  no candidates');
    } else {
      for (const pair of pairs) {
        printCandidateLine(pair);
      }
    }

    const dailyGenerations = pairs.length * MAX_REGENERATIONS_PER_PAIR_PER_DAY;
    const estimatedTokens = pairs.length * ESTIMATED_TOKENS_PER_GENERATION;
    console.log(chalk.bold('\nGates:'));
    console.log(
      `  ${pairs.length} pairs due now × ${MAX_REGENERATIONS_PER_PAIR_PER_DAY} regenerations/day max = ${dailyGenerations} vs ${DAILY_GENERATION_CEILING} ceiling (design G2 counts ACTIVE pairs in 7 days; this list is capped at --limit)`
    );
    console.log(
      `  estimate: ${pairs.length} pairs × ~2k tokens/generation ≈ ${estimatedTokens.toLocaleString()} tokens`
    );
    console.log(`  recentDaysDigestEnabled: ${loaded ? String(enabled) : 'unavailable'}`);
  } finally {
    await disconnect();
  }
}
