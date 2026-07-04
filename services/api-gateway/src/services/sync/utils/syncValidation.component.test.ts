/**
 * Deterministic guard: `validateSyncConfig` must produce ZERO warnings against the
 * live (PGLite) schema.
 *
 * This turns the existing RUNTIME "table/UUID-column not in SYNC_CONFIG" warning — which
 * only surfaces when someone actually runs `/admin db-sync` — into a BUILD-TIME failure.
 * A migration that adds a table or a UUID FK column without updating `syncTables.ts`
 * (SYNC_CONFIG / EXCLUDED_TABLES / uuidColumns) now fails CI instead of silently
 * warning later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
import { validateSyncConfig } from './syncValidation.js';
import { SYNC_CONFIG } from '../config/syncTables.js';

describe('syncValidation guard — SYNC_CONFIG covers the live schema', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  // No setupTestEnvironment(): validateSyncConfig only queries
  // information_schema over PGLite — it has zero Redis/env dependency.
  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('produces no warnings — every table is categorized and every UUID FK is in uuidColumns', async () => {
    const { warnings, info } = await validateSyncConfig(prisma, SYNC_CONFIG);
    // A failure here means a migration added a table or UUID FK column that
    // syncTables.ts doesn't account for — OR left a phantom EXCLUDED_TABLES entry
    // (a table dropped from the schema but not from the exclusion list), which
    // validateSyncConfig now reports as a warning. Fix: categorize the table in
    // SYNC_CONFIG or EXCLUDED_TABLES, add the UUID FK column to `uuidColumns`, or
    // remove the stale exclusion.
    expect(
      warnings,
      `syncTables.ts is out of sync with the schema:\n  ${warnings.join('\n  ')}`
    ).toEqual([]);
    // `info` carries one line per EXCLUDED_TABLES entry that still exists in the
    // schema. A non-empty array confirms the exclusion list isn't ENTIRELY phantom;
    // individual phantom entries are caught by the zero-warnings assertion above.
    expect(info.length).toBeGreaterThan(0);
  });
});
