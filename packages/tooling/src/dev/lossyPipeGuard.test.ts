/**
 * CI coverage for `.claude/hooks/lossy-pipe-guard.sh` — the PreToolUse guard
 * blocking output that must be read whole from being piped into something that
 * discards part of it. The hook's parsing (segment/pipeline splitting, heredoc
 * stripping, flag-tolerant matching) is meaningfully more complex than its
 * sibling hooks', so its case matrix lives here where a regression fails CI
 * instead of silently degrading the guard.
 *
 * This file is NOT the only CI-enforced surface, and reading it that way leads
 * to porting cases that are already covered. `guard:hook-probes` runs
 * lossy-pipe-guard.probe.sh in the CI lint job and in `pnpm quality`, so every
 * probe case fails CI too. The split is by what each harness can express, not
 * by which one CI runs: wall-clock bounds (the catastrophic-backtracking
 * regression) live in the probe, because a timing assertion inside a unit suite
 * is a flake source. Shape and verdict cases live here.
 *
 * Two rules with DIFFERENT lossy sets, which is the thing most likely to be
 * "simplified" into one by a later reader:
 *
 *   1. git commit/push × any filter (tail/head/grep/sed/awk)
 *   2. gh READ commands × truncation only (head/tail/`sed -n`)
 *
 * Rule 2's allow-side cases are load-bearing, not padding: `gh pr checks N |
 * grep -v pass` is the CORRECT query, and a guard that blocks it gets routed
 * around, which is worse than no guard. Test both directions per rule.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const HOOK = path.resolve(__dirname, '../../../../.claude/hooks/lossy-pipe-guard.sh');

/** Run the hook exactly as the harness does: tool JSON on stdin, exit code out. */
function runHook(command: string): number {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  try {
    execFileSync('bash', [HOOK], { input, stdio: ['pipe', 'ignore', 'ignore'] });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe('lossy-pipe-guard hook', () => {
  const BLOCKED: [string, string][] = [
    ['commit piped to tail', 'git commit -m "fix: x" 2>&1 | tail -2 && git push'],
    ['push piped to tail', 'git push origin develop 2>&1 | tail -1'],
    ['cat interposed before the filter', 'git push origin b 2>&1 | cat | tail -20'],
    ['|& shorthand', 'git push origin b |& tail -20'],
    ['global flag between git and subcommand', 'git --no-pager push origin b | grep -v x'],
    ['-c config flag', 'git -c commit.gpgsign=false commit -m x | tail'],
    ['-C path form', 'git -C /repo commit -m msg | grep -v noise'],
    // One case per remaining FILTERS keyword — a regex typo dropping any of
    // them must fail CI, not silently degrade the guard.
    ['head filter', 'git push origin b 2>&1 | head -3'],
    ['sed filter', 'git commit -m x 2>&1 | sed s/a/b/'],
    ['awk filter', 'git push origin b | awk NR==1'],
    // Rule 2. The incident shape: a red `lint` row at the TOP of the list,
    // removed by a positional cut, reported to the owner as green.
    ['gh pr checks truncated by tail', 'gh pr checks 2000 | tail -30'],
    ['gh pr view truncated by head', 'gh pr view 2000 | head -20'],
    ['gh run list truncated', 'gh run list --limit 50 | head -10'],
    ['ops review wrapper truncated', 'pnpm ops gh:pr-comments 2013 | tail -50'],
    // Every `pnpm ops gh:*` wrapper is a read command; enumerating two left
    // gh:pr-info and gh:ci-gate uncovered, the latter printing a check list.
    ['ops gh:pr-info truncated', 'pnpm ops gh:pr-info 2013 | tail -50'],
    ['ops gh:ci-gate truncated', 'pnpm ops gh:ci-gate 2013 | tail -50'],
    ['sed -n windowing is a positional cut', "gh pr checks 2000 | sed -n '5,20p'"],
    // `sed "5q"` is head -5 with no -n anywhere, and the script is quoted so it
    // is invisible to the scan. sed is therefore blocked outright on gh reads —
    // substitution included, which is the accepted cost.
    ['sed bare q truncates without -n', 'gh pr checks 2000 | sed "5q"'],
    ['sed substitution blocked too', "gh pr checks 2000 | sed -e 's/a/b/'"],
    // Combined and reordered sed flags truncate identically; a `\\b` cannot fire
    // mid-token, so a standalone-first-flag regex matched none of these.
    ['sed combined -ne', "gh pr checks 2000 | sed -ne '5,20p'"],
    ['sed with -n not first', "gh pr checks 2000 | sed --posix -n '5,20p'"],
    // GATE BYPASS, measured before the fix. The quote-stripping passes pair raw
    // quote characters with no notion of escaping, so an odd count swallows the
    // rest of the pipeline — the real `|` and its lossy stage vanish into one
    // token and the scan sees nothing to block. The git case predates the gh
    // rule: a commit message with an escaped quote is ordinary to write.
    ['odd escaped-quote count, gh rule', 'gh pr checks 2000 | grep "a\\"" | tail "-5"'],
    ['odd escaped-quote count, git rule', 'git commit -m "a\\"" | tail "-5"'],
    // Global flags sit between `gh` and its subcommand; `--repo` is the standard
    // cross-repo form. The bash PRE-FILTER required adjacency too, so tightening
    // only the python regex left this fully open — a pre-filter is a second gate.
    ['gh --repo before the subcommand', 'gh --repo owner/name pr checks 2000 | tail -5'],
    ['gh -R shorthand', 'gh -R owner/name pr checks 2000 | head -5'],
    // The grep FAMILY. Same tool under another name, bypassing the ORIGINAL rule.
    ['push piped to egrep', 'git push origin b | egrep fatal'],
    ['commit piped to fgrep', 'git commit -m x | fgrep error'],
    ['push piped to zgrep', 'git push origin b | zgrep warn'],
    // Case and leading redirects were both live bypasses. The bash pre-filter
    // is checked before the tokenizer, so case-insensitivity had to be applied
    // on BOTH sides — python alone would have fixed nothing.
    ['uppercase filter name', 'git commit -m "x" | TAIL -5'],
    ['uppercase target command', 'GIT COMMIT -m "x" | tail -5'],
    // Rule 2's own case pin: case-insensitivity was a measured bypass fixed
    // here, and the gh side had no regression case of its own.
    ['uppercase gh target and filter', 'GH PR CHECKS 2000 | TAIL -30'],
    ['leading redirect before the filter', 'git push origin b | 2>&1 tail -20'],
    // Backslash PARITY. An even run is one literal backslash and leaves the
    // quote unescaped; neutralizing by presence rather than parity ate the real
    // closing quote and swallowed the pipe. Measured as a regression against
    // the pre-fix hook, which blocked this input.
    ['even backslash run, git rule', 'git commit -m "path\\\\" | grep -i "error"'],
    ['even backslash run, gh rule', 'gh pr checks 2000 | grep "x\\\\" | tail -5'],
    // The single-quote MIRROR: bash gives backslash no meaning inside '...', so
    // `'a\\'` is a complete string. Treating it as an escape orphaned the opener,
    // which paired with grep's quote and swallowed the pipe.
    ['backslash before a closing single quote', "git commit -m 'a\\\\' | grep 'x'"],
    // An ordinary apostrophe in one double-quoted arg paired with one in a
    // later arg, erasing the pipe between them. Fixed by a stateful scan; a
    // reordering only mirrors the bug.
    ['apostrophes in two double-quoted args', 'git commit -m "it\'s" | grep "isn\'t"'],
    ['mirror: quotes inside single-quoted args', `git commit -m 'say "hi"' | grep 'say "bye"'`],
  ];

  const ALLOWED: [string, string][] = [
    ['plain && chain', 'git commit -m "fix: x" && git push origin develop'],
    ['tee pass-through (not a filter)', 'git push origin b 2>&1 | tee out.log'],
    ['non-target git command piped', 'git log --oneline | head -5'],
    ['no pipe at all (fast path)', 'ls -la'],
    [
      'gh read filtered by a predicate on a later segment',
      'git commit -m msg && gh pr view 1 | grep state',
    ],
    // Rule 2's allow side. These are the queries the guard must never fire on:
    // a predicate's emptiness is itself an answer, where a positional cut
    // cannot report what it dropped.
    ['gh pr checks selected by awk', 'gh pr checks 2000 | awk -F"\\t" "$2 != \\"pass\\""'],
    ['gh pr checks selected by grep', 'gh pr checks 2000 | grep -v pass'],
    ['ops review wrapper selected by grep', 'pnpm ops gh:pr-comments 2013 | grep "^## claude"'],
    // `gh api` is scoped to comment/review fetches; other api calls keep head.
    [
      'gh api runs truncated is out of scope',
      'gh api "repos/o/r/actions/runs" --jq ".x" | head -3',
    ],
    ['gh --repo with a predicate', 'gh --repo owner/name pr checks 2000 | grep -v pass'],
    [
      'heredoc commit message mentioning a filter',
      'git commit -m "$(cat <<\'EOF\'\nfeat: msg with | tail inside\nEOF\n)"',
    ],
  ];

  it.each(BLOCKED)('blocks: %s', (_name, command) => {
    expect(runHook(command)).toBe(2);
  });

  it.each(ALLOWED)('allows: %s', (_name, command) => {
    expect(runHook(command)).toBe(0);
  });

  it.each([
    ['non-Bash tool', JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } })],
    ['Bash with empty command', JSON.stringify({ tool_name: 'Bash', tool_input: { command: '' } })],
    ['Bash with missing command field', JSON.stringify({ tool_name: 'Bash', tool_input: {} })],
  ])('fails open on %s', (_name, input) => {
    expect(
      (() => {
        try {
          execFileSync('bash', [HOOK], { input, stdio: ['pipe', 'ignore', 'ignore'] });
          return 0;
        } catch (error) {
          return (error as { status?: number }).status ?? -1;
        }
      })()
    ).toBe(0);
  });
});
