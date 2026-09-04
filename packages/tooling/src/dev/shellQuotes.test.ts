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
 * Spawns one python3 process running `script` with `LIB_DIR` as `argv[1]`, feeds
 * `inputs` in as JSON on stdin, and parses the JSON result back out. Every helper
 * below differs only in its script body and its result type, so the spawn itself
 * lives here once.
 *
 * `PYTHONDONTWRITEBYTECODE` keeps the import from dropping a `__pycache__` beside
 * the library, where a stale `.pyc` could mask a broken edit.
 */
function runPython<T>(script: string, inputs: readonly string[]): T {
  const out = execFileSync('python3', ['-c', script, LIB_DIR], {
    input: JSON.stringify(inputs),
    encoding: 'utf-8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  return JSON.parse(out) as T;
}

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
  return runPython<(string | null)[]>(script, inputs);
}

/**
 * One python3 spawn evaluates one single-argument helper over every case.
 * Results come back through JSON so a list result and a string result are both
 * asserted as themselves rather than through a rendered form.
 */
function evalAll<T>(fn: string, inputs: readonly string[]): T[] {
  const script = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    `from shell_quotes import ${fn}`,
    `json.dump([${fn}(c) for c in json.load(sys.stdin)], sys.stdout)`,
  ].join('\n');
  return runPython<T[]>(script, inputs);
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

/**
 * `strip_quoted` replaces a quoted span WHOLE, so a command substitution nested
 * inside one is erased while bash still executes it — measured, that let
 * `echo "$(git commit -m x)"` through the blocking commit guard. These two
 * helpers are what the guards use instead of trusting the stripped text.
 */
const SPAN_CASES: readonly (readonly [string, string, readonly string[]])[] = [
  ['no substitution yields no spans', 'git commit -m "x"', []],
  ['a $( ) span inside double quotes', 'echo "$(git commit -m x)"', ['git commit -m x']],
  ['a backtick span inside double quotes', 'echo "`git commit -m x`"', ['git commit -m x']],
  ['an unquoted $( ) span', 'echo $(git commit)', ['git commit']],
  ['two spans in one command', 'echo $(a) and `b`', ['a', 'b']],

  // Nesting is paren DEPTH only. The caller runs a regex over the content, and
  // a regex sees the inner text inside the outer span just as well — recursing
  // would only produce duplicate hits.
  ['a nested span is returned inside its outer span, verbatim', 'echo $(a $(b))', ['a $(b)']],

  // An escaped opener is not an opener.
  ['an escaped backtick opens nothing', 'echo \\`x\\`', []],
  ['an escaped dollar opens nothing', 'echo \\$(git commit)', []],

  // Unterminated runs to end of text. Safe here in a way it is not for
  // strip_quoted: this function only ADDS text for the caller to scan.
  ['an unterminated $( runs to end of text', 'echo "$(git commit', ['git commit']],
  ['an unterminated backtick runs to end of text', 'echo `git commit', ['git commit']],

  // THE ACCEPTED OVER-ARM. A span inside SINGLE quotes is inert prose to bash
  // and is extracted anyway, so the consuming guards block on it. Over-arming
  // is the recoverable direction for a blocking guard; the escape hatch covers
  // the false positive.
  [
    'a span inside single quotes is extracted anyway (accepted over-arm)',
    "echo 'run $(git commit)'",
    ['git commit'],
  ],

  // THE KNOWN UNDER-ARM, pinned AS the limit rather than left to be discovered.
  // `)` is counted structurally, so a quoted one inside the span ends it early
  // and the command names after it escape the scan.
  ['a quoted `)` inside a span ends it early', 'echo "$(echo ")" && git commit)"', ['echo "']],
];

describe('shell_quotes.substitution_spans', () => {
  const results = evalAll<string[]>(
    'substitution_spans',
    SPAN_CASES.map(([, input]) => input)
  );

  for (const [index, [label, input, expected]] of SPAN_CASES.entries()) {
    it(label, () => {
      expect(results[index], `input: ${JSON.stringify(input)}`).toEqual([...expected]);
    });
  }
});

/**
 * The companion strip: a heredoc body is DATA, and the repo's canonical commit
 * form puts the whole message inside a substitution span. Without this, a span
 * scan of `-m "$(cat <<'EOF' … EOF)"` reads the commit MESSAGE as a command.
 */
const HEREDOC_CASES: readonly (readonly [string, string, string])[] = [
  ['text with no heredoc is returned unchanged', 'git commit -m x', 'git commit -m x'],
  ["a quoted marker's body is dropped", "cat <<'EOF'\ngit commit\nEOF\n", "cat <<'EOF'\n\n"],
  ["a bare marker's body is dropped", 'cat <<EOF\ngit commit\nEOF\n', 'cat <<EOF\n\n'],
  ['a double-quoted marker works too', 'cat <<"EOF"\ngit commit\nEOF\n', 'cat <<"EOF"\n\n'],

  // `<<-` is the only form whose terminator may be indented, and bash allows
  // only TABS there. The non-dash row is what pins that the indent tolerance is
  // not applied everywhere.
  [
    'the <<- form accepts an indented terminator',
    'cat <<-EOF\n\tgit commit\n\tEOF\n',
    'cat <<-EOF\n\n',
  ],
  // An indented terminator does not close a plain (non-`<<-`) heredoc, so this
  // is UNTERMINATED — and an unterminated heredoc now KEEPS its tail rather than
  // dropping it (over-arm), because this runs on the whole raw command where a
  // dropped tail can hide a real target.
  [
    'an indented terminator leaves a plain heredoc unterminated; tail kept',
    'cat <<EOF\n\tEOF\ngit commit',
    'cat <<EOF\n\tEOF\ngit commit',
  ],

  // Unterminated KEEPS the tail — the same over-arm direction as the sibling
  // stripper in pr-merge-review-check.sh. Dropping it here would let a `<<WORD`
  // inside earlier quoted prose truncate a real $(…) target out of the scan (a
  // measured bypass); keeping it can only over-block.
  [
    'an unterminated heredoc keeps its tail (over-arm, not dropped)',
    'cat <<EOF\ngit commit\n',
    'cat <<EOF\ngit commit\n',
  ],

  // The rest of the OPENER line is real command text and survives.
  [
    'the rest of the opener line survives',
    'cat <<EOF > notes.txt\ngit commit\nEOF\n',
    'cat <<EOF > notes.txt\n\n',
  ],

  // A here-string is not a heredoc: its trailing `<` plus a bare word matches
  // the same characters, and the marker would never terminate.
  [
    'a here-string is not read as an opener',
    'cat <<<marker && git commit',
    'cat <<<marker && git commit',
  ],

  // The shape this function exists for, asserted end to end.
  [
    'the canonical commit-message span keeps its skeleton and loses its body',
    "cat <<'EOF'\nfix: stop saying git commit in prose\nEOF\n",
    "cat <<'EOF'\n\n",
  ],

  // KNOWN LIMITATION (matches the sibling strip_heredocs): only the FIRST
  // opener on a line is recognized, so with two openers on one line the second
  // body survives un-stripped. Safe — an un-stripped body only adds text to
  // scan, never hides a target.
  [
    'second heredoc opener on a line leaves its body',
    'cat <<A <<B\naaa-body\nA\nbbb-body\nB\ntrailer\n',
    'cat <<A <<B\n\nbbb-body\nB\ntrailer\n',
  ],
];

describe('shell_quotes.strip_heredoc_bodies', () => {
  const results = evalAll<string>(
    'strip_heredoc_bodies',
    HEREDOC_CASES.map(([, input]) => input)
  );

  for (const [index, [label, input, expected]] of HEREDOC_CASES.entries()) {
    it(label, () => {
      expect(results[index], `input: ${JSON.stringify(input)}`).toBe(expected);
    });
  }

  it('suppresses a commit-shaped message body inside a canonical commit span', () => {
    // The two functions in composition, which is how both guards call them —
    // and the property that actually matters: the span of a real canonical
    // commit carries a message mentioning `git commit`, and what the guards
    // scan must not contain it.
    const command = [
      "git commit -m \"$(cat <<'EOF'",
      'docs: explain when to git commit',
      'EOF',
      ')"',
    ].join('\n');
    const spans = evalAll<string[]>('substitution_spans', [command])[0];
    expect(spans).toHaveLength(1);
    expect(spans[0]).toContain('git commit');
    expect(evalAll<string>('strip_heredoc_bodies', [spans[0]])[0]).not.toContain('git commit');
  });
});

/**
 * `HEREDOC_OPENER` is exported so a consumer can compose its own pattern from
 * it — lossy-pipe-guard.sh rebuilds an opener from the match groups rather than
 * re-typing the regex, which silently drops the here-string lookbehind. That
 * makes the GROUP NUMBERING an exported contract, so it gets an assertion of
 * its own rather than resting on the hook probes downstream.
 */
function openerGroups(inputs: readonly string[]): (string[] | null)[] {
  const script = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'from shell_quotes import HEREDOC_OPENER',
    'def groups(c):',
    '    m = HEREDOC_OPENER.search(c)',
    '    return None if m is None else [m.group(1), m.group(2), m.group(3)]',
    'json.dump([groups(c) for c in json.load(sys.stdin)], sys.stdout)',
  ].join('\n');
  return runPython<(string[] | null)[]>(script, inputs);
}

