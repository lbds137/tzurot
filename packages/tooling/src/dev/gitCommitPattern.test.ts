/**
 * Verdict pin for the one shared git-commit-detection pattern.
 *
 * The "does this command string invoke `git commit`" decision lives ONCE, in
 * `.claude/hooks/lib/git_commit.py` (`GIT_COMMIT_RE`, beside `GIT_PUSH_RE`),
 * imported by every hook in `HOOK_FILES` below. This file pins the verdicts:
 * every row below is a case where a wrong answer either blocks a commit that
 * should run or lets one through that should stop.
 *
 * Evaluation imports the lib module itself through python3
 * (`sys.path.insert(0, sys.argv[1])`, with the lib dir resolved as `LIB_DIR`
 * below), so the tested object is the exact constant the hooks load, not a
 * text image of it.
 *
 * EXTERNAL BINARIES: this file shells out to `python3`. See the header of
 * `shellQuotes.test.ts` for why python3 is already a prerequisite of the
 * tooling unit-test cell; if a future minimal image drops it, the failure
 * surfaces here as an ENOENT at collection time.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const LIB_DIR = fileURLToPath(new URL('../../../../.claude/hooks/lib', import.meta.url));
const HOOKS_DIR = fileURLToPath(new URL('../../../../.claude/hooks', import.meta.url));
/** The hooks that must import the shared constants rather than inline a copy. */
const HOOK_FILES = [
  'board-commit-branch-gate.sh',
  'develop-code-commit-guard.sh',
  'no-verify-guard.sh',
];
/** The hooks that detect pushes and must import GIT_PUSH_RE from the shared lib. */
const PUSH_HOOK_FILES = ['no-verify-guard.sh'];

/** Hook file names (sorted) whose source contains `needle`, scanned from HOOKS_DIR. */
function hooksContaining(needle: string): string[] {
  return readdirSync(HOOKS_DIR)
    .filter(name => name.endsWith('.sh') && !name.endsWith('.probe.sh'))
    .filter(name => readFileSync(`${HOOKS_DIR}/${name}`, 'utf-8').includes(needle))
    .sort();
}

/** Cases pinning the expected verdicts for the pattern. */
const CASES: readonly (readonly [expected: boolean, input: string])[] = [
  // --- is a commit ---
  [true, 'git commit'],
  [true, 'git commit -m "x"'],
  [true, 'git commit --amend --no-edit'],
  [true, 'git commit --fixup=abc1234'],
  [true, 'git -C /some/path commit -m "x"'],
  [true, 'git -c user.name=x commit -m "y"'],
  [true, 'git --git-dir=/tmp/x commit'],
  [true, 'git --no-pager commit -m "x"'],
  [true, 'cd foo && git commit -m "x"'],
  [true, 'git add . && git commit -m "x" && git status'],

  // --- case ---
  // The pattern carries an inline (?i). Uppercase is not a hypothetical: shells
  // accept it, and a case-sensitive regex exits silently on it — for two BLOCKING
  // hooks that means a commit that should have been stopped goes through.
  [true, 'GIT COMMIT -m "x"'],
  [true, 'Git Commit -m "x"'],
  [true, 'GIT -C /some/path COMMIT -m "x"'],
  // Case-insensitivity must not erode the plumbing exclusion.
  [false, 'GIT COMMIT-TREE abc1234'],

  // --- is NOT a commit ---
  // The plumbing subcommands: `-` is a non-word character, so a bare \b matched
  // these. They write no commit; treating one as a commit wrongly BLOCKS.
  [false, 'git commit-tree abc1234'],
  [false, 'git commit-graph write'],
  [false, 'git -C /some/path commit-tree abc1234'],
  [false, 'git commit_backup'],
  [false, 'git commitfoo'],
  [false, 'gitcommit -m "x"'],
  [false, 'git status'],
  [false, 'git add .'],
  [false, 'git log --grep=commit'],
  [false, 'echo committing now'],

  // --- Unicode boundary cases ---

  // A non-ASCII suffix is not a word boundary for the purpose of this decision:
  // Python's `(?![-\w])` sees `日` as a word character and rejects the match.
  [false, 'git commit日本語'],

  // A non-breaking space (U+00A0) between `git` and `commit`. Python's `\s` is
  // Unicode-aware and matches it, so this IS a commit. This row is what makes
  // adding `re.ASCII` to the pattern fail here — the flag would narrow `\s` and
  // the guard would MISS a real commit, which for a blocking hook means letting
  // through a commit that should have been stopped.
  //
  // Written as an ESCAPE, not a raw byte: a raw U+00A0 is indistinguishable from
  // a plain space on screen — retyping it as one silently turns this row into a
  // duplicate of the plain `git commit -m "x"` case above and deletes the
  // `re.ASCII` guard with it.
  [true, 'git\u00A0commit -m "x"'],
];

