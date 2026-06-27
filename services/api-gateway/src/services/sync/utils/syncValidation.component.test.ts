/**
 * Deterministic guard: `validateSyncConfig` must produce ZERO warnings against the
 * live (PGLite) schema.
 *
 * This turns the existing RUNTIME "table/UUID-column not in SYNC_CONFIG" warning — which
 * only surfaces when someone actually runs `/admin db-sync` — into a BUILD-TIME failure.
 * A migration that adds a table or a UUID FK column without updating `syncTables.ts`
 * (SYNC_CONFIG / EXCLUDED_TABLES / uuidColumns) now fails CI instead of silently
 * warning later. The beta.140 `vision_config_kind` migration shipped exactly this class
 * of gap (an uncategorized `personality_vision_default_configs` table + two new
 * `*_vision_config_id` UUID FKs); this guard would have caught it at build time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@tzurot/common-types';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, setupTestEnvironment, loadPGliteSchema } from '@tzurot/test-utils';
import { validateSyncConfig } from './syncValidation.js';
import { SYNC_CONFIG } from '../config/syncTables.js';

describe('syncValidation guard — SYNC_CONFIG covers the live schema', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    setupTestEnvironment();
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('produces no warnings — every table is categorized and every UUID FK is in uuidColumns', async () => {
    const { warnings } = await validateSyncConfig(prisma, SYNC_CONFIG);
    // A failure here means a migration added a table or UUID FK column that
    // syncTables.ts doesn't account for. Fix: categorize the table in SYNC_CONFIG or
    // EXCLUDED_TABLES, or add the UUID FK column to that table's `uuidColumns`.
    expect(
      warnings,
      `syncTables.ts is out of sync with the schema:\n  ${warnings.join('\n  ')}`
    ).toEqual([]);
  });
});