describe('shell_quotes.HEREDOC_OPENER (exported group contract)', () => {
  it('numbers its groups indent-flag, quote-char, marker', () => {
    expect(openerGroups(["cat <<-'EOF'"])[0]).toEqual(['-', "'", 'EOF']);
    expect(openerGroups(['cat <<"EOF"'])[0]).toEqual(['', '"', 'EOF']);
    expect(openerGroups(['cat <<EOF'])[0]).toEqual(['', '', 'EOF']);
  });

  it('does not match a here-string', () => {
    expect(openerGroups(['git commit -F - <<<Fixup'])[0]).toBeNull();
  });
});

/**
 * Runs `substitution_spans_matching` with a fixed `'git commit' in span`
 * predicate, exercising the full composition both blocking guards rely on
 * (heredoc-strip the WHOLE raw text → extract spans → strip_quoted each →
 * predicate). A predicate can't cross the JSON boundary, so it is baked into
 * the python snippet.
 */
function spansMatchGitCommit(inputs: readonly string[]): boolean[] {
  const script = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'from shell_quotes import substitution_spans_matching',
    "pred = lambda s: 'git commit' in s.lower()",
    'json.dump([substitution_spans_matching(c, pred) for c in json.load(sys.stdin)], sys.stdout)',
  ].join('\n');
  return runPython<boolean[]>(script, inputs);
}

