/**
 * One-off flip of misclassified release-DM delivery rows: discord-50278
 * ("no mutual guilds") was bucketed failed_transient before the classifier
 * fix landed; the durable reality is failed_permanent.
 *
 * Why flip instead of waiting: maybeAutoDisable reads only the user's most
 * recent non-pending row, so a failed_transient row RESETS the two-permanent
 * auto-disable streak. Left alone, each affected user eats one guaranteed-fail
 * DM attempt per release for two more releases before quiescing; flipped, the
 * next release's (permanent) failure lands on a permanent predecessor and
 * auto-disables immediately.
 *
 * Idempotent and re-runnable: the WHERE matches only rows still marked
 * failed_transient with the old 'discord-50278' errorCode. The errorCode is
 * kept as-is ('discord-50278', not '50278') so the flipped rows remain
 * distinguishable from organically-classified permanents in the ledger.
 *
 * Run: pnpm ops run --env <dev|prod> tsx scripts/src/db/flipTransient50278.ts [--dry-run]
 * Delete after it has run against prod (rides the one-off-script cleanup PR).
 */

import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';

async function main(): Promise<void> {
  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });

  try {
    const candidates = await prisma.releaseDeliveryLog.findMany({
      where: { status: 'failed_transient', errorCode: 'discord-50278' },
      select: { id: true, userId: true, releaseId: true },
      take: 10_000,
    });
    const distinctUsers = new Set(candidates.map(row => row.userId)).size;

    console.log('=== FLIP PREVIEW ===');
    console.log('failed_transient discord-50278 rows:', candidates.length);
    console.log('distinct users affected:            ', distinctUsers);

    if (process.argv.includes('--dry-run')) {
      console.log('=== DRY RUN — no writes ===');
      return;
    }

    const flipped = await prisma.releaseDeliveryLog.updateMany({
      where: { status: 'failed_transient', errorCode: 'discord-50278' },
      data: { status: 'failed_permanent' },
    });
    console.log(`flipped ${flipped.count} rows to failed_permanent`);
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
