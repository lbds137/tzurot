/**
 * Agreement guard between `.claude/settings.json`'s `SYG_LOSSY_PIPE_GH_WRAPPERS`
 * protected `gh:` read list (read by the Seyag plugin's `lossy-pipe-guard` hook)
 * and the `gh:*` command registry.
 *
 * Rule 2 of the hook blocks a TRUNCATED read of a `gh:` wrapper whose rows can
 * hide a failure, and the protected list is hand-enumerated in
 * `env.SYG_LOSSY_PIPE_GH_WRAPPERS`. The enumeration is deliberate — a
 * `gh:[a-z-]+` glob was tried and swept in `gh:pr-edit`, a WRITE command whose
 * output is a confirmation line rather than rows, which produced pure friction.
 * What the enumeration lacks is any tie to the registry in `commands/gh.ts`:
 * renaming or deleting a read wrapper leaves `settings.json` naming a command
 * that no longer exists, and nothing goes red.
 *
 * So this test pins what is already DECIDED, not what should be decided.
 * Read-vs-write for a NEW command stays a human call: a wrapper added to the
 * registry and left out of `SYG_LOSSY_PIPE_GH_WRAPPERS` is not a failure here.
 *
 * Both lists are EXTRACTED from their sources at run time. An extraction that
 * stops matching (a missing env key or an empty list) is a hard failure rather
 * than a silent pass. The extractor rejects any token not of the form
 * `gh:<name>` because the plugin matches full tokens, and that throw at
 * module scope fails the file at collection. The Seyag plugin's
 * `lossy-pipe-guard` reads `SYG_LOSSY_PIPE_GH_WRAPPERS` as whitespace-separated
 * whole tokens with the `gh:` prefix included (its header documents the
 * format), and nothing in this repo goes red if the plugin changes that format.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoPath = (rel: string): string =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

const SETTINGS_FILE = '.claude/settings.json';
const ENV_KEY = 'SYG_LOSSY_PIPE_GH_WRAPPERS';
const REGISTRY_FILE = 'packages/tooling/src/commands/gh.ts';

/**
 * Every `gh:` command the CLI registers. `.command(` may be followed by the
 * string on the same line or the next one (the ci-gate registration wraps), so
 * this matches across the whitespace rather than line by line.
 */
const REGISTERED = /\.command\(\s*'gh:([a-z0-9-]+)/g;

/** Extraction failure is a test failure — a silent skip would disarm the guard. */
function extractHookNames(): string[] {
  const text = readFileSync(repoPath(SETTINGS_FILE), 'utf-8');
  const parsed = JSON.parse(text) as { env?: Record<string, unknown> };
  const raw = parsed.env?.[ENV_KEY];
  if (typeof raw !== 'string') {
    throw new Error(
      `${SETTINGS_FILE}: missing string env.${ENV_KEY}. ` +
        'Update the extractor here rather than deleting this guard.'
    );
  }
  const names = raw
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 0)
    .map(token => {
      if (!/^gh:[a-z0-9-]+$/.test(token)) {
        throw new Error(
          `${SETTINGS_FILE}: env.${ENV_KEY} has invalid token "${token}" (expected /^gh:[a-z0-9-]+$/). ` +
            'The Seyag plugin matches the full gh:<name> token, so a bare name would silently protect nothing.'
        );
      }
      return token.slice('gh:'.length);
    });
  if (names.length === 0) {
    throw new Error(
      `${SETTINGS_FILE}: env.${ENV_KEY} yielded no wrapper names. ` +
        'A missing or empty list must fail loudly rather than silently disarming this guard.'
    );
  }
  return names;
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

describe('SYG_LOSSY_PIPE_GH_WRAPPERS (settings.json) agrees with the gh command registry', () => {
  it('extracts a non-empty command list from the registry', () => {
    expect(registeredNames.length, `${REGISTRY_FILE} yielded no commands`).toBeGreaterThan(0);
  });

  it('lists each wrapper once', () => {
    expect(new Set(hookNames).size, 'duplicate token in env.SYG_LOSSY_PIPE_GH_WRAPPERS').toBe(
      hookNames.length
    );
  });

  for (const name of hookNames) {
    it(`protects a command that still exists: gh:${name}`, () => {
      expect(
        registeredNames,
        `lossy-pipe-guard (${SETTINGS_FILE} env.${ENV_KEY}) protects gh:${name}, which is no longer registered in ${REGISTRY_FILE}. ` +
          'Rename or remove it in settings.json too — rule 2 is now naming nothing.'
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
