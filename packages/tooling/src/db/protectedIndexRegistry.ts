/**
 * Protected-index registry loader.
 *
 * `prisma/drift-ignore.json`'s `protectedIndexes` array is the single source of
 * truth for the indexes Prisma cannot represent and must never lose: which ones
 * exist, what they are for, how to recreate one, and the DROP/CREATE patterns
 * that recognize an unbalanced drop. This module reads and validates that array
 * once; every consumer derives its own shape from the result instead of keeping
 * a hand-maintained copy.
 *
 * Consumers: `check-migration-safety.ts` (compiles the patterns to RegExps for
 * its drop-without-recreate scan) and `inspect-database.ts` (reports live-DB
 * presence and prints the recreate SQL when one is missing).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** One validated `protectedIndexes[]` entry from prisma/drift-ignore.json. */
export interface ProtectedIndexEntry {
  name: string;
  table: string;
  description: string;
  recreateSQL: string;
  dropPattern: string;
  createPattern: string;
}

/** Minimal shape of drift-ignore.json this loader cares about. */
interface DriftIgnoreFile {
  protectedIndexes: ProtectedIndexEntry[];
}

/**
 * Default location of prisma/drift-ignore.json, resolved from this module's
 * own file location rather than `process.cwd()`. The two invocation paths run
 * from different working directories — `pnpm ops` from the repo root, vitest
 * from the package directory — so a cwd-relative default would resolve for
 * one and not the other; a module-relative one resolves for both. Pinned by
 * the loader tests, which run under the vitest cwd.
 *
 * The `../../../../` depth is tied to this file living in `src/db/`. Moving
 * the module to another directory silently changes what it resolves to — the
 * loader tests seed memfs at whatever path this expression produces, so they
 * would follow the move and stay green while the real file went unread.
 * Re-check the depth if this module relocates.
 */
const DEFAULT_DRIFT_IGNORE_PATH = fileURLToPath(
  new URL('../../../../prisma/drift-ignore.json', import.meta.url)
);

/**
 * Read and parse drift-ignore.json into its `protectedIndexes` array, failing
 * loudly on anything that would leave the registry empty or half-formed.
 */
function readProtectedIndexArray(driftIgnorePath: string): unknown[] {
  let raw: string;
  try {
    raw = readFileSync(driftIgnorePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `protectedIndexRegistry: could not read drift-ignore.json at ${driftIgnorePath}: ${String(error)}`,
      { cause: error }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `protectedIndexRegistry: drift-ignore.json at ${driftIgnorePath} is not valid JSON: ${String(error)}`,
      { cause: error }
    );
  }

  // `JSON.parse` accepts bare `null` and every scalar, none of which have a
  // `.protectedIndexes` — reading through them would throw a TypeError naming
  // no file, which is the one failure shape the messages below exist to avoid.
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(
      `protectedIndexRegistry: drift-ignore.json at ${driftIgnorePath} is not a JSON object`
    );
  }

  const entries = (parsed as Partial<DriftIgnoreFile>).protectedIndexes;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      `protectedIndexRegistry: drift-ignore.json at ${driftIgnorePath} has an empty or missing ` +
        `"protectedIndexes" array — refusing to run with zero protected indexes`
    );
  }

  return entries;
}

/**
 * Validate one raw array element into a `ProtectedIndexEntry`.
 *
 * Ordering is load-bearing: each check below assumes the ones above it already
 * passed, so the message a malformed entry produces names the most specific
 * problem it has rather than the first field that happens to be absent.
 */
