/**
 * Export-smoke validator — shared type declarations.
 *
 * These live in their own module rather than beside the orchestrator because
 * every check module needs them while the orchestrator imports every check
 * module. Declaring them in `exportSmokeValidator.ts` made each check module
 * import the orchestrator for its types, which is a genuine import cycle
 * (`no-circular-dependencies` in dependency-cruiser flags it even for
 * type-only edges). A leaf type module is the acyclic shape.
 */

import type { z } from 'zod';
import type { ExportSmokeExpectedCountsSchema } from '@tzurot/common-types/schemas/api/internal';
import type { PersonalityDirectorySchema } from '@tzurot/common-types/schemas/export/accountExportCoreSchemas';

/**
 * The source-DB snapshot the gateway's export-smoke start route returns.
 * Derived from the wire schema rather than re-declared, so a schema change
 * breaks compilation here instead of drifting silently.
 */
export type ExportSmokeExpectedCounts = z.infer<typeof ExportSmokeExpectedCountsSchema>;

/** Parsed `personality-directory.json` — the id → name/slug map. */
export type PersonalityDirectoryEntries = z.infer<typeof PersonalityDirectorySchema>;

export interface ExportValidationResult {
  ok: boolean;
  /**
   * Check name + path only, never exported file content — these are rendered
   * into an owner-channel embed and written to logs.
   */
  findings: string[];
}