describe('shell_quotes.substitution_spans_matching (composition used by both guards)', () => {
  it('matches a target hidden in a real substitution span', () => {
    expect(spansMatchGitCommit(['echo "$(git commit -m x)"'])[0]).toBe(true);
  });

  it('does NOT match a target in an inert heredoc body — heredocs are stripped FIRST', () => {
    // If the whole raw text were not heredoc-stripped before span extraction,
    // the $(git commit) in this bare-heredoc body would be pulled out as a span
    // and falsely match. This pins the strip-then-extract order.
    const cmd = ["cat <<'EOF' > notes.md", 'we fixed the $(git commit -m x) bypass', 'EOF'].join(
      '\n'
    );
    expect(spansMatchGitCommit([cmd])[0]).toBe(false);
  });

  it('does NOT match a target that is only quoted prose inside a span — strip_quoted runs', () => {
    expect(spansMatchGitCommit(['echo "$(gh pr comment --body "git commit early")"'])[0]).toBe(
      false
    );
  });

  it('still matches when a real invocation sits beside quoted prose in the span', () => {
    // strip_quoted removes the quoted arg but leaves the real command word.
    expect(spansMatchGitCommit(['echo "$(git commit -m "wip")"'])[0]).toBe(true);
  });

  it('is span-only: a top-level target with no substitution does not match', () => {
    expect(spansMatchGitCommit(['git commit -m x'])[0]).toBe(false);
  });

  it('a target after an unterminated heredoc opener still matches (no truncation bypass)', () => {
    // The regression guard for the whole-command heredoc strip: a `<<WORD`-shaped
    // string in earlier quoted prose with no terminator must NOT drop the real
    // $(git commit) span that follows. strip_heredoc_bodies keeps the tail on an
    // unterminated opener, so the span survives and matches.
    const cmd = ['echo "notes: <<EOF"', 'echo "$(git commit -m x)"'].join('\n');
    expect(spansMatchGitCommit([cmd])[0]).toBe(true);
  });
});