function validateEntry(raw: unknown, i: number, driftIgnorePath: string): ProtectedIndexEntry {
  // A null/scalar array element would throw on the first property read below,
  // losing the index number that makes the error actionable.
  if (raw === null || typeof raw !== 'object') {
    throw new Error(
      `protectedIndexRegistry: protectedIndexes[${i}] in ${driftIgnorePath} is not an object`
    );
  }
  const entry = raw as Partial<ProtectedIndexEntry>;

  if (
    typeof entry.name !== 'string' ||
    typeof entry.description !== 'string' ||
    typeof entry.dropPattern !== 'string' ||
    typeof entry.createPattern !== 'string'
  ) {
    throw new Error(
      `protectedIndexRegistry: protectedIndexes[${i}] in ${driftIgnorePath} is malformed ` +
        `(expected string name/description/dropPattern/createPattern)`
    );
  }
  // An empty pattern compiles fine and matches EVERY file, so neither
  // direction fails safe: an empty dropPattern flags all ~120 migrations as
  // dangerous, and an empty createPattern makes every drop look balanced —
  // silently unprotecting the index. Same class as the empty-array check
  // above, one level down.
  if (entry.dropPattern.length === 0 || entry.createPattern.length === 0) {
    throw new Error(
      `protectedIndexRegistry: protectedIndexes[${i}] ("${entry.name}") in ${driftIgnorePath} ` +
        `has an empty dropPattern or createPattern — an empty pattern matches every file`
    );
  }
  // name and description are both interpolated into the violation message,
  // so an empty one degrades it to "Drops  without recreating ()" — useless
  // at exactly the moment someone is reading it.
  if (entry.name.length === 0 || entry.description.length === 0) {
    throw new Error(
      `protectedIndexRegistry: protectedIndexes[${i}] in ${driftIgnorePath} has an empty ` +
        `name or description — both are reported verbatim when a violation is found`
    );
  }
  // Type-checking the strings above says nothing about whether they compile.
  // An uncatchable SyntaxError here would name neither the file nor the
  // entry, so a typo'd pattern would read as an unrelated crash. The compiled
  // values are discarded — consumers that need RegExps compile their own.
  try {
    new RegExp(entry.dropPattern, 'i');
    new RegExp(entry.createPattern, 'i');
  } catch (error) {
    throw new Error(
      `protectedIndexRegistry: protectedIndexes[${i}] ("${entry.name}") in ${driftIgnorePath} ` +
        `has a pattern that is not a valid regular expression: ${String(error)}`,
      { cause: error }
    );
  }
  // table and recreateSQL are the fields inspect-database reports to an
  // operator staring at a missing index; an absent or blank one turns the
  // recovery hint into "Recreate: undefined" at the worst possible moment.
  // Checked last so an entry with several problems still reports the pattern
  // or name problem first.
  if (
    typeof entry.table !== 'string' ||
    typeof entry.recreateSQL !== 'string' ||
    entry.table.length === 0 ||
    entry.recreateSQL.length === 0
  ) {
    throw new Error(
      `protectedIndexRegistry: protectedIndexes[${i}] ("${entry.name}") in ${driftIgnorePath} ` +
        `has a missing or empty table or recreateSQL — both are reported verbatim by db:inspect`
    );
  }

  return {
    name: entry.name,
    table: entry.table,
    description: entry.description,
    recreateSQL: entry.recreateSQL,
    dropPattern: entry.dropPattern,
    createPattern: entry.createPattern,
  };
}

/**
 * Load the protected-index registry from prisma/drift-ignore.json's
 * `protectedIndexes` array — the single source of truth for which indexes
 * must never be dropped without a recreate in the same migration.
 *
 * Fails loudly (throws) on a missing file, invalid JSON, or a missing/empty
 * `protectedIndexes` array. This backs a safety checker: silently checking
 * zero indexes would look identical to "all migrations are safe," which is
 * precisely the failure that tool exists to prevent.
 *
 * Module-local and parameterless on purpose: the tests reach this through
 * `vi.mock('node:fs')` with memfs seeded at the resolved path, so a path
 * override would be flexibility with no consumer.
 */
function loadProtectedIndexEntries(): ProtectedIndexEntry[] {
  const driftIgnorePath = DEFAULT_DRIFT_IGNORE_PATH;
  return readProtectedIndexArray(driftIgnorePath).map((raw, i) =>
    validateEntry(raw, i, driftIgnorePath)
  );
}

/**
 * The validated `protectedIndexes` entries, computed at module load so a
 * malformed registry rejects the importing module rather than degrading a
 * downstream check to a silent no-op.
 */
export const PROTECTED_INDEX_ENTRIES: ProtectedIndexEntry[] = loadProtectedIndexEntries();
