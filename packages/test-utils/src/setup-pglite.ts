/**
 * PGLite Schema Utilities
 *
 * Provides helpers for loading and initializing PGLite schema for integration tests.
 *
 * PGLite Schema Management:
 * - Schema SQL is auto-generated from Prisma using `prisma migrate diff`
 * - Stored in packages/test-utils/schema/pglite-schema.sql
 * - Regenerate with: ./scripts/testing/regenerate-pglite-schema.sh
 * - This ensures PGLite always matches the current Prisma schema
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Detect if we're running in CI (GitHub Actions)
 * NOTE: Pre-push hook sets CI=true, but we only want real Redis/Postgres in actual CI
 */
export function isCI(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

// Get the directory of this file for resolving the schema path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the pre-generated PGLite schema SQL.
 * This SQL is generated from Prisma schema using `prisma migrate diff`.
 * Regenerate with: ./scripts/testing/regenerate-pglite-schema.sh
 */
export function loadPGliteSchema(): string {
  const schemaPath = join(__dirname, '../schema/pglite-schema.sql');
  try {
    return readFileSync(schemaPath, 'utf-8');
  } catch {
    throw new Error(
      `Failed to load PGLite schema from ${schemaPath}. ` +
        `Run ./scripts/testing/regenerate-pglite-schema.sh to generate it.`
    );
  }
}

/**
 * Initialize PGlite with the schema from Prisma.
 * Uses pre-generated SQL to ensure schema is always in sync with prisma/schema.prisma.
 */
export async function initializePGliteSchema(pglite: PGlite): Promise<void> {
  const schemaSql = loadPGliteSchema();

  // Execute the entire SQL as one block - pglite.exec() handles multi-statement SQL
  // Do NOT split by semicolons as that breaks statements with embedded semicolons
  // Note: CREATE EXTENSION is included in the SQL and works with PGLite when the
  // extension is loaded via JS constructor (extensions: { vector })
  try {
    await pglite.exec(schemaSql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize PGLite schema: ${message}`);
  }
}