/**
 * `executed_segments` answers a question `strip_quoted` structurally cannot:
 * a wrapper (`bash -c`, `sh -c`, `zsh -c`, `eval`) EXECUTES its string
 * argument, so stripping that argument to a placeholder erases a real command,
 * while stripping `echo`'s argument correctly makes inert text inert. Element 0
 * is always the plain strip; the rest are the unwrapped arguments.
 */
function segments(inputs: readonly string[]): string[][] {
  return evalAll<string[]>('executed_segments', inputs);
}

describe('shell_quotes.executed_segments', () => {
  it('returns the quote-stripped command as the first segment', () => {
    expect(segments(['git status'])[0]).toEqual(['git status']);
    expect(segments(['echo "hello"'])[0]).toEqual(['echo S']);
  });

  it.each([
    ['bash -c', 'bash -c "pnpm tracker task create x"'],
    ['sh -c', "sh -c 'pnpm tracker task create x'"],
    ['zsh -c', 'zsh -c "pnpm tracker task create x"'],
    ['eval', 'eval "pnpm tracker task create x"'],
  ])('unwraps the argument %s executes', (_label, cmd) => {
    expect(segments([cmd])[0]).toContain('pnpm tracker task create x');
  });

  it('leaves a non-wrapper argument stripped — echo does not execute its argument', () => {
    // The discriminating pair: identical characters, opposite answers. Without
    // it, a function that simply unwrapped EVERY quoted span would pass every
    // case above while destroying the property the strip exists for.
    expect(segments(['echo "pnpm tracker task create x"'])[0]).toEqual(['echo S']);
  });

  it('recognizes a wrapper only at command position', () => {
    // `bash` here is a word being printed, not a shell being run.
    expect(segments(['echo bash -c "pnpm tracker task create x"'])[0]).toEqual(['echo bash -c S']);
  });

  it('recognizes a wrapper after a separator', () => {
    expect(segments(['ls && bash -c "inner cmd"'])[0]).toContain('inner cmd');
  });

  it('tolerates a path-qualified wrapper and a short-option cluster', () => {
    expect(segments(['/bin/sh -lc "inner cmd"'])[0]).toContain('inner cmd');
  });

  it('resolves escaped quotes so a nested wrapper unwraps to a real command', () => {
    // The inner argument's `\"` are literal quotes to bash, so the nested
    // command must come back unescaped rather than carrying backslashes.
    expect(segments(['bash -c "bash -c \\"inner cmd\\""'])[0]).toEqual([
      'bash -c S',
      'bash -c S',
      'inner cmd',
    ]);
  });

  it('stops recursing at the depth cap instead of running away', () => {
    // Five wrappers deep; the cap admits three levels of unwrapping, so the
    // deepest payload is never reached and the result stays bounded.
    let cmd = 'deepest cmd';
    for (let i = 0; i < 5; i++) cmd = `bash -c ${JSON.stringify(cmd)}`;
    const result = segments([cmd])[0];
    expect(result).toHaveLength(4);
    expect(result.join('\n')).not.toContain('deepest cmd');
  });

  it('falls back to the raw text when a quote is unterminated', () => {
    // strip_quoted returns None there; keeping the raw text over-arms a scanning
    // caller, which is the recoverable direction for every consumer.
    expect(segments(['bash -c "unterminated'])[0]).toEqual(['bash -c "unterminated']);
  });

  it('yields no wrapper segment when -c has no following word', () => {
    expect(segments(['bash -c'])[0]).toEqual(['bash -c']);
  });
});

