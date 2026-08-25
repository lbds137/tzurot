/**
 * Export-smoke validator — directory parsing + manifest completeness.
 *
 * Split out of `exportSmokeValidator.ts` to stay under the ESLint
 * `max-lines` budget. See that module's docstring for the SECURITY
 * constraint on findings (never exported file content).
 */

import {
  buildExpectedExportManifest,
  resolveExportSchemaForPath,
} from '@tzurot/common-types/schemas/export/accountExportManifest';
import { PersonalityDirectorySchema } from '@tzurot/common-types/schemas/export/accountExportCoreSchemas';
import type { ExportSmokeExpectedCounts, PersonalityDirectoryEntries } from './exportSmokeTypes.js';

export type { PersonalityDirectoryEntries };

const DIRECTORY_PATH = 'personality-directory.json';

/** Fixed `.md` paths that have no per-section `.json` counterpart to derive from. */
const FIXED_MD_PATHS = new Set(['README.md', 'profile.md', 'feedback.md', 'usage-summary.md']);

/** Per-entity folders — every file under these must be individually expected. */
const PER_ENTITY_PREFIXES = ['personas/', 'characters/', 'conversations/', 'memories/', 'facts/'];

function isKnownMdPath(path: string): boolean {
  return FIXED_MD_PATHS.has(path);
}

/**
 * A path this validator recognizes as a legitimate export artifact member.
 *
 * Per-entity files (persona/character/foldered-section) are recognized ONLY
 * by exact membership in the expected manifest: prefix- or schema-based
 * recognition would accept a file for an entity the source snapshot says has
 * zero rows — or doesn't contain at all — letting an assembler that emits
 * (or fails to prune) such a file pass the smoke silently. The schema/md
 * fallbacks below apply only to fixed paths, where they exist so a path with
 * its own dedicated finding (e.g. the forbidden superuser-only file) isn't
 * double-reported as "unexpected" too.
 */
function isRecognizedPath(path: string, required: readonly string[]): boolean {
  if (required.includes(path)) {
    return true;
  }
  if (PER_ENTITY_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return false;
  }
  return resolveExportSchemaForPath(path) !== undefined || isKnownMdPath(path);
}

/**
 * Parses and validates `personality-directory.json`, then — only on success
 * — checks manifest completeness (required paths present, forbidden paths
 * absent, every archive path recognized) against it. Appends findings to the
 * shared `findings` array; returns the parsed directory (or `null` on any
 * directory-stage failure) so the caller can skip id/count checks that have
 * no directory to resolve against.
 */
export function validateManifest(
  files: Record<string, Uint8Array>,
  expectedCounts: ExportSmokeExpectedCounts,
  findings: string[]
): { directory: PersonalityDirectoryEntries | null } {
  const directoryBytes = files[DIRECTORY_PATH];
  if (directoryBytes === undefined) {
    findings.push(`manifest: ${DIRECTORY_PATH} is missing`);
    return { directory: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(directoryBytes));
  } catch {
    findings.push(`manifest: ${DIRECTORY_PATH} failed to parse`);
    return { directory: null };
  }

  const result = PersonalityDirectorySchema.safeParse(parsed);
  if (!result.success) {
    findings.push(`manifest: ${DIRECTORY_PATH} failed schema validation`);
    return { directory: null };
  }
  const directory = result.data;

  const manifest = buildExpectedExportManifest({
    directory,
    personas: expectedCounts.personas,
    characters: expectedCounts.characters,
    conversationCountsByPersonalityId: expectedCounts.conversationCountsByPersonalityId,
    memoryCountsByPersonalityId: expectedCounts.memoryCountsByPersonalityId,
    factCountsByPersonalityId: expectedCounts.factCountsByPersonalityId,
    isSuperuser: expectedCounts.isSuperuser,
  });

  for (const requiredPath of manifest.required) {
    if (files[requiredPath] === undefined) {
      findings.push(`manifest: required path missing — ${requiredPath}`);
    }
  }
  for (const forbiddenPath of manifest.forbidden) {
    if (files[forbiddenPath] !== undefined) {
      findings.push(`manifest: forbidden path present — ${forbiddenPath}`);
    }
  }
  for (const archivePath of Object.keys(files)) {
    if (!isRecognizedPath(archivePath, manifest.required)) {
      findings.push(`manifest: unexpected file in archive — ${archivePath}`);
    }
  }

  return { directory };
}
