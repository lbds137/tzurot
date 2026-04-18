#!/usr/bin/env tsx
/**
 * Data Migration: Repair non-RFC-4122 `llm_configs.id` values
 *
 * Symptom this repair fixes:
 *   /settings preset default → "❌ Failed to set default: configId: Invalid configId format"
 *
 * Background:
 *   Four llm_configs rows in production have `id` values that Postgres accepts
 *   (the `uuid` column type validates format only) but that fail Zod's
 *   `.uuid()` check (which enforces RFC 4122's variant-bit rule — the 17th
 *   hex digit must be 8/9/a/b). When one of these ids is submitted as a
 *   config override, SetDefaultConfigSchema.configId rejects it.
 *
 *   The full audit across 65 uuid columns × 202K rows showed exactly 8
 *   violations, all originating from these 4 rows (+ 4 FK references in
 *   users.default_llm_config_id that CASCADE-update when the config id
 *   changes). No code path in the current codebase produces non-RFC UUIDs
 *   — all app inserts route through `generateLlmConfigUuid` (v5) or
 *   Prisma's built-in UUID default (v4), both RFC-compliant. These 4
 *   rows were inserted via some out-of-band path (manual, one-off script,
 *   Prisma Studio) on 2025-11-28 and the history is not recoverable.
 *
 * Fix shape:
 *   For each row, compute the canonical id via `generateLlmConfigUuid(name)`
 *   and UPDATE the row's id to that value. The users↔llm_configs FK has
 *   ON UPDATE CASCADE, so the 4 dependent users.default_llm_config_id
 *   references auto-repair.
 *
 * Run:
 *   DRY_RUN=1 pnpm tsx scripts/migrations/repair-llm-config-rfc-uuids.ts
 *   pnpm tsx scripts/migrations/repair-llm-config-rfc-uuids.ts
 *
 * Against prod:
 *   DRY_RUN=1 pnpm ops run --env prod pnpm tsx scripts/migrations/repair-llm-config-rfc-uuids.ts
 *   pnpm ops run --env prod pnpm tsx scripts/migrations/repair-llm-config-rfc-uuids.ts
 *
 * (Env var instead of --dry-run because `pnpm ops run` parses arg flags
 * as its own options and swallows them before they reach this script.)
 */

/* eslint-disable no-console -- this is a CLI migration script */

import { generateLlmConfigUuid, getPrismaClient } from '@tzurot/common-types';

// RFC 4122 variant nibble: the 13th hex digit (character index 19 when
// dashes are counted). Must be 8, 9, a, or b — anything else is non-RFC.
const RFC_VARIANT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Mapping {
  oldId: string;
  newId: string;
  name: string;
  collision: boolean;
}

async function main(): Promise<void> {
  // Env var instead of flag because `pnpm ops run` consumes positional
  // `--` options as its own flags. See the file header for invocation.
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const prisma = getPrismaClient();

  // Single try/finally so the Prisma connection is released on every exit
  // path — including `process.exit(1)` from the collision branch and any
  // throw from the `$transaction` callback. For a one-shot script the
  // process-exit-free-all story covers this, but it's cheap guardrail.
  try {
    console.log(`\n🚀 Repairing non-RFC-4122 llm_configs ids${dryRun ? ' (DRY RUN)' : ''}\n`);

    // Find offenders. Uses the same variant-bit heuristic as the Zod schema
    // they were failing against. No `take` limit: this migration must see
    // ALL rows to compute the complete diff — the 03-database.md bounded-
    // query rule is a general guardrail; migrations and repair scripts
    // that inherently need full-table scans are the exception.
    const all = await prisma.llmConfig.findMany({
      select: { id: true, name: true },
    });
    const offenders = all.filter(c => !RFC_VARIANT_RE.test(c.id));
    console.log(`📊 Scanned ${all.length} configs; ${offenders.length} offenders\n`);

    if (offenders.length === 0) {
      console.log('✅ Nothing to repair.');
      return;
    }

    // Compute the canonical id for each. Check for collision: if a DIFFERENT
    // existing row already has the canonical id, we cannot repair this one
    // without further data work (it would imply two rows with the same name).
    // Expected: no collisions, because the offenders are the only rows with
    // these names.
    const existingIds = new Set(all.map(c => c.id));
    const mappings: Mapping[] = offenders.map(c => {
      const newId = generateLlmConfigUuid(c.name);
      return {
        oldId: c.id,
        newId,
        name: c.name,
        // Collision is only real if the canonical id exists on a *different*
        // row. If the offender somehow already has the canonical id (can't
        // happen here — they'd have RFC variant bits then — but defense in
        // depth), skip it.
        collision: existingIds.has(newId) && newId !== c.id,
      };
    });

    console.log('📝 Planned repairs:\n');
    for (const m of mappings) {
      const marker = m.collision ? '⚠️  COLLISION' : '  ';
      console.log(`${marker}  ${m.name}`);
      console.log(`      old: ${m.oldId}`);
      console.log(`      new: ${m.newId}`);
    }
    console.log('');

    const collisions = mappings.filter(m => m.collision);
    if (collisions.length > 0) {
      console.error(
        `❌ ${collisions.length} collision(s) detected. Aborting. ` +
          `Another row already holds the canonical id for these names. ` +
          `This probably means two configs share a name — resolve by hand first.`
      );
      process.exitCode = 1;
      return;
    }

    if (dryRun) {
      console.log('🔍 Dry run — no changes made. Re-run without DRY_RUN to apply.');
      return;
    }

    // Apply in one transaction so all 4 updates commit atomically (or none do).
    // The users.default_llm_config_id FK has ON UPDATE CASCADE, so Postgres
    // propagates the new id to dependent rows within the same transaction.
    //
    // `$executeRawUnsafe` is safe here: values flow through positional
    // parameters ($1/$2), never string-interpolated into the SQL. We can't
    // use `$executeRaw` (tagged template) because Prisma strips the
    // `::uuid` casts, and Postgres requires explicit casts when binding
    // strings to uuid columns via the raw protocol.
    console.log('✏️  Applying...\n');
    await prisma.$transaction(async tx => {
      for (const m of mappings) {
        await tx.$executeRawUnsafe(
          `UPDATE "llm_configs" SET "id" = $1::uuid WHERE "id" = $2::uuid`,
          m.newId,
          m.oldId
        );
        console.log(`  ✓ ${m.name}`);
      }
    });

    // Verify post-repair. Same full-table-scan rationale as the pre-scan.
    const after = await prisma.llmConfig.findMany({ select: { id: true } });
    const stillBad = after.filter(c => !RFC_VARIANT_RE.test(c.id));
    console.log(`\n🔎 Post-repair audit: ${after.length} configs, ${stillBad.length} offenders`);
    if (stillBad.length > 0) {
      console.error(`❌ Repair incomplete — ${stillBad.length} offenders remain.`);
      process.exitCode = 1;
    } else {
      console.log('✅ All llm_configs ids are now RFC 4122 compliant.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
