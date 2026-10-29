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
 * calls.
 *
 * Covered:
 * - The exclusion borrows the lossy-pipe read set parsed from
 *   `SYG_LOSSY_PIPE_GH_WRAPPERS`; the `(?![\w-])` verb boundary keeps
 *   `pr-info-x` flagged while `pr-info` is exempt.
 * - The regex crosses the spaces inside the quoted `-C "$(git rev-parse …)"`
 *   form the docs actually carry.
 * - Leading pnpm globals before a `-C`/`--dir`, as well as trailing pnpm
 *   globals between the `-C`/`--dir` value and `ops`, are covered.
 * - The skill scan covers top-level `.claude/skills/*.md` plus each skill
 *   directory's `SKILL.md` (not extra `.md` files inside a skill directory).
 * - `docs/reference/GITHUB_CLI_REFERENCE.md` is scanned as a single inline
 *   read: it teaches the `gh:` wrappers but sits outside `docs/reference/tooling/`.
 *
 * Deliberate negatives:
 * - The read set (`ci-gate` and the lossy-pipe read verbs) is unflagged.
 * - A non-flag positional between the `-C` value and `ops`
 *   (`pnpm -C dir filter ops gh:<verb>`) is likewise unflagged on purpose: the
 *   regex allows only dash-prefixed tokens between the `-C`/`--dir` value and
 *   `ops`, so a bare positional breaks the match by construction (the unflagged
 *   test pins it as a correct negative alongside the read verbs).
 *
 * Theoretical over-/under-matches (none occur today):
 * - The `(?:=|[ \t]*)` zero-width separator means `--dir` can match inside a
 *   longer flag (`--dirty` as `--dir` + value `ty`) — theoretical, harmless
 *   for a tripwire.
 * - The `(?![\w-])` verb boundary treats `:`, `.`, `/` as boundaries, so a
 *   hypothetical `gh:pr-info:raw` would be exempted as `pr-info` —
 *   theoretical, since today's registered ops verbs use `[a-z-]` only.
 * - A symlinked skill directory would be skipped by the `isDirectory()` filter
 *   in `readSkillFiles`.
 * - A directory whose name ends in `.md` would throw a raw `EISDIR` from
 *   `readSurfaceFiles`.
 * - Neither of the last two occurs in the current tree, and no stat/symlink
 *   handling is added for them.
 *
 * Remaining uncovered shapes, accepted because no surface carries them:
 * - an unquoted multi-word substitution (`-C $(git rev-parse …)` — the match
 *   stops at the first space);
 * - a single-quoted `-C` path (`pnpm -C 'dir with spaces' ops gh:<verb>`);
 * - a pnpm flag taking a separate value on the leading side
 *   (`pnpm --filter x -C dir ops gh:<verb>`) or the trailing side
 *   (`pnpm -C dir --filter x ops gh:<verb>`);
 * - a pnpm global with no `-C`/`--dir` at all (`pnpm --silent ops gh:<verb>`);
 * - a doubled `gh` token (`ops gh gh:<verb>`);
 * - the usage docblock in `packages/tooling/src/gh/github-api.ts`, which
 *   teaches the `gh:` wrappers but is a `.ts` docblock outside the `.md` scan;
 * - subdirectories: the scan is one-level and non-recursive, so
 *   `.claude/hooks/lib/` and any future subdirectory of
 *   `docs/reference/tooling/` are skipped (nothing is missed today).
 *
 * Borrow guard: the exclusion list must stay read-only — a write wrapper added
 * to `SYG_LOSSY_PIPE_GH_WRAPPERS` would silently exempt a write verb from this
 * tripwire. The borrow-guard test hard-codes the six read verbs, so adding a
 * read wrapper means updating BOTH the settings list and that test allowlist;
 * the test goes red when settings carries a verb the allowlist lacks (a subset
 * check, settings ⊆ allowlist). The duplication is the guard against a write
 * verb being borrowed silently — never "DRY it away".
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

const readSettingsTokens = (key: string): string[] => readSettingsEnv(key).trim().split(/\s+/);

const escapeRegex = (token: string): string => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readVerbs = readSettingsTokens('SYG_LOSSY_PIPE_GH_WRAPPERS')
  .map(token => escapeRegex(token.replace(/^gh:/, '')))
  .join('|');

