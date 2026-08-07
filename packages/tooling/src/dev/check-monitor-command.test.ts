import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MONITOR_COMMAND_SURFACES,
  extractMonitorCommand,
  findMonitorCommandDrift,
  normalizeMonitorCommand,
} from './check-monitor-command.js';

const HOOK_LINE =
  '    SHA=$SHA; until gh api "repos/{owner}/{repo}/actions/runs?head_sha=\\$SHA" ' +
  "--jq '[.workflow_runs[]|select(.name==\"CI\")]|length' | grep -qE '^[1-9]'; do sleep 30; " +
  'done; gh pr checks 42 --watch --interval=30 > /dev/null 2>&1; sleep 5; ' +
  'echo "CI_COMPLETE"; gh pr checks 42';

const RULE_LINE =
  'SHA=<sha>; until gh api "repos/{owner}/{repo}/actions/runs?head_sha=$SHA" ' +
  "--jq '[.workflow_runs[]|select(.name==\"CI\")]|length' | grep -qE '^[1-9]'; do sleep 30; " +
  'done; gh pr checks N --watch --interval=30 > /dev/null 2>&1; sleep 5; ' +
  'echo "CI_COMPLETE"; gh pr checks N';

describe('normalizeMonitorCommand', () => {
  it('erases the SHA, PR-number, and heredoc-escaping differences', () => {
    expect(normalizeMonitorCommand(HOOK_LINE)).toBe(normalizeMonitorCommand(RULE_LINE));
  });

  it('keeps a predicate change visible', () => {
    const weakened = RULE_LINE.replace('.name=="CI"', '.name=="Lint"');
    expect(normalizeMonitorCommand(weakened)).not.toBe(normalizeMonitorCommand(RULE_LINE));
  });

  it('keeps a poll-interval change visible', () => {
    const faster = RULE_LINE.replace('sleep 30', 'sleep 5');
    expect(normalizeMonitorCommand(faster)).not.toBe(normalizeMonitorCommand(RULE_LINE));
  });

  it('keeps a dropped sentinel visible', () => {
    const silent = RULE_LINE.replace('echo "CI_COMPLETE"; ', '');
    expect(normalizeMonitorCommand(silent)).not.toBe(normalizeMonitorCommand(RULE_LINE));
  });
});

describe('extractMonitorCommand', () => {
  it('finds the command and reports its 1-indexed line', () => {
    const result = extractMonitorCommand('f.md', `prose\n\n${RULE_LINE}\nmore prose\n`);
    expect(result.line).toBe(3);
    expect(result.raw).toBe(RULE_LINE);
  });

  it('throws when a surface carries no command', () => {
    expect(() => extractMonitorCommand('f.md', 'prose only\n')).toThrow(/no CI-monitor command/);
  });

  it('throws when a surface carries several', () => {
    expect(() => extractMonitorCommand('f.md', `${RULE_LINE}\n${RULE_LINE}\n`)).toThrow(/found 2/);
  });

  it('does not match prose that merely describes the gate', () => {
    const prose = 'The gate polls `gh api` for actions/runs until the CI run completes.';
    expect(() => extractMonitorCommand('f.md', prose)).toThrow(/no CI-monitor command/);
  });
});

describe('findMonitorCommandDrift', () => {
  const surfaces = (...lines: string[]) =>
    lines.map((raw, i) => extractMonitorCommand(`f${i}.md`, raw));

  it('reports nothing when the copies differ only by placeholders', () => {
    expect(findMonitorCommandDrift(surfaces(HOOK_LINE, RULE_LINE))).toEqual([]);
  });

  it('reports every copy that differs from the reference', () => {
    const drifted = RULE_LINE.replace('sleep 30', 'sleep 15');
    const result = findMonitorCommandDrift(surfaces(HOOK_LINE, RULE_LINE, drifted));
    expect(result.map(c => c.file)).toEqual(['f2.md']);
  });

  it('treats the FIRST surface as the reference, not the majority', () => {
    // Two matching docs copies do not outvote the hook — the hook is the copy
    // that actually gets emitted, so it is what the other two must match.
    const changed = RULE_LINE.replace('sleep 30', 'sleep 15');
    const result = findMonitorCommandDrift(surfaces(HOOK_LINE, changed, changed));
    expect(result).toHaveLength(2);
  });
});

describe('the real surfaces', () => {
  it('all carry an identical command (this is the guard, run as a test)', () => {
    const rootDir = join(import.meta.dirname, '../../../..');
    const commands = MONITOR_COMMAND_SURFACES.map(file =>
      extractMonitorCommand(file, readFileSync(join(rootDir, file), 'utf-8'))
    );
    expect(findMonitorCommandDrift(commands)).toEqual([]);
  });
});
