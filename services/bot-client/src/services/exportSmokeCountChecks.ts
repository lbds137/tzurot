/**
 * Export-smoke validator — id consistency + row-count checks.
 *
 * Split out of `exportSmokeValidator.ts` to stay under the ESLint
 * `max-lines` budget. Runs only when the personality directory parsed
 * successfully (the caller gates this) — every check here resolves a
 * personalityId through the directory's id→slug map. See
 * `exportSmokeValidator.ts`'s docstring for the SECURITY constraint on
 * findings (never exported file content).
 *
 * Two different personalityIds can sanitize to the same stem (a slug
 * collision) — `sanitizeExportFileStem` is many-to-one. Every id-consistency
 * check below resolves a stem through the SPECIFIC directory entry matching
 * a row's own personalityId, never by re-deriving the stem and assuming a
 * 1:1 map back to a single id.
 */

import {
  folderedStem,
  sanitizeExportFileStem,
} from '@tzurot/common-types/schemas/export/accountExportManifest';
import type { ExportSmokeExpectedCounts, PersonalityDirectoryEntries } from './exportSmokeTypes.js';

const decoder = new TextDecoder();
const FOLDERED_SECTIONS = ['conversations', 'memories', 'facts'] as const;
type FolderedSection = (typeof FOLDERED_SECTIONS)[number];

function tryParseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

function checkCountMapIdsInDirectory(
  directory: PersonalityDirectoryEntries,
  expectedCounts: ExportSmokeExpectedCounts,
  findings: string[]
): void {
  const maps = [
    expectedCounts.conversationCountsByPersonalityId,
    expectedCounts.memoryCountsByPersonalityId,
    expectedCounts.factCountsByPersonalityId,
  ];
  const seen = new Set<string>();
  for (const map of maps) {
    for (const personalityId of Object.keys(map)) {
      if (seen.has(personalityId)) {
        continue;
      }
      seen.add(personalityId);
      if (!directory.some(entry => entry.id === personalityId)) {
        findings.push(
          `id: personalityId ${personalityId} from the count snapshot is not in the directory`
        );
      }
    }
  }
}

function hasStringField(row: unknown, field: string): row is Record<string, string> {
  return (
    typeof row === 'object' &&
    row !== null &&
    field in row &&
    typeof (row as Record<string, unknown>)[field] === 'string'
  );
}

function checkFolderedRowIds(
  files: Record<string, Uint8Array>,
  directory: PersonalityDirectoryEntries,
  folder: FolderedSection,
  findings: string[]
): void {
  const prefix = `${folder}/`;
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) {
      continue;
    }
    const stem = path.slice(prefix.length, -'.json'.length);
    const parsed = tryParseJson(bytes);
    if (!Array.isArray(parsed)) {
      continue;
    }
    for (const row of parsed) {
      if (!hasStringField(row, 'personalityId')) {
        continue;
      }
      const personalityId = row.personalityId;
      const entry = directory.find(item => item.id === personalityId);
      if (entry === undefined) {
        findings.push(`id: ${path} contains a row whose personalityId is not in the directory`);
      } else if (sanitizeExportFileStem(entry.slug) !== stem) {
        findings.push(`id: ${path} contains a row whose personalityId maps to a different stem`);
      }
    }
  }
}

function checkCharacterRowIds(files: Record<string, Uint8Array>, findings: string[]): void {
  const prefix = 'characters/';
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) {
      continue;
    }
    const stem = path.slice(prefix.length, -'.json'.length);
    const row = tryParseJson(bytes);
    if (!hasStringField(row, 'slug')) {
      continue;
    }
    if (sanitizeExportFileStem(row.slug) !== stem) {
      findings.push(`id: ${path} slug does not sanitize to its own filename stem`);
    }
  }
}

function checkPersonaRowIds(files: Record<string, Uint8Array>, findings: string[]): void {
  const prefix = 'personas/';
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith(prefix) || !path.endsWith('.json')) {
      continue;
    }
    const stem = path.slice(prefix.length, -'.json'.length);
    const row = tryParseJson(bytes);
    if (!hasStringField(row, 'id') || !hasStringField(row, 'name')) {
      continue;
    }
    // lastIndexOf, not indexOf: persona NAMES may themselves contain hyphens,
    // but the 8-char id token is always appended last — so the final hyphen
    // is the only reliable name/id boundary.
    const lastDash = stem.lastIndexOf('-');
    if (lastDash === -1) {
      findings.push(`id: ${path} filename stem is not in the '<name>-<idPrefix>' shape`);
      continue;
    }
    const namePart = stem.slice(0, lastDash);
    const idPart = stem.slice(lastDash + 1);
    if (idPart !== row.id.slice(0, 8) || namePart !== sanitizeExportFileStem(row.name)) {
      findings.push(`id: ${path} filename stem does not match its own row's id/name`);
    }
  }
}

function checkTotalCount(
  files: Record<string, Uint8Array>,
  prefix: string,
  expectedTotal: number,
  findings: string[]
): void {
  const actual = Object.keys(files).filter(
    path => path.startsWith(prefix) && path.endsWith('.json')
  ).length;
  if (actual !== expectedTotal) {
    findings.push(
      `counts: ${prefix}*.json file count expected ${String(expectedTotal)} got ${String(actual)}`
    );
  }
}

function checkFolderedCounts(
  files: Record<string, Uint8Array>,
  directory: PersonalityDirectoryEntries,
  folder: FolderedSection,
  countsByPersonalityId: Readonly<Record<string, number>>,
  findings: string[]
): void {
  const expectedSumByStem = new Map<string, number>();
  for (const [personalityId, count] of Object.entries(countsByPersonalityId)) {
    if (count <= 0) {
      continue;
    }
    const stem = folderedStem(directory, personalityId);
    expectedSumByStem.set(stem, (expectedSumByStem.get(stem) ?? 0) + count);
  }

  for (const [stem, expectedSum] of expectedSumByStem) {
    const path = `${folder}/${stem}.json`;
    const bytes = files[path];
    if (bytes === undefined) {
      // Already reported as a missing required path by the manifest check.
      continue;
    }
    const parsed = tryParseJson(bytes);
    if (!Array.isArray(parsed)) {
      // Already reported by the json-parse/schema checks.
      continue;
    }
    if (parsed.length !== expectedSum) {
      findings.push(
        `counts: ${path} expected ${String(expectedSum)} rows, got ${String(parsed.length)}`
      );
    }
  }
}

/** Runs every id-consistency and row-count check against the parsed directory. */
export function validateIdsAndCounts(
  files: Record<string, Uint8Array>,
  directory: PersonalityDirectoryEntries,
  expectedCounts: ExportSmokeExpectedCounts,
  findings: string[]
): void {
  checkCountMapIdsInDirectory(directory, expectedCounts, findings);
  for (const folder of FOLDERED_SECTIONS) {
    checkFolderedRowIds(files, directory, folder, findings);
  }
  checkCharacterRowIds(files, findings);
  checkPersonaRowIds(files, findings);

  checkTotalCount(files, 'personas/', expectedCounts.totals.personas, findings);
  checkTotalCount(files, 'characters/', expectedCounts.totals.characters, findings);
  checkFolderedCounts(
    files,
    directory,
    'conversations',
    expectedCounts.conversationCountsByPersonalityId,
    findings
  );
  checkFolderedCounts(
    files,
    directory,
    'memories',
    expectedCounts.memoryCountsByPersonalityId,
    findings
  );
  checkFolderedCounts(
    files,
    directory,
    'facts',
    expectedCounts.factCountsByPersonalityId,
    findings
  );
}
