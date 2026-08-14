/**
 * Registry-agreement guard for the protected-index lists.
 *
 * Three surfaces know which indexes Prisma can't represent and must never be
 * silently dropped: `prisma/drift-ignore.json` (`protectedIndexes` — DROP
 * suppression + recreate SQL), `check-migration-safety.ts` (drop-without-
 * recreate scan over migration files), and `inspect-database.ts` (live-DB
 * presence report). Every table that joined the family so far shipped with at
 * least one list missed, which is the drift this test exists to kill: adding
 * an index to one registry without the others fails the suite with the
 * missing names in the diff.
 *
 * Both halves now DERIVE from `drift-ignore.json` through the shared
 * `protectedIndexRegistry.ts` loader, so neither name-set assertion can fail
 * on someone editing one list and forgetting another — there is only one list
 * left to edit. What they still catch is a bug inside the loader's own mapping
 * or a consumer that re-narrows the set on its way through. The remaining two
 * assertions are the ones doing independent work: they check the JSON's own
 * internal coupling, where `protectedIndexes` and `ignorePatterns` are still
 * two hand-maintained arrays that have to agree.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { PROTECTED_INDEXES as SAFETY_REGISTRY } from './check-migration-safety.js';
import { PROTECTED_INDEXES as INSPECT_REGISTRY } from './inspect-database.js';

const DRIFT_IGNORE_PATH = fileURLToPath(
  new URL('../../../../prisma/drift-ignore.json', import.meta.url)
);

interface DriftIgnoreFile {
  protectedIndexes: { name: string; recreateSQL?: string }[];
  ignorePatterns: { pattern: string; reason: string; action: string }[];
}

const driftIgnore = JSON.parse(readFileSync(DRIFT_IGNORE_PATH, 'utf-8')) as DriftIgnoreFile;

const names = (list: { name: string }[]): string[] => list.map(e => e.name).sort();

describe('protected-index registries', () => {
  it('drift-ignore.json and check-migration-safety.ts agree on the name set', () => {
    expect(names(SAFETY_REGISTRY)).toEqual(names(driftIgnore.protectedIndexes));
  });

  it('drift-ignore.json and inspect-database.ts agree on the name set', () => {
    expect(names(INSPECT_REGISTRY)).toEqual(names(driftIgnore.protectedIndexes));
  });

  it('every protectedIndexes entry has its DROP-suppression ignorePattern', () => {
    // protectedIndexes entries promise recovery SQL, but the DROP suppression
    // itself lives in ignorePatterns — an entry added without its DROP strip
    // would let Prisma's generated migration drop the index after all.
    //
    // Limitation: this and the recreateSQL check below match by SUBSTRING, so
    // an index whose name is a prefix of another's (idx_foo vs idx_foo_v2)
    // could false-pass against the wrong entry. If a name like that ever joins
    // the family, tighten these to boundary-anchored matches.
    for (const entry of driftIgnore.protectedIndexes) {
      const covered = driftIgnore.ignorePatterns.some(
        p => p.pattern.includes(entry.name) && p.pattern.includes('DROP INDEX')
      );
      expect.soft(covered, `${entry.name} has no DROP INDEX ignorePattern`).toBe(true);
    }
  });

  it('every protectedIndexes entry carries recreate SQL naming its own index', () => {
    for (const entry of driftIgnore.protectedIndexes) {
      expect.soft(entry.recreateSQL, `${entry.name} is missing recreateSQL`).toBeTruthy();
      expect
        .soft(
          entry.recreateSQL?.includes(entry.name),
          `${entry.name}'s recreateSQL does not reference the index name`
        )
        .toBe(true);
    }
  });
});
