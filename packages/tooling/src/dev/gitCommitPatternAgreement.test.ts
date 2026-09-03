/**
 * Agreement guard for the three git-commit-detection patterns.
 *
 * The same "does this command string invoke `git commit`" decision is encoded
 * three times, and all three copies BLOCK:
 *
 *   1. `.claude/hooks/develop-code-commit-guard.sh`  — a Python regex
 *   2. `.claude/hooks/lossy-pipe-guard.sh`           — a Python regex
 *   3. `.claude/hooks/board-commit-branch-gate.sh`   — a Python regex, inside
 *      the python3 heredoc that hook already spawns for quote stripping
 *
 * They cannot be collapsed into one: each needs its own heredoc/quote stripping
 * inside its own blocking hook. So the coupling is real, hand-managed, and
 * documented only in a comment ("sync manually if the shape changes") — the
 * unenforced-invariant shape. It has already opened once: the commit-tree false
 * positive was fixed in one copy a PR before the other.
 *
 * A fourth, bash copy (`lib/git-command.sh`) sat here until it was retired. It
 * had no runtime consumer, so its drift could not cause a runtime bug — while
 * still imposing a change-one-change-N obligation and forcing this file to
 * demand GNU grep on PATH. Every copy that remains is one a wrong verdict
 * actually blocks a commit on, and every one of them is a PYTHON regex, which
 * is why the evaluator below needs only a python3 spawn.
 *
 * This test asserts the three agree on a shared CASE TABLE, not that they are
 * textually identical — copy 2 deliberately isn't. The patterns are EXTRACTED
 * from the hook sources at run time, so editing one without the others fails
 * here; an extraction that stops matching is a hard failure, never a silent
 * pass.
 *
 * Copy 2 detects `(commit|push)` rather than `commit`. Every case below is
 * free of the token `push` (asserted), which makes that alternation inert and
 * lets all three be compared directly with no rewriting of the extracted text.
 *
 * EXTERNAL BINARIES: this file shells out to `python3`, because the only honest
 * way to evaluate a hook's pattern is to run it through the same engine the
 * hook does. `python3` was already required to RUN all three hooks and their
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
  {
    label: 'python board-commit-branch-gate.sh',
    file: '.claude/hooks/board-commit-branch-gate.sh',
    // Anchored, because that hook's python block also defines an ADD_RE of the
    // same shape and the file's prose discusses the pattern by name; an
    // unanchored extractor would match more than the one definition line.
    extract: /^COMMIT_RE = re\.compile\(r"(.+)"\)$/,
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

/** Cases all three implementations must agree on. */
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

  // --- case ---
  // All three copies carry an inline (?i). Uppercase is not a hypothetical: shells
  // accept it, and a case-sensitive copy exits silently on it — for three BLOCKING
  // hooks that means a commit that should have been stopped goes through. The
  // flag is inline rather than an re.I argument because these patterns are
  // extracted from source TEXT above; a flag outside the string would be
  // invisible here (and break the extraction, which is a hard failure).
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
  // These two were pinned as bash-vs-Python DIVERGENCES while the retired ASCII-only
  // bash copy was compared here. All three Python copies agree on them, so with that
  // copy retired they are ordinary agreement cases — but each still pins a real
  // property, which is why they survived the migration rather than being dropped.

  // A non-ASCII suffix is not a word boundary for the purpose of this decision:
  // Python's `(?![-\w])` sees `日` as a word character and rejects the match.
  [false, 'git commit日本語'],

  // A non-breaking space (U+00A0) between `git` and `commit`. Python's `\s` is
  // Unicode-aware and matches it, so this IS a commit. This row is what makes
  // adding `re.ASCII` to any copy fail here — the flag would narrow `\s` and
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

/** One python3 spawn evaluates all three patterns over every case. */
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

describe('git-commit detection patterns agree across all three blocking copies', () => {
  it('extracts a non-empty pattern from each hook, from its own file', () => {
    for (const [i, pattern] of patterns.entries()) {
      expect(pattern.length, `${SOURCES[i].label} extracted an empty pattern`).toBeGreaterThan(10);
    }

    // WHAT THIS GUARDS: an extractor edited (or copy-pasted) to read the WRONG
    // FILE. Two entries pointed at one file would compare a pattern against
    // ITSELF for every case below and pass unconditionally — the guard reading
    // green while enforcing nothing, the exact failure it exists to prevent.
    // Distinct `file` plus distinct `extract` is what actually rules that out,
    // and it rules it out at the copy-paste itself: sharing the file is caught
    // here, and sharing only the extractor is caught by extractPattern's
    // exactly-one-line requirement, which a foreign extractor will not meet.
    //
    // WHAT IT NO LONGER GUARDS: equal pattern TEXT. Two of these three copies
    // are deliberately spelled identically — that is the point of unifying
    // them — so comparing the extracted strings for uniqueness would now fail
    // on the correct state of the tree.
    const files = SOURCES.map(source => source.file);
    expect(new Set(files).size, 'two sources named the same hook file').toBe(files.length);
    const extractors = SOURCES.map(source => String(source.extract));
    expect(new Set(extractors).size, 'two sources share one extractor regex').toBe(
      extractors.length
    );

    // The table still has to compare at least two DIFFERENT decisions, or the
    // agreement it reports is vacuous however many sources are listed.
    expect(
      new Set(patterns).size,
      'every source extracted the same pattern text — nothing is being compared'
    ).toBeGreaterThan(1);
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