/**
 * `wrapped_command_strings` is exercised directly, not only through
 * `executed_segments`, because it has a second caller: board-commit-branch-gate.sh
 * consumes it straight, not `executed_segments`. That gate needs the RAW,
 * unquoted inner string rather than `executed_segments`' already quote-stripped
 * segments, so it can build its own resolvable view per level.
 */
function wrapperArgs(inputs: readonly string[]): string[][] {
  return evalAll<string[]>('wrapped_command_strings', inputs);
}

describe('shell_quotes.wrapped_command_strings', () => {
  it.each([
    ['bash -c', 'bash -c "inner cmd"'],
    ['sh -c', "sh -c 'inner cmd'"],
    ['eval', 'eval "inner cmd"'],
  ])('returns the unquoted argument of a %s invocation', (_label, cmd) => {
    expect(wrapperArgs([cmd])[0]).toEqual(['inner cmd']);
  });

  it('recognizes a wrapper only at command position', () => {
    // `bash` here is a word being printed, not a shell being run, so nothing
    // is unwrapped.
    expect(wrapperArgs(['echo bash -c "inner cmd"'])[0]).toEqual([]);
  });

  it('does not let a leading env-assignment hide the wrapper behind it', () => {
    // Pins bash's own rule: an assignment prefix leaves the NEXT word at
    // command position, so the wrapper after it is still a wrapper.
    expect(wrapperArgs(['FOO=1 bash -c "inner cmd"'])[0]).toEqual(['inner cmd']);
  });

  it('skips more than one leading assignment before the wrapper', () => {
    expect(wrapperArgs(['FOO=1 BAR=2 sh -c "inner cmd"'])[0]).toEqual(['inner cmd']);
  });
});

/**
 * `strip_quoted_indexed` and `resolve_placeholders` exist beside `strip_quoted`
 * rather than replacing it: `strip_quoted`'s `S` placeholder erases a quoted
 * span's value, which is exactly right for a structural scan (a caller that
 * only asks "is this a `git commit`?") but wrong for a caller that must
 * recover a real PATHSPEC from the view — board-commit-branch-gate.sh's `git
 * add` extraction needs the actual quoted path back, not a token that reads
 * as "some string was here". `strip_quoted` itself was not simply changed to
 * carry values, because its `S` output is a pinned contract read by three
 * hooks (see the CASES describe block above) — a second function keeps that
 * contract untouched while adding the one extra capability one caller needs.
 */
const QUOTED_SPAN = '\u{e000}';
const ESCAPED_BLANK = '\u{e001}';

