/**
 * Agreement guard for the two git-commit-detection patterns.
 *
 * The same "does this command string invoke `git commit`" decision is encoded
 * twice, and both copies BLOCK:
 *
 *   1. `.claude/hooks/develop-code-commit-guard.sh` — a Python regex
 *   2. `.claude/hooks/lossy-pipe-guard.sh`          — a Python regex
 *
 * They cannot be collapsed into one: each needs its own heredoc/quote stripping
 * inside its own blocking hook. So the coupling is real, hand-managed, and
 * documented only in a comment ("sync manually if the shape changes") — the
 * unenforced-invariant shape. It has already opened once: the commit-tree false
 * positive was fixed in one copy a PR before the other.
 *
 * A third, bash copy (`lib/git-command.sh`) sat here until it was retired. It
 * had no runtime consumer, so its drift could not cause a runtime bug — while
 * still imposing a change-one-change-three obligation and forcing this file to
 * demand GNU grep on PATH. Both copies that remain are ones a wrong verdict
 * actually blocks a commit on.
 *
 * This test asserts the two agree on a shared CASE TABLE, not that they are
 * textually identical — they deliberately aren't. The patterns are EXTRACTED
 * from the hook sources at run time, so editing one without the other fails
 * here; an extraction that stops matching is a hard failure, never a silent
 * pass.
 *
 * Copy 2 detects `(commit|push)` rather than `commit`. Every case below is
 * free of the token `push` (asserted), which makes that alternation inert and
 * lets both be compared directly with no rewriting of the extracted text.
 *
 * EXTERNAL BINARIES: this file shells out to `python3`, because the only honest
 * way to evaluate a hook's pattern is to run it through the same engine the
 * hook does. `python3` was already required to RUN both hooks and their
 * .probe.sh scripts; this makes it a prerequisite of the tooling unit-test cell
 * too. It is present on ubuntu-latest, which is where CI runs. If a future
 * minimal image drops it, the failure surfaces here as an ENOENT at collection
 * time — that is this note's reason for existing.
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
    label: 'python develop-code-commit-guard.sh',
    file: '.claude/hooks/develop-code-commit-guard.sh',
    extract: /re\.search\(r"(.+)", cmd\)/,
  },
  {
    label: 'python lossy-pipe-guard.sh',
    file: '.claude/hooks/lossy-pipe-guard.sh',
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

/** Cases both implementations must agree on. */
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

  // --- Unicode boundary cases ---
  // These two were pinned as bash-vs-Python DIVERGENCES while a third, ASCII-only
  // bash copy was compared here. Both Python copies agree on them, so with that
  // copy retired they are ordinary agreement cases — but each still pins a real
  // property, which is why they survived the migration rather than being dropped.

  // A non-ASCII suffix is not a word boundary for the purpose of this decision:
  // Python's `(?![-\w])` sees `日` as a word character and rejects the match.
  [false, 'git commit日本語'],

  // A non-breaking space (U+00A0) between `git` and `commit`. Python's `\s` is
  // Unicode-aware and matches it, so this IS a commit. This row is what makes
  // adding `re.ASCII` to either copy fail here — the flag would narrow `\s` and
  // the guard would MISS a real commit, which for a blocking hook means letting
  // through a commit that should have been stopped.
  //
  // Written as an ESCAPE, not a raw byte. It was a raw byte while a third,
  // ASCII-only copy made this a pinned divergence, and a raw U+00A0 is
  // indistinguishable from a plain space on screen — during this very migration
  // it was nearly retyped as one, which would have silently turned this row into
  // a duplicate of the plain `git commit -m "x"` case above and deleted the
  // `re.ASCII` guard with it.
  [true, 'git\u00A0commit -m "x"'],
];

/** One python3 spawn evaluates both patterns over every case. */
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

const patterns = SOURCES.map(extractPattern);
const allInputs = AGREEMENT_CASES.map(([, input]) => input);
const pythonResults = pythonVerdicts(patterns, allInputs);

/** verdicts[sourceIndex][caseIndex] */
const verdicts: boolean[][] = pythonResults;

describe('git-commit detection patterns agree across both blocking copies', () => {
  it('extracts a distinct, non-empty pattern from each hook', () => {
    for (const [i, pattern] of patterns.entries()) {
      expect(pattern.length, `${SOURCES[i].label} extracted an empty pattern`).toBeGreaterThan(10);
    }

    // Distinctness is not cosmetic: if an extractor were edited to capture the
    // same substring from two files, every case below would compare a pattern
    // against ITSELF and pass unconditionally — the guard would read green while
    // enforcing nothing, which is the exact failure it exists to prevent. The
    // two patterns genuinely differ today (only one carries the (commit|push)
    // alternation), so equality means a broken extractor, never a legitimate
    // convergence.
    expect(new Set(patterns).size, 'two extractors captured the same pattern').toBe(
      patterns.length
    );
  });

  it('uses only push-free cases, so the (commit|push) alternation is inert', () => {
    for (const input of allInputs) {
      expect(
        input,
        'a case containing "push" would compare the filter guard against a different decision'
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
});
