/**
 * Export-path smoke artifact validator.
 *
 * Pure structural/content validator for a finished account-export ZIP
 * artifact, checked against `ExportSmokeExpectedCounts` — the source-DB
 * row-count snapshot the gateway's `/internal/export-smoke/start` response
 * carries. No network, no filesystem, no Discord: the artifact bytes and the
 * expected-counts payload are the only inputs, so this module is
 * unit-testable in isolation and safe to run from the scheduler's poll loop.
 *
 * The check sequence mirrors the ZIP's own layers: open the archive, parse
 * the personality directory (the id→slug lookup every foldered-section check
 * depends on), check manifest completeness against the directory, validate
 * every `.json` file against its Part-A content schema, check every `.md`
 * file is non-empty, then — only when the directory parsed — check id
 * consistency and row counts. A directory failure skips the manifest and id
 * checks (they have no id→slug lookup to run against) but the schema and
 * `.md` checks still run, since those don't depend on the directory.
 *
 * SECURITY: findings NEVER carry exported file content. A finding is a check
 * name, a file path, a count, or a structural id (personalityId) — never a
 * parsed value, a Zod issue's received/input value, raw file text, or any
 * user text (persona names, message content, memory text, usernames).
 * Findings reach a Discord embed and logs, both of which must never carry
 * account content.
 */

import { unzipSync } from 'fflate';
import { validateManifest } from './exportSmokeManifestChecks.js';
import { validateJsonAndMdFiles } from './exportSmokeSchemaChecks.js';
import { validateIdsAndCounts } from './exportSmokeCountChecks.js';
import type { ExportSmokeExpectedCounts, ExportValidationResult } from './exportSmokeTypes.js';

// Re-exported so callers keep importing the validator's own types from the
// module whose function they call; the declarations live in the leaf type
// module to keep the check modules from importing this orchestrator.
export type { ExportSmokeExpectedCounts, ExportValidationResult };

/**
 * Validate a finished export artifact against the expected-counts snapshot.
 * Never throws — `unzipSync` throwing on corrupt or empty input is caught
 * and reported as a finding instead.
 */
export function validateExportArtifact(
  zipBytes: Uint8Array,
  expectedCounts: ExportSmokeExpectedCounts
): ExportValidationResult {
  const findings: string[] = [];

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch {
    // Both corrupt and empty input throw the same plain `Error('invalid zip
    // data')` — no further check can run without a parsed archive.
    return { ok: false, findings: ['zip: archive could not be opened'] };
  }

  const { directory } = validateManifest(files, expectedCounts, findings);
  validateJsonAndMdFiles(files, findings);
  if (directory !== null) {
    validateIdsAndCounts(files, directory, expectedCounts, findings);
  }

  return { ok: findings.length === 0, findings };
}
