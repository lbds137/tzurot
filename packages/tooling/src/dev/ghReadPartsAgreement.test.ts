/**
 * Agreement guard between `lossy-pipe-guard.sh`'s protected `gh:` read list and
 * the `gh:*` command registry.
 *
 * Rule 2 of the hook blocks a TRUNCATED read of a `gh:` wrapper whose rows can
 * hide a failure, and the protected list is hand-enumerated. The enumeration is
 * deliberate — a `gh:[a-z-]+` glob was tried and swept in `gh:pr-edit`, a WRITE
 * command whose output is a confirmation line rather than rows, which produced
 * pure friction. What the enumeration lacks is any tie to the registry in
 * `commands/gh.ts`: renaming or deleting a read wrapper leaves the hook naming a
 * command that no longer exists, and nothing goes red.
 *
 * So this test pins what is already DECIDED, not what should be decided.
 * Read-vs-write for a NEW command stays a human call: a wrapper added to the
 * registry and left out of the hook list is not a failure here.
 *
 * Both lists are EXTRACTED from their sources at run time. An extraction that
 * stops matching is a hard failure rather than a silent pass — the same posture
 * as `gitCommitPatternAgreement.test.ts`, which this file is modelled on.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoPath = (rel: string): string =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

const HOOK_FILE = '.claude/hooks/lossy-pipe-guard.sh';
const REGISTRY_FILE = 'packages/tooling/src/commands/gh.ts';

/**
 * The alternation inside the hook's `\bgh:(…)` part — the enumerated names.
 * Anchored on `gh:(` so an unrelated alternation elsewhere in the hook cannot
 * be picked up instead.
 */
const HOOK_LIST = /\\bgh:\(([a-z0-9|-]+)\)/;

/**
 * Every `gh:` command the CLI registers. `.command(` may be followed by the
 * string on the same line or the next one (the ci-gate registration wraps), so
 * this matches across the whitespace rather than line by line.
 */
const REGISTERED = /\.command\(\s*'gh:([a-z0-9-]+)/g;

/** Extraction failure is a test failure — a silent skip would disarm the guard. */
function extractHookNames(): string[] {
  const text = readFileSync(repoPath(HOOK_FILE), 'utf-8');
  const match = HOOK_LIST.exec(text);
  if (match === null) {
    throw new Error(
      `${HOOK_FILE}: no \\bgh:(…) alternation found by ${String(HOOK_LIST)}. ` +
        'The hook was reformatted — update the extractor here rather than deleting this guard.'
    );
  }
  return match[1].split('|').filter(name => name.length > 0);
}

/** Same posture: a registry whose shape changed must fail loudly, not silently. */
function extractRegisteredNames(): string[] {
  const text = readFileSync(repoPath(REGISTRY_FILE), 'utf-8');
  const names = [...text.matchAll(REGISTERED)].map(m => m[1]);
  if (names.length === 0) {
    throw new Error(
      `${REGISTRY_FILE}: no gh: command registrations found by ${String(REGISTERED)}. ` +
        'The registry was reformatted — update the extractor here rather than deleting this guard.'
    );
  }
  return names;
}

const hookNames = extractHookNames();
const registeredNames = extractRegisteredNames();

describe('lossy-pipe-guard gh: read list agrees with the gh command registry', () => {
  it('extracts a non-empty list from each source', () => {
    expect(hookNames.length, `${HOOK_FILE} yielded no names`).toBeGreaterThan(0);
    expect(registeredNames.length, `${REGISTRY_FILE} yielded no commands`).toBeGreaterThan(0);
  });

  for (const name of hookNames) {
    it(`protects a command that still exists: gh:${name}`, () => {
      expect(
        registeredNames,
        `lossy-pipe-guard protects gh:${name}, which is no longer registered in ${REGISTRY_FILE}. ` +
          'Rename or remove it in the hook too — rule 2 is now naming nothing.'
      ).toContain(name);
    });
  }

  it('excludes the write command gh:pr-edit', () => {
    // The exclusion is the decision that killed the `gh:[a-z-]+` glob: pr-edit's
    // output is a confirmation line, so truncating it loses nothing, and
    // blocking it blocked `gh:pr-edit --help | tail` during authoring.
    expect(registeredNames, 'gh:pr-edit is gone from the registry').toContain('pr-edit');
    expect(hookNames, 'gh:pr-edit is a WRITE command and must stay out of rule 2').not.toContain(
      'pr-edit'
    );
  });
});
