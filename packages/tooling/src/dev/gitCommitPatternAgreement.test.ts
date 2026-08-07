/**
 * Agreement guard for the three git-commit-detection patterns.
 *
 * The same "does this command string invoke `git commit`" decision is encoded
 * three times, in two languages:
 *
 *   1. `.claude/hooks/lib/git-command.sh`         — `is_git_commit_command`, a
 *      GNU-grep ERE. No runtime consumer; the canonical reference copy.
 *   2. `.claude/hooks/develop-code-commit-guard.sh` — a Python regex (BLOCKING)
 *   3. `.claude/hooks/git-commit-filter-guard.sh`   — a Python regex (BLOCKING)
 *
 * Copy 1 had two bash consumers until they moved to husky channels and stopped
 * needing command-text matching; it is retained as a language-neutral reference
 * for the two live Python copies to be compared against. Those two cannot be
 * collapsed into one: each needs its own heredoc/quote stripping inside a
 * blocking hook. So the coupling is real, hand-managed, and documented only in
 * a comment ("sync manually if the shape changes") — the unenforced-invariant
 * shape. It has already opened once: the commit-tree false positive was fixed
 * in the bash copy one PR before the two Python ones.
 *
 * This test asserts the three agree on a shared CASE TABLE, not that they are
 * textually identical — they deliberately aren't (see DIVERGENCES below). The
 * patterns are EXTRACTED from the hook sources at run time, so editing any one
 * of them without the others fails here; an extraction that stops matching is
 * a hard failure, never a silent pass.
 *
 * Copy 3 detects `(commit|push)` rather than `commit`. Every case below is
 * free of the token `push` (asserted), which makes that alternation inert and
 * lets all three be compared directly with no rewriting of the extracted text.
 *
 * EXTERNAL BINARIES: this file shells out to `grep` and `python3`, because the
 * only honest way to evaluate a hook's pattern is to run it through the same
 * engine the hook does. `python3` was already required to RUN the two blocking
 * hooks and their .probe.sh scripts; this makes it a prerequisite of the
 * tooling unit-test cell too. Both are present on ubuntu-latest, which is where
 * CI runs. If a future minimal image drops either, the failure surfaces here as
 * an ENOENT at collection time — that is this note's reason for existing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoPath = (rel: string): string =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

interface PatternSource {
  /** Human label used in failure messages. */
  readonly label: string;
  readonly file: string;
  /** Must capture the pattern in group 1 and match EXACTLY once in the file. */
  readonly extract: RegExp;
}

const SOURCES: readonly PatternSource[] = [
  {
    label: 'bash lib/git-command.sh',
    file: '.claude/hooks/lib/git-command.sh',
    extract: /grep -qE '(.+)' <<</,
  },
  {
    label: 'python develop-code-commit-guard.sh',
    file: '.claude/hooks/develop-code-commit-guard.sh',
    extract: /re\.search\(r"(.+)", cmd\)/,
  },
  {
    label: 'python git-commit-filter-guard.sh',
    file: '.claude/hooks/git-commit-filter-guard.sh',
    extract: /GIT_TARGET = re\.compile\(r"(.+)"\)/,
  },
];

/**
 * Extraction failure is a TEST failure, not a skip. A reformatted hook line
 * that stops matching would otherwise silently disarm this guard — the exact
 * failure mode it exists to prevent, one level up.
 */
function extractPattern(source: PatternSource): string {
  const text = readFileSync(repoPath(source.file), 'utf-8');
  const occurrences = text.split('\n').filter(line => source.extract.test(line));
  if (occurrences.length !== 1) {
    throw new Error(
      `${source.label}: expected exactly 1 line matching ${String(source.extract)}, found ${occurrences.length}. ` +
        `The hook was reformatted — update the extractor here rather than deleting this guard.`
    );
  }
  const match = source.extract.exec(occurrences[0]);
  return match![1];
}

/**
 * Cases every implementation must agree on. Single-line only: the bash copy is
 * evaluated through `grep`, which is line-oriented.
 */
const AGREEMENT_CASES: readonly (readonly [expected: boolean, input: string])[] = [
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
];

/**
 * The cases where the implementations legitimately differ, pinned so each
 * divergence stays deliberate rather than becoming an unnoticed drift. Both
 * come from the same root: the bash copy's character classes are ASCII-only
 * while Python's \w and \s are Unicode-aware. Neither side is wrong — see the
 * re.ASCII discussion in both Python hooks, which argues exactly this trade —
 * but a change to either side shows up here first.
 *
 * Verified against /usr/bin/grep (GNU). A grep whose [[:space:]] accepts
 * U+00A0 — ugrep does — flips the second row's bash column, so re-confirm which
 * binary is on PATH before treating a failure here as pattern drift.
 */
const DIVERGENCE_CASES: readonly (readonly [input: string, expectedByLabel: readonly boolean[]])[] =
  [
    // Non-ASCII suffix: Python's (?![-\w]) rejects it, bash's [^-a-zA-Z0-9_] accepts.
    ['git commit日本語', [true, false, false]],
    // Non-breaking space as the separator: Python's \s matches U+00A0, GNU grep's
    // [[:space:]] does not. This row is what makes adding re.ASCII to either
    // Python copy fail here — the flag would narrow \s and MISS a real commit.
    ['git commit -m "x"', [false, true, true]],
  ];

