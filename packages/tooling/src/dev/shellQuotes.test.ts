/**
 * CI coverage for `.claude/hooks/lib/shell_quotes.py` — the shell quote scanner
 * shared by three PreToolUse hooks.
 *
 * WHY IT HAS ITS OWN TEST rather than being covered through its consumers: it
 * had none while it was three private copies, and the copies diverged. Each
 * consumer's .probe.sh exercises it only through that hook's own verdict, which
 * means a scanner bug is visible there only when it happens to flip a verdict —
 * so the shapes that matter most (an unterminated quote, an escaped structural
 * character) were being asserted nowhere. This file pins the scanner's OUTPUT
 * directly; the probes keep pinning the verdicts.
 *
 * Both surfaces are CI-enforced. `guard:hook-probes` runs every probe in the
 * lint job and in `pnpm quality`; this runs in the tooling unit cell.
 *
 * EXTERNAL BINARY: this shells out to `python3`, because the only honest way to
 * evaluate the scanner is to run it through the engine the hooks use. python3
 * was already a prerequisite of both those hooks and of
 * gitCommitPatternAgreement.test.ts; a minimal image dropping it surfaces here
 * as an ENOENT at collection time.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIB_DIR = fileURLToPath(new URL('../../../../.claude/hooks/lib', import.meta.url));

/**
 * One python3 spawn strips every case. `null` is the unterminated-quote signal,
 * carried through JSON so this test can assert it rather than inferring it from
 * a returned string.
 */