/** [label, input, expected [view, values] or null] */
const INDEXED_CASES: readonly (readonly [string, string, [string, string[]] | null])[] = [
  [
    'a double-quoted span becomes one placeholder carrying its value',
    'git commit -m "hello"',
    [`git commit -m ${QUOTED_SPAN}`, ['hello']],
  ],
  [
    'a single-quoted span becomes one placeholder carrying its value',
    "git commit -m 'hello'",
    [`git commit -m ${QUOTED_SPAN}`, ['hello']],
  ],
  [
    'two spans resolve to values in TEXT order',
    'echo "a" "b"',
    [`echo ${QUOTED_SPAN} ${QUOTED_SPAN}`, ['a', 'b']],
  ],
  [
    'a backslash-escaped space outside quotes becomes ESCAPED_BLANK',
    'git\\ commit',
    [`git${ESCAPED_BLANK}commit`, []],
  ],
  [
    'an escaped pipe outside quotes is still Q, same as strip_quoted',
    'git commit -m x\\|tail',
    ['git commit -m xQtail', []],
  ],
  ['an unterminated quote returns null, same as strip_quoted', 'git commit -m "oops', null],
  // A literal placeholder codepoint in the INPUT is refused outright rather
  // than scanned: in the view it would be indistinguishable from a real
  // placeholder, so a caller counting placeholders before a token would read a
  // shifted value index for every later token. Same null signal — and so the
  // same raw-text fallback — as an unterminated quote.
  [
    'a literal QUOTED_SPAN codepoint outside quotes returns null',
    `echo ${QUOTED_SPAN} && git add "a b"`,
    null,
  ],
  [
    'a literal ESCAPED_BLANK codepoint outside quotes returns null',
    `echo ${ESCAPED_BLANK} && git add "a b"`,
    null,
  ],
];

describe('shell_quotes.strip_quoted_indexed', () => {
  const results = evalAll<[string, string[]] | null>(
    'strip_quoted_indexed',
    INDEXED_CASES.map(([, input]) => input)
  );

  for (const [index, [label, input, expected]] of INDEXED_CASES.entries()) {
    it(label, () => {
      expect(results[index], `input: ${JSON.stringify(input)}`).toEqual(expected);
    });
  }
});

/**
 * `resolve_placeholders` takes three arguments, so `evalAll` (built for
 * single-argument helpers) does not fit — this follows the shape of
 * `openerGroups` and `spansMatchGitCommit` above, each building its own
 * script for a non-single-argument call.
 */
function resolvePlaceholders(
  cases: readonly (readonly [string, string[], number])[]
): [string, number][] {
  const script = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'from shell_quotes import resolve_placeholders',
    'cases = json.load(sys.stdin)',
    'json.dump([list(resolve_placeholders(c[0], c[1], c[2])) for c in cases], sys.stdout)',
  ].join('\n');
  // runPython's signature is typed for the (much more common) single-string-
  // per-case callers above; the JSON boundary itself doesn't care what shape
  // each case is, so the cast just satisfies TypeScript.
  return runPython<[string, number][]>(script, cases as unknown as readonly string[]);
}

/** [label, token, values, next_index, expected [resolved, index]] */
const PLACEHOLDER_CASES: readonly (readonly [
  string,
  string,
  string[],
  number,
  [string, number],
])[] = [
  [
    'round-trips a token holding TWO placeholders, index advances by two',
    `${QUOTED_SPAN} ${QUOTED_SPAN}`,
    ['a', 'b'],
    0,
    ['a b', 2],
  ],
  [
    'a token with no placeholder is returned unchanged, index unchanged',
    'plain',
    ['a'],
    0,
    ['plain', 0],
  ],
  [
    // Pins the fail-open direction the lib docstring names: a surplus
    // placeholder (more requested than remain) is left in the output rather
    // than raising, and the index clamps at len(values) instead of
    // overshooting it.
    'a surplus placeholder (more than remaining values) is left in place, index clamped at len(values)',
    `${QUOTED_SPAN}${QUOTED_SPAN}`,
    ['a'],
    0,
    [`a${QUOTED_SPAN}`, 1],
  ],
  ['ESCAPED_BLANK resolves to a real space', `a${ESCAPED_BLANK}b`, [], 0, ['a b', 0]],
];

describe('shell_quotes.resolve_placeholders', () => {
  const results = resolvePlaceholders(
    PLACEHOLDER_CASES.map(([, token, values, nextIndex]) => [token, values, nextIndex])
  );

  for (const [index, [label, token, values, nextIndex, expected]] of PLACEHOLDER_CASES.entries()) {
    it(label, () => {
      expect(
        results[index],
        `token: ${JSON.stringify(token)}, values: ${JSON.stringify(values)}, next_index: ${nextIndex}`
      ).toEqual(expected);
    });
  }
});
