/**
 * Pins the SYG_GH_WRAPPERS shape in the repo settings and keeps documented
 * `pnpm -C/--dir … ops gh:<write-verb>` forms out of the docs surfaces.
 *
 * Settings half: the seyag walker reads the value as a whitespace-separated
 * token list (its header documents the format) to cover `pnpm ops gh:*`
 * calls. Losing or mangling the value silently re-opens the gap the wiring
 * exists to close, so the shape goes red here.
 *
 * Tripwire half: the walker matches wrapper tokens against the invocation's
 * leading argv positionally (per the walker's `_gh_wrapper_argv` matcher), so
 * a `-C`/`--dir` flag between `pnpm` and `ops` is NOT covered, and a docs
 * line teaching that shape with a write verb would send readers to uncovered
 * calls. The regex must cross the spaces inside the quoted
 * `-C "$(git rev-parse …)"` form the docs actually carry. Remaining
 * uncovered shapes, accepted because no surface carries them: an unquoted
 * multi-word substitution (`-C $(git rev-parse …)` — the match stops at the
 * first space), a pnpm global before a bare `ops` token (`pnpm --silent ops
 * gh:<verb>`), and a doubled `gh` token (`ops gh gh:<verb>`).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoPath = (rel: string): string =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

const SETTINGS_FILE = repoPath('.claude/settings.json');

const readSettingsEnv = (key: string): string => {
  const raw = (JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as { env?: Record<string, unknown> })
    .env?.[key];
  if (typeof raw !== 'string') {
    throw new Error(`.claude/settings.json: missing string env.${key}`);
  }
  return raw;
};

const TRIPWIRE = /pnpm (?:--?\S+\s+)*(?:-C|--dir)(?:=|\s*)(?:"[^"]*"|\S+) ops gh:(?!ci-gate)\S+/g;

const readSurfaceFiles = (rel: string, ext: string): string[] =>
  readdirSync(repoPath(rel))
    .filter(name => name.endsWith(ext))
    .map(name => readFileSync(repoPath(`${rel}/${name}`), 'utf8'));

describe('SYG_GH_WRAPPERS settings shape', () => {
  it('keeps the pnpm-ops wrapper prefix wired, exactly two tokens', () => {
    const tokens = readSettingsEnv('SYG_GH_WRAPPERS').trim().split(/\s+/);
    expect(tokens).toEqual(['pnpm', 'ops']);
  });
});

describe('pnpm -C/--dir write-form tripwire', () => {
  it('flags the quoted command-substitution and --dir= write forms', () => {
    const flagged = [
      'pnpm -C "$(git rev-parse --show-toplevel)" ops gh:pr-edit 2684 --body-file body.md',
      'pnpm --dir=packages/tooling ops gh:pr-edit 2684 --title "x"',
    ]
      .map(line => line.match(TRIPWIRE) ?? [])
      .flat();
    expect(flagged).toHaveLength(2);
  });

  it('does not flag the canonical ci-gate Monitor form', () => {
    expect(
      'pnpm -C "$(git rev-parse --show-toplevel)" ops gh:ci-gate 2684 --sha "$(git rev-parse HEAD)"'.match(
        TRIPWIRE
      )
    ).toBeNull();
  });

  it('keeps documented write forms out of the rule, skill, hook and tooling-doc surfaces', () => {
    const surfaces = [
      readFileSync(repoPath('.claude/rules/05-tooling.md'), 'utf8'),
      readFileSync(repoPath('.claude/skills/tzurot-git-workflow/SKILL.md'), 'utf8'),
      ...readSurfaceFiles('.claude/hooks', '.sh'),
      ...readSurfaceFiles('docs/reference/tooling', '.md'),
    ];
    const flagged = surfaces.map(content => content.match(TRIPWIRE) ?? []).flat();
    expect(flagged).toEqual([]);
  });
});