// Module-level `/g` regex shared across tests: `String.prototype.match` resets
// `lastIndex`, so it is correct today, but a future `.test()`/`.exec()` caller
// would carry state between calls.
const TRIPWIRE = new RegExp(
  `pnpm (?:--?\\S+[ \\t]+)*(?:-C|--dir)(?:=|[ \\t]*)(?:"[^"\\n]*"|\\S+)(?:[ \\t]+--?\\S+)* ops gh:(?!(?:${readVerbs})(?![\\w-]))\\S+`,
  'g'
);

interface SurfaceFile {
  path: string;
  content: string;
}

const readSurfaceFiles = (rel: string, ext: string): SurfaceFile[] =>
  readdirSync(repoPath(rel))
    .filter(name => name.endsWith(ext))
    .map(name => ({
      path: `${rel}/${name}`,
      content: readFileSync(repoPath(`${rel}/${name}`), 'utf8'),
    }));

const readSkillFiles = (): SurfaceFile[] =>
  readdirSync(repoPath('.claude/skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const path = `.claude/skills/${entry.name}/SKILL.md`;
      if (!existsSync(repoPath(path))) {
        throw new Error(
          `.claude/skills/${entry.name}: no SKILL.md — add the file or keep non-skill directories out of .claude/skills`
        );
      }
      return { path, content: readFileSync(repoPath(path), 'utf8') };
    });

describe('SYG_GH_WRAPPERS settings shape', () => {
  it('keeps the pnpm-ops wrapper prefix wired, exactly two tokens', () => {
    const tokens = readSettingsTokens('SYG_GH_WRAPPERS');
    expect(tokens).toEqual(['pnpm', 'ops']);
  });
});

describe('pnpm -C/--dir write-form tripwire', () => {
  it('keeps the borrowed SYG_LOSSY_PIPE_GH_WRAPPERS exclusion list strictly read-only', () => {
    const offenders = readSettingsTokens('SYG_LOSSY_PIPE_GH_WRAPPERS').filter(
      token => !/^gh:(pr-(all|comments|conversation|info|reviews)|ci-gate)$/.test(token)
    );
    expect(offenders).toEqual([]);
  });

  it('flags bare, quoted, --dir=, and leading/trailing-global write forms', () => {
    const lines = [
      'pnpm -C "$(git rev-parse --show-toplevel)" ops gh:pr-edit 2684 --body-file body.md',
      'pnpm --dir=packages/tooling ops gh:pr-edit 2684 --title "x"',
      'pnpm --dir packages/tooling ops gh:pr-edit 2684',
      'pnpm -C packages/tooling ops gh:pr-edit 2684 --title "x"',
      'pnpm -C "dir with spaces" ops gh:pr-edit 2684',
      'pnpm --silent -C packages/tooling ops gh:pr-edit 2684',
      'pnpm -C packages/tooling --silent ops gh:pr-edit 2684',
      'pnpm -C packages/tooling ops gh:pr-info-x 2684',
      '`pnpm -C packages/tooling ops gh:pr-edit`',
    ];
    const unmatched = lines.filter(line => line.match(TRIPWIRE) === null);
    expect(unmatched).toEqual([]);
  });

  it('does not flag covered read verbs, non-flag positionals, or line-spanning forms', () => {
    const lines = [
      'pnpm -C "$(git rev-parse --show-toplevel)" ops gh:ci-gate 2684 --sha "$(git rev-parse HEAD)"',
      'pnpm -C packages/tooling ops gh:pr-info 2684',
      '`pnpm -C packages/tooling ops gh:pr-info`',
      'pnpm -C packages/tooling filter ops gh:pr-edit 2684',
      'pnpm --silent\n-C packages/tooling ops gh:pr-edit 2684',
      'pnpm -C "dir with\nspaces" ops gh:pr-edit 2684',
    ];
    const matched = lines.filter(line => line.match(TRIPWIRE) !== null);
    expect(matched).toEqual([]);
  });

  it('keeps documented write forms out of the rule, skill, hook and tooling-doc surfaces', () => {
    const surfaces = [
      ...readSurfaceFiles('.claude/rules', '.md'),
      ...readSurfaceFiles('.claude/skills', '.md'),
      ...readSkillFiles(),
      ...readSurfaceFiles('.claude/hooks', '.sh'),
      ...readSurfaceFiles('docs/reference/tooling', '.md'),
      {
        path: 'docs/reference/GITHUB_CLI_REFERENCE.md',
        content: readFileSync(repoPath('docs/reference/GITHUB_CLI_REFERENCE.md'), 'utf8'),
      },
    ];
    const matched = surfaces.flatMap(({ path, content }) =>
      (content.match(TRIPWIRE) ?? []).map(m => `${path}: ${m}`)
    );
    expect(matched).toEqual([]);
  });
});
