/**
 * Align migration-seeded BYOK TTS config rows to deterministic UUIDs.
 *
 * Targets rows created by migration `20260502185237_add_tts_configs_cascade`
 * (lines 145-160) — the one-shot data seed that auto-migrated users with
 * legacy `elevenlabsTtsModel` JSONB to dedicated tts_configs rows named
 * `tts-byok-{discordId}`. Each env ran the migration independently with
 * `gen_random_uuid()`, so dev and prod ended up with different IDs for
 * the same logical row → /admin db-sync collision on
 * `tts_configs_owner_id_name_key`.
 *
 * This script is idempotent: rows already at the deterministic UUID are
 * skipped. Safe to run multiple times. ON UPDATE CASCADE on every FK to
 * tts_configs.id propagates the id change automatically (verified in
 * PR #969's int-test suite).
 *
 * Why a script instead of a SQL migration:
 * - `uuid-ossp` is not enabled in the codebase or pglite, so per-row
 *   uuidv5 computation in SQL would require new infrastructure.
 * - Future fresh DBs don't have these rows (the migration's WHERE clause
 *   only fires for users with legacy JSONB), so no migration-history
 *   tracking is needed.
 * - Strong precedent: `scripts/src/db/fix-phantom-migration.ts` uses the
 *   same one-shot ops-script pattern for data fixes.
 *
 * Run via:
 *   pnpm ops run --env dev tsx scripts/src/align-byok-tts-configs.ts
 *   pnpm ops run --env prod --force tsx scripts/src/align-byok-tts-configs.ts
 */
import { getPrismaClient, disconnectPrisma, generateByokTtsConfigUuid } from '@tzurot/common-types';

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const TAKE_LIMIT = 10_000;
    const rows = await prisma.ttsConfig.findMany({
      where: {
        name: { startsWith: 'tts-byok-' },
        // Explicit guard — system-globals (isGlobal: true) are aligned by
        // migration 20260504140720 from PR #969 and never have a name
        // starting with `tts-byok-` anyway. Belt-and-suspenders.
        isGlobal: false,
      },
      select: { id: true, ownerId: true, name: true, provider: true },
      // Bounded per `03-database.md` (CRITICAL rule). Real-world expected
      // row count is one per BYOK user — even at scale this should never
      // approach 10k. Sentinel below catches a runaway count before silent
      // truncation.
      take: TAKE_LIMIT,
    });
    if (rows.length === TAKE_LIMIT) {
      throw new Error(
        `Hit findMany take limit (${TAKE_LIMIT}) — re-run after investigating row count`
      );
    }

    console.log(`Found ${rows.length} tts-byok-* rows`);

    // Wrapped in a transaction so a mid-run failure rolls back partial
    // updates. Idempotency makes re-running safe regardless, but atomicity
    // means an inspector after a failure shows the pre-run state, not a
    // confusing mix.
    const { updated, skipped } = await prisma.$transaction(async tx => {
      let updated = 0;
      let skipped = 0;
      for (const row of rows) {
        const targetId = generateByokTtsConfigUuid(row.ownerId, row.provider);
        if (row.id === targetId) {
          skipped++;
          continue;
        }
        // Parameterized via Prisma's tagged-template raw SQL — both targetId
        // and row.id are bind parameters, not string-interpolated.
        await tx.$executeRaw`
          UPDATE "tts_configs"
          SET "id" = ${targetId}::uuid,
              "updated_at" = NOW()
          WHERE "id" = ${row.id}::uuid
        `;
        console.log(
          `  ${row.name}: ${row.id.slice(0, 8)} → ${targetId.slice(0, 8)} (provider=${row.provider})`
        );
        updated++;
      }
      return { updated, skipped };
    });

    console.log(`\nUpdated: ${updated}; already aligned: ${skipped}`);
  } finally {
    await disconnectPrisma();
  }
}

await main();
