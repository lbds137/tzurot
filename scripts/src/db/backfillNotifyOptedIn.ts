/**
 * One-off backfill for the release-DM eligibility fix (blast-radius correction).
 *
 * Two data corrections, both idempotent and re-runnable:
 *   1. Migrate EVERY existing user to notifyLevel = 'major' (owner decision —
 *      conservative reset so only breaking releases DM by default; the schema
 *      default is now 'major' for new users).
 *   2. Stamp notifyOptedInAt = now() for users with EVIDENCE OF DELIBERATE USE
 *      who have NOT opted out. Evidence = a UsageLog (a real generation), BYOK
 *      setup (UserApiKey / UserCredential), or an explicitly adjusted
 *      notifyLevel (anything != 'minor', the pre-fix default — the
 *      /notifications PATCH route is the only writer, so a non-default value
 *      proves the user ran the command before the forward-path stamp shipped).
 *      NOT persona ownership — default personas are auto-created on
 *      provisioning, so every passive extended-context bystander has one.
 *
 * Opted-out users (notifyEnabled = false) are never touched. Passive bystanders
 * (no usage/BYOK/prefs evidence) stay notifyOptedInAt = null and are excluded
 * from every future blast by the eligibility gate.
 *
 * NOTE: the level reset (step 1) runs AFTER the evidence query — the query
 * reads notifyLevel != 'minor' as evidence, which the reset erases.
 *
 * Run: pnpm ops run --env <dev|prod> tsx scripts/src/db/backfillNotifyOptedIn.ts [--dry-run]
 * Delete after it has run against prod.
 */

import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';

/** Matches the preview query's take — far above prod scale (~hundreds). */
const PREVIEW_CAP = 100_000;

async function main(): Promise<void> {
  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });

  try {
    const totalUsers = await prisma.user.count();
    const optedOut = await prisma.user.count({ where: { notifyEnabled: false } });

    // Preview: how many users have deliberate-use evidence and haven't opted out.
    const eligible = await prisma.user.findMany({
      where: {
        notifyEnabled: true,
        notifyOptedInAt: null,
        OR: [
          { usageLogs: { some: {} } },
          { apiKeys: { some: {} } },
          { credentials: { some: {} } },
          { notifyLevel: { not: 'minor' } },
        ],
      },
      select: { id: true },
      take: PREVIEW_CAP,
    });

    console.log('=== BACKFILL PREVIEW ===');
    console.log('total users:              ', totalUsers);
    console.log('opted out (untouched):    ', optedOut);
    console.log('will get notifyOptedInAt: ', eligible.length);
    console.log('will stay null (passive): ', totalUsers - optedOut - eligible.length);
    if (eligible.length === PREVIEW_CAP) {
      console.warn(
        `WARNING: eligible set hit the ${PREVIEW_CAP} preview cap — results may be truncated; re-run after this pass to catch the remainder.`
      );
    }

    if (process.argv.includes('--dry-run')) {
      console.log('=== DRY RUN — no writes ===');
      return;
    }

    // 1. Stamp the opted-in timestamp for the evidence-bearing set (before the
    //    level reset erases the notifyLevel evidence).
    const ids = eligible.map(u => u.id);
    let stamped = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const batch = ids.slice(i, i + 1000);
      const res = await prisma.user.updateMany({
        where: { id: { in: batch }, notifyOptedInAt: null },
        data: { notifyOptedInAt: new Date() },
      });
      stamped += res.count;
    }
    console.log(`stamped notifyOptedInAt for ${stamped} deliberate-use users`);

    // 2. Everyone → major.
    const leveled = await prisma.user.updateMany({ data: { notifyLevel: 'major' } });
    console.log(`migrated ${leveled.count} users to notifyLevel=major`);
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
