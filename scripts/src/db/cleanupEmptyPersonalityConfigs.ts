/**
 * One-off cleanup of all-null UserPersonalityConfig anchor rows (dev + prod).
 *
 * The write-path prune (pruneEmptyPersonalityConfig, api-gateway) stops NEW
 * empty anchors from accumulating on every clear, and the account export
 * filters them — but rows emptied BEFORE that shipped still sit in the DB.
 * This deletes them once; the write path keeps it clean afterward.
 *
 * The WHERE mirrors api-gateway's EMPTY_SLICES_WHERE exactly, including
 * `Prisma.AnyNull` on the JSONB slice: clear paths write JSON null while a
 * never-set slice is SQL NULL — a plain `null` filter would miss cleared rows.
 *
 * Run: pnpm ops run --env <dev|prod> sh <wrapper>   (ops run eats bare flags;
 * wrap `tsx scripts/src/db/cleanupEmptyPersonalityConfigs.ts [--dry-run]` in a
 * flag-free shell script). Idempotent and re-runnable.
 * Delete after it has run against prod.
 */

import { Prisma, createPrismaClient } from '@tzurot/common-types/services/prisma';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';

const EMPTY_SLICES_WHERE = {
  personaId: null,
  llmConfigId: null,
  visionConfigId: null,
  ttsConfigId: null,
  configOverrides: { equals: Prisma.AnyNull },
};

async function main(): Promise<void> {
  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });

  try {
    const totalRows = await prisma.userPersonalityConfig.count();
    const emptyRows = await prisma.userPersonalityConfig.count({ where: EMPTY_SLICES_WHERE });

    console.log('=== EMPTY-ANCHOR CLEANUP PREVIEW ===');
    console.log('total UserPersonalityConfig rows: ', totalRows);
    console.log('all-null anchors (will delete):   ', emptyRows);
    console.log('live rows (untouched):            ', totalRows - emptyRows);

    if (process.argv.includes('--dry-run')) {
      console.log('=== DRY RUN — no writes ===');
      return;
    }

    const deleted = await prisma.userPersonalityConfig.deleteMany({
      where: EMPTY_SLICES_WHERE,
    });
    console.log(`deleted ${deleted.count} empty anchor rows`);
    console.log('=== DONE ===');
  } finally {
    await dispose();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