function stripAll(inputs: readonly string[]): (string | null)[] {
  const script = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'from shell_quotes import strip_quoted',
    'json.dump([strip_quoted(c) for c in json.load(sys.stdin)], sys.stdout)',
  ].join('\n');
  const out = execFileSync('python3', ['-c', script, LIB_DIR], {
    input: JSON.stringify(inputs),
    encoding: 'utf-8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  return JSON.parse(out) as (string | null)[];
}

/** [label, input, expected output] — `null` means "unterminated, strip nothing". */
const CASES: readonly (readonly [string, string, string | null])[] = [
  ['leaves an unquoted command alone', 'git status', 'git status'],
  ['replaces a double-quoted span', 'git commit -m "hello"', 'git commit -m S'],
  ['replaces a single-quoted span', "git commit -m 'hello'", 'git commit -m S'],

  // The bug this scanner exists for. Two independent regex passes paired the
  // apostrophes across the `&&` and erased the `git commit` between them.
  [
    'an apostrophe inside double quotes is literal',
    'echo "it\'s" && git commit -m "won\'t"',
    'echo S && git commit -m S',
  ],
  [
    'the mirror: a double quote inside single quotes is literal',
    'echo \'say "hi"\' && git commit -m x',
    'echo S && git commit -m x',
  ],
  [
    'apostrophes straddling an unquoted token do not swallow it',
    'git commit -m "it\'s" && git add packages/x.ts && echo "don\'t"',
    'git commit -m S && git add packages/x.ts && echo S',
  ],

  // Escapes. Outside quotes bash escapes ANY character and the character keeps
  // its value, so collapsing escapes to a placeholder HID command names from
  // the callers' scans — measured, a commit piped into `t\ail` exited 0 while
  // bash ran tail exactly as written.
  ['an escaped letter keeps its value', 'git push | t\\ail -5', 'git push | tail -5'],
  ['an escaped quote cannot open a span', 'echo \\"x', 'echo Qx'],
  ['an even backslash run is not an escaped quote', 'echo \\\\"x"', 'echo \\S'],

  // A structural character that was ESCAPED is a literal in an argument, not
  // syntax. The callers split on these, so re-emitting them bare invented a
  // pipeline stage that bash never runs.
  ['an escaped pipe is not a pipeline operator', 'git commit -m x\\|tail', 'git commit -m xQtail'],
  ['an escaped semicolon is not a separator', 'echo a\\;b', 'echo aQb'],
  ['a real pipe survives untouched', 'git push | tail -5', 'git push | tail -5'],

  // Inside single quotes bash gives backslash no meaning at all, so a trailing
  // backslash does NOT escape the closing quote.
  ['no escapes inside single quotes', "echo 'a\\' && git commit", 'echo S && git commit'],
  ['a backslash escapes the closing double quote', 'echo "a\\" still in" && x', 'echo S && x'],

  // ANSI-C quoting (`$'...'`) is a KNOWN SCOPE BOUNDARY, pinned here rather
  // than left unstated. Bash gives `$'...'` backslash escapes while `'...'` has
  // none, and the two share a delimiter, so the scanner — which implements the
  // plain-single-quote rule — mis-pairs an escaped apostrophe inside one. This
  // is not hypothetical for this repo: `06-backlog.md` documents
  // `pnpm tracker task create -d $'Why: …\nFix: …'` as the recommended shape.
  //
  // What these pin is the DIRECTION of the mistake. The desync leaves an odd
  // number of open quotes, so the scan ends unterminated and returns null —
  // the caller then scans raw text and the target stays visible, which
  // over-arms. Fixing the pairing properly would mean modelling `$'` as its own
  // span type; worth doing only if a case ever lands on the other side, and
  // these cases are what would catch that.
  [
    "an escaped apostrophe in $'...' desyncs to null, not a swallow",
    "echo $'it\\'s' && git commit -m x",
    null,
  ],
  [
    '...also when it straddles the target',
    "echo $'a\\'b' && git commit -m x && echo $'c\\'d'",
    null,
  ],
  ['...also on the pipe form rule 1 protects', "git commit -m $'it\\'s' | tail -5", null],
  // TWO escapes in one construct, and two constructs each carrying one. The
  // single-escape cases below establish the direction; these are what make it a
  // pinned property rather than an inference, because the worry is a mis-scan
  // that RE-synchronises to a cleanly-terminated result with a `git commit`
  // absorbed inside it — that would be a bypass, not an over-arm.
  [
    "two escapes in one $'...' span still desync to null",
    "echo $'a\\'b\\'c' && git commit -m x",
    null,
  ],
  [
    "two $'...' constructs straddling the target desync to null",
    "echo $'a\\'b' && git commit -m x && echo $'c\\'d'",
    null,
  ],

  // Without an escaped apostrophe, `$'...'` and `'...'` are identical, so these
  // strip normally and the `$` survives as an ordinary character.
  [
    "$'...' with no escape behaves like a plain single-quoted span",
    "echo $'plain' && git commit -m x",
    'echo $S && git commit -m x',
  ],
  [
    'the documented tracker shape strips cleanly',
    "pnpm tracker task create 'T' -d $'Why: x\\nFix: y' && git commit -m x",
    'pnpm tracker task create S -d $S && git commit -m x',
  ],

  // A backslash-newline is a LINE CONTINUATION, not an escape: bash deletes
  // both characters and splices with nothing between. Emitting a placeholder
  // here fabricated a non-whitespace token between two words bash runs
  // adjacently, and since every target regex needs `\s+` adjacency, an
  // ordinary multi-line `git \<newline> commit` slipped the blocking guard
  // entirely. Both directions are pinned, because the splice is only correct
  // if it also produces the NON-match.
  [
    'a line continuation splices, preserving word adjacency',
    'git \\\n  commit -m "msg"',
    'git   commit -m S',
  ],
  [
    '...and splices words TOGETHER when no space surrounds it',
    'git\\\ncommit -m x',
    'gitcommit -m x',
  ],
  [
    'a continuation inside a double-quoted span stays inside it',
    'git commit -m "line one \\\nline two"',
    'git commit -m S',
  ],

  // The failure direction: strip nothing, so a caller over-arms rather than
  // losing a real invocation to an accidental end-of-text delete.
  ['an unterminated double quote strips nothing', 'git commit -m "oops', null],
  ['an unterminated single quote strips nothing', "git commit -m 'oops", null],
  ['a trailing lone backslash is emitted as itself', 'git commit -m x\\', 'git commit -m x\\'],
];

describe('shell_quotes.strip_quoted (shared by three hooks)', () => {
  const results = stripAll(CASES.map(([, input]) => input));

  for (const [index, [label, input, expected]] of CASES.entries()) {
    it(label, () => {
      expect(results[index], `input: ${JSON.stringify(input)}`).toBe(expected);
    });
  }

  it('leaves no quote character behind in any successful strip', () => {
    // The property every caller relies on but none of them states: after a
    // successful strip, no `"` or `'` survives — neither as a span delimiter
    // nor as an escaped literal (that is what the `Q` placeholder is for). All
    // three hooks then scan and split the result as if it were bare syntax, so
    // a surviving quote is a quote they would misread as structure.
    //
    // Deliberately NOT an idempotence assertion, which is the invariant this
    // shape invites and the function does not have: `echo \S` re-strips to
    // `echo S`, because a placeholder in the output is indistinguishable from
    // an escaped letter in a fresh input. Nothing re-strips, so nothing needs
    // it — asserting it would have pinned a property no caller wants.
    for (const [index, [label]] of CASES.entries()) {
      const stripped = results[index];
      if (stripped === null) continue;
      expect(stripped, label).not.toMatch(/["']/);
    }
  });
});
