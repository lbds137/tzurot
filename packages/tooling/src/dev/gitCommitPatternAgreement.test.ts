/**
 * Agreement guard for the two git-commit-detection patterns.
 *
 * The same "does this command string invoke `git commit`" decision is encoded
 * twice in this repo, and both copies BLOCK:
 *
 *   1. `.claude/hooks/develop-code-commit-guard.sh`  — a Python regex
 *   2. `.claude/hooks/board-commit-branch-gate.sh`   — a Python regex, inside
 *      the python3 heredoc that hook already spawns for quote stripping
 *
 * The two copies are kept as separate literals for now, and moving the pattern
 * into the shared lib (`.claude/hooks/lib/shell_quotes.py`, which both hooks
 * already import for quote/heredoc stripping) so both hooks import one constant
 * is tracked as TASK-1257. Until then, the coupling is enforced here, because a
 * hand-managed sync already drifted once (a false-positive fix landed in one
 * copy before the other).
 *
 * Every copy is one a wrong verdict actually blocks a commit on, and both are
 * PYTHON regexes, which is why the evaluator below needs only a python3 spawn.
 *
 * In this test, the identity assertion pins the copies to one spelling while
 * the CASE TABLE pins the expected verdicts. The patterns are EXTRACTED from
 * the hook sources at run time, so editing one without the other fails the
 * identity assertion here; an extraction that stops matching is a hard failure,
 * never a silent pass.
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

/** Cases pinning the expected verdicts for the pattern. */
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
  // Both copies carry an inline (?i). Uppercase is not a hypothetical: shells
  // accept it, and a case-sensitive copy exits silently on it — for two BLOCKING
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
  // bash copy was compared here. With that copy retired, they sit alongside the
  // rest of the case table — each still pins a real property of the Python
  // pattern, which is why they survived the migration rather than being dropped.

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
/** verdicts[sourceIndex][caseIndex] */
const verdicts = pythonVerdicts(patterns, allInputs);

describe('git-commit detection pattern: one spelling, pinned verdicts', () => {
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
    // WHAT IT NO LONGER GUARDS: distinct pattern TEXT. The two remaining copies
    // are deliberately spelled identically — that is the point of unifying
    // them — so comparing the extracted strings for distinctness would fail
    // on the correct state of the tree.
    const files = SOURCES.map(source => source.file);
    expect(new Set(files).size, 'two sources named the same hook file').toBe(files.length);
    const extractors = SOURCES.map(source => String(source.extract));
    expect(new Set(extractors).size, 'two sources share one extractor regex').toBe(
      extractors.length
    );
  });

  it('keeps the two copies textually identical', () => {
    expect(
      new Set(patterns).size,
      `${SOURCES.map(s => s.file).join(' and ')} are spelled identically on purpose, ` +
        'so any edit must land in both'
    ).toBe(1);
  });

  for (const [caseIndex, [expected, input]] of AGREEMENT_CASES.entries()) {
    it(`${expected ? 'detects' : 'ignores'}: ${JSON.stringify(input)}`, () => {
      for (const [sourceIndex, source] of SOURCES.entries()) {
        expect.soft(verdicts[sourceIndex][caseIndex], source.label).toBe(expected);
      }
    });
  }
});