/** Cases pinning the expected verdicts for GIT_PUSH_RE (same shape, `push` subcommand). */
const PUSH_CASES: readonly (readonly [expected: boolean, input: string])[] = [
  [true, 'git push'],
  [true, 'git push --no-verify origin feat/x'],
  [true, 'git -C /some/path push'],
  [true, 'git -c user.name=x push origin x'],
  [true, 'cd foo && git push'],
  // Inline (?i), as for commit.
  [true, 'GIT PUSH'],
  [true, 'GIT -C /some/path PUSH'],
  [false, 'git push-foo'],
  [false, 'git pushd'],
  [false, 'git push_backup'],
  [false, 'gitpush'],
  [false, 'git pull'],
  [false, 'git commit -m push'],
  [false, 'echo pushing now'],
  // `stash` is a subcommand, not a global flag: `stash push -n` is no git push.
  [false, 'git stash push -n'],
];

/** One python3 spawn evaluates the shared constant over every case. */
function pythonVerdicts(inputs: readonly string[], constant = 'GIT_COMMIT_RE'): boolean[] {
  const script = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    `from git_commit import ${constant} as PATTERN`,
    'json.dump([bool(PATTERN.search(c)) for c in json.load(sys.stdin)], sys.stdout)',
  ].join('\n');
  const out = execFileSync('python3', ['-c', script, LIB_DIR], {
    input: JSON.stringify(inputs),
    encoding: 'utf-8',
    // Same as shellQuotes.test.ts: keeps the import from dropping a
    // `__pycache__` beside the library, where a stale `.pyc` could mask a
    // broken edit.
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  return JSON.parse(out) as boolean[];
}

const verdicts = pythonVerdicts(CASES.map(([, input]) => input));
const pushVerdicts = pythonVerdicts(
  PUSH_CASES.map(([, input]) => input),
  'GIT_PUSH_RE'
);

describe('git_commit.GIT_COMMIT_RE: pinned verdicts', () => {
  for (const [caseIndex, [expected, input]] of CASES.entries()) {
    it(`${expected ? 'detects' : 'ignores'}: ${JSON.stringify(input)}`, () => {
      expect(verdicts[caseIndex]).toBe(expected);
    });
  }
});

describe('git_commit.GIT_PUSH_RE: pinned verdicts', () => {
  for (const [caseIndex, [expected, input]] of PUSH_CASES.entries()) {
    it(`${expected ? 'detects' : 'ignores'}: ${JSON.stringify(input)}`, () => {
      expect(pushVerdicts[caseIndex]).toBe(expected);
    });
  }
});

describe('git_commit: single definition of the shared patterns', () => {
  // Presence check, not pattern extraction: each hook must import the shared
  // constant (the board gate aliases it to COMMIT_RE — the substring still
  // matches) and must not carry an inlined commit-pattern or push-pattern copy.
  // The tail fragments are subcommand-specific on purpose: the board gate's own
  // ADD_RE legitimately contains `\bgit(?:`, so that broader fragment cannot be
  // the marker here. They only catch a verbatim re-inline.
  it('every hook imports the constant; none inlines its own copy', () => {
    for (const file of HOOK_FILES) {
      const src = readFileSync(`${HOOKS_DIR}/${file}`, 'utf-8');
      expect(src, `${file}: expected the shared-lib import`).toContain(
        'from git_commit import GIT_COMMIT_RE'
      );
      expect(src, `${file}: found an inlined commit-pattern copy`).not.toContain(
        '\\s+commit(?![-\\w])'
      );
      expect(src, `${file}: found an inlined push-pattern copy`).not.toContain(
        '\\s+push(?![-\\w])'
      );
    }
  });

  it('every hook importing git_commit is listed in HOOK_FILES', () => {
    expect(
      hooksContaining('from git_commit import'),
      'a hook importing git_commit is missing from HOOK_FILES (or a listed hook no longer imports it)'
    ).toEqual([...HOOK_FILES].sort());
  });

  it('each push-detecting hook imports GIT_PUSH_RE on its git_commit import line', () => {
    for (const file of PUSH_HOOK_FILES) {
      const src = readFileSync(`${HOOKS_DIR}/${file}`, 'utf-8');
      expect(src, `${file}: expected GIT_PUSH_RE on its from git_commit import line`).toMatch(
        /from git_commit import [^\n]*GIT_PUSH_RE/
      );
    }
  });

  it('every hook using GIT_PUSH_RE is listed in PUSH_HOOK_FILES', () => {
    expect(
      hooksContaining('GIT_PUSH_RE'),
      'a hook using GIT_PUSH_RE is missing from PUSH_HOOK_FILES (or a listed hook no longer uses it)'
    ).toEqual([...PUSH_HOOK_FILES].sort());
  });
});
