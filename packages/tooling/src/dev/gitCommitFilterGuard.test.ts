/**
 * CI coverage for `.claude/hooks/git-commit-filter-guard.sh` — the PreToolUse
 * guard blocking filtered `git commit`/`git push` output. The hook's parsing
 * (segment/pipeline splitting, heredoc stripping, flag-tolerant matching) is
 * meaningfully more complex than its sibling hooks', so its case matrix lives
 * here where a regression fails CI instead of silently degrading the guard.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const HOOK = path.resolve(__dirname, '../../../../.claude/hooks/git-commit-filter-guard.sh');

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

describe('git-commit-filter-guard hook', () => {
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
  ];

  const ALLOWED: [string, string][] = [
    ['plain && chain', 'git commit -m "fix: x" && git push origin develop'],
    ['tee pass-through (not a filter)', 'git push origin b 2>&1 | tee out.log'],
    ['non-target git command piped', 'git log --oneline | head -5'],
    ['no pipe at all (fast path)', 'ls -la'],
    ['pipe on a later, non-git segment', 'git commit -m msg && gh pr view 1 | grep state'],
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
