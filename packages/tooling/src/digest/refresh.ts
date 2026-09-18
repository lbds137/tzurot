/**
 * `pnpm ops digest:refresh` — force one (persona, personality) pair's digest
 * row back to `pending` with a fresh `requested_at`, bypassing the sweep's
 * routine regeneration interval; the next attempt consumes the stamp, success
 * or failure. `digest_text` is left untouched: the row stays readable until
 * the next sweep tick actually regenerates it, mirroring the `/history purge`
 * hook this command manually replays for one pair.
 */

import chalk from 'chalk';
import { UsageError } from '../utils/errors.js';
import { getPrismaForEnv } from '../memory/prisma-env.js';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { generatePersonaPersonalityDigestUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { RECENT_DAYS_DIGEST_STATUS } from '@tzurot/common-types/constants/recentDaysDigest';

export interface DigestRefreshOptions {
  env: Environment;
  personaId: string;
  personalitySlug: string;
  force?: boolean;
  dryRun?: boolean;
}

interface DigestRowSnapshot {
  digest_status: string | null;
  digest_attempts: number | null;
  requested_at: Date | null;
  generated_at: Date | null;
}

async function resolvePersonalityId(prisma: PrismaClient, slug: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM personalities WHERE slug = ${slug}
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new UsageError(`No personality found with slug '${slug}'`);
  }
  return row.id;
}

async function readRow(
  prisma: PrismaClient,
  personaId: string,
  personalityId: string
): Promise<DigestRowSnapshot | null> {
  const rows = await prisma.$queryRaw<DigestRowSnapshot[]>`
    SELECT digest_status, digest_attempts, requested_at, generated_at
    FROM persona_personality_digests
    WHERE persona_id = ${personaId}::uuid AND personality_id = ${personalityId}::uuid
  `;
  return rows[0] ?? null;
}

function printSnapshot(label: string, row: DigestRowSnapshot | null): void {
  if (row === null) {
    console.log(`  ${label}: (no row yet)`);
    return;
  }
  console.log(
    `  ${label}: status=${row.digest_status ?? 'none'} attempts=${row.digest_attempts ?? 0} ` +
      `requested_at=${row.requested_at?.toISOString() ?? 'null'} ` +
      `generated_at=${row.generated_at?.toISOString() ?? 'null'}`
  );
}

/** Entry point for `pnpm ops digest:refresh`. */
export async function digestRefresh(options: DigestRefreshOptions): Promise<void> {
  validateEnvironment(options.env);
  showEnvironmentBanner(options.env);

  const { prisma, disconnect } = await getPrismaForEnv(options.env);
  try {
    const personalityId = await resolvePersonalityId(prisma, options.personalitySlug);
    const before = await readRow(prisma, options.personaId, personalityId);

    console.log(chalk.bold('\nBefore:'));
    printSnapshot(options.personalitySlug, before);

    if (options.dryRun === true) {
      console.log(chalk.yellow('\nDry run — no write performed.'));
      console.log(
        `  Would set digest_status='${RECENT_DAYS_DIGEST_STATUS.PENDING}', requested_at=NOW() (digest_text left untouched)`
      );
      return;
    }

    if (options.env === 'prod' && options.force !== true) {
      await requireProductionConfirmation('force a recent-days digest refresh');
    }

    const id = generatePersonaPersonalityDigestUuid(options.personaId, personalityId);
    // This refresh does not itself reset digest_attempts. The sweep's failure
    // write (recordDigestFailure) restarts the count at 1 on a row whose
    // digest_status is 'pending' — the status set here — so the reset is
    // deferred to the next failed generation; a success write zeroes it.
    await prisma.$executeRaw`
      INSERT INTO persona_personality_digests
        (id, persona_id, personality_id, digest_status, requested_at, created_at, updated_at)
      VALUES (
        ${id}::uuid, ${options.personaId}::uuid, ${personalityId}::uuid,
        ${RECENT_DAYS_DIGEST_STATUS.PENDING}, NOW(), NOW(), NOW()
      )
      ON CONFLICT (persona_id, personality_id) DO UPDATE
        SET digest_status = ${RECENT_DAYS_DIGEST_STATUS.PENDING}, requested_at = NOW(), updated_at = NOW()
    `;

    const after = await readRow(prisma, options.personaId, personalityId);
    console.log(chalk.bold('\nAfter:'));
    printSnapshot(options.personalitySlug, after);
    console.log(
      chalk.green('\n✅ Refresh requested — the next sweep tick will regenerate this pair')
    );
  } finally {
    await disconnect();
  }
}