/**
 * The bash copy's verdicts are only meaningful under the engine the hooks
 * actually run on. `grep` on PATH is not reliably GNU grep: ugrep ships as a
 * drop-in `/usr/bin/grep` on some systems (including at least one sandbox this
 * project's own agent sessions run in), and its `[[:space:]]` ACCEPTS U+00A0
 * where GNU's does not — which flips the NBSP divergence row below.
 *
 * Without this check that mismatch surfaces as a per-case assertion failure,
 * i.e. as "the pattern drifted" — the one message this guard must never emit
 * falsely. Fail loudly, and name the cause, so the reader is not sent to
 * re-audit three correct regexes.
 *
 * BSD/macOS grep is out of scope for the same reason it is in lib/git-command.sh:
 * the shared pattern uses `\b`, a GNU extension, so the hook itself is already
 * GNU-scoped.
 */
function assertGnuGrep(): void {
  let version: string;
  try {
    version = execFileSync('grep', ['--version'], { encoding: 'utf-8' });
  } catch (error) {
    throw new Error('Could not run `grep --version`, so the bash copy cannot be evaluated', {
      cause: error,
    });
  }
  const firstLine = version.split('\n')[0];
  if (!/GNU grep/.test(firstLine)) {
    throw new Error(
      `This guard compares the hooks' patterns under the engine they run on, and \`grep\` ` +
        `on PATH is not GNU grep — it reports: "${firstLine}". A non-GNU grep (ugrep ships as ` +
        `a drop-in /usr/bin/grep on some systems) differs on U+00A0 in [[:space:]], which would ` +
        `fail the NBSP divergence row below as if a pattern had drifted. This is an ENVIRONMENT ` +
        `mismatch, not a hook change: put GNU grep on PATH before reading the result.`
    );
  }
}

/** grep exits 0 on match, 1 on no-match; anything else is a real error. */
function bashVerdict(pattern: string, input: string): boolean {
  try {
    execFileSync('grep', ['-qE', pattern], { input });
    return true;
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (status === 1) return false;
    throw error;
  }
}

/** One python3 spawn evaluates both Python patterns over every case. */
function pythonVerdicts(patterns: readonly string[], inputs: readonly string[]): boolean[][] {
  const script = [
    'import json, re, sys',
    'req = json.load(sys.stdin)',
    'pats = [re.compile(p) for p in req["patterns"]]',
    'json.dump([[bool(p.search(c)) for c in req["cases"]] for p in pats], sys.stdout)',
  ].join('\n');
  const out = execFileSync('python3', ['-c', script], {
    input: JSON.stringify({ patterns, cases: inputs }),
    encoding: 'utf-8',
  });
  return JSON.parse(out) as boolean[][];
}

assertGnuGrep();

const patterns = SOURCES.map(extractPattern);
const allInputs = [
  ...AGREEMENT_CASES.map(([, input]) => input),
  ...DIVERGENCE_CASES.map(([input]) => input),
];
const pythonResults = pythonVerdicts(patterns.slice(1), allInputs);

/** verdicts[sourceIndex][caseIndex] */
const verdicts: boolean[][] = [
  allInputs.map(input => bashVerdict(patterns[0], input)),
  ...pythonResults,
];

describe('git-commit detection patterns agree across all three copies', () => {
  it('extracts a distinct, non-empty pattern from each hook', () => {
    for (const [i, pattern] of patterns.entries()) {
      expect(pattern.length, `${SOURCES[i].label} extracted an empty pattern`).toBeGreaterThan(10);
    }

    // Distinctness is not cosmetic: if an extractor were edited to capture the
    // same substring from two files, every case below would compare a pattern
    // against ITSELF and pass unconditionally — the guard would read green while
    // enforcing nothing, which is the exact failure it exists to prevent. The
    // three patterns genuinely differ today (bash character classes vs Python
    // lookahead vs the (commit|push) alternation), so equality means a broken
    // extractor, never a legitimate convergence.
    expect(new Set(patterns).size, 'two extractors captured the same pattern').toBe(
      patterns.length
    );
  });

  it('uses only push-free cases, so copy 3’s (commit|push) alternation is inert', () => {
    for (const input of allInputs) {
      expect(
        input,
        'a case containing "push" would compare copy 3 against a different decision'
      ).not.toContain('push');
    }
  });

  for (const [caseIndex, [expected, input]] of AGREEMENT_CASES.entries()) {
    it(`${expected ? 'detects' : 'ignores'}: ${JSON.stringify(input)}`, () => {
      for (const [sourceIndex, source] of SOURCES.entries()) {
        expect.soft(verdicts[sourceIndex][caseIndex], source.label).toBe(expected);
      }
    });
  }

  for (const [offset, [input, expectedByLabel]] of DIVERGENCE_CASES.entries()) {
    it(`pinned divergence: ${JSON.stringify(input)}`, () => {
      const caseIndex = AGREEMENT_CASES.length + offset;
      for (const [sourceIndex, source] of SOURCES.entries()) {
        expect
          .soft(
            verdicts[sourceIndex][caseIndex],
            `${source.label} (deliberate ASCII-vs-Unicode divergence)`
          )
          .toBe(expectedByLabel[sourceIndex]);
      }
    });
  }
});
