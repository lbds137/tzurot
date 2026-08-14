import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MONITOR_COMMAND_SURFACES,
  extractMonitorCommand,
  findMonitorCommandDrift,
  normalizeMonitorCommand,
  checkMonitorCommand,
} from './check-monitor-command.js';

const HOOK_LINE = String.raw`    pnpm ops gh:ci-gate 42 --sha \$(git rev-parse HEAD)`;
const RULE_LINE = 'pnpm ops gh:ci-gate N --sha $(git rev-parse HEAD)';

describe('normalizeMonitorCommand', () => {
  it('erases only the PR-number and the heredoc escaping', () => {
    expect(normalizeMonitorCommand(HOOK_LINE)).toBe(normalizeMonitorCommand(RULE_LINE));
  });

  it('flags drift INSIDE the first --sha token, which a placeholder rule would hide', () => {
    // The load-bearing test for "the --sha value is no longer normalized", and
    // the fixture matters more than it looks. Reintroducing the old
    // `--sha \S+` → placeholder rule must break exactly this test, so the
    // divergence has to sit inside the token `\S+` would swallow (`--sha $(git`).
    // Verified by canary: with the old rule restored, this fails and every
    // other test in this file still passes. A stray space later in the
    // substitution does NOT discriminate — it survives outside `\S+`'s reach.
    const drifted = RULE_LINE.replace('$(git ', '$(gitx ');
    expect(normalizeMonitorCommand(drifted)).not.toBe(normalizeMonitorCommand(RULE_LINE));
  });

  it('keeps a renamed command visible', () => {
    const renamed = RULE_LINE.replace('gh:ci-gate', 'gh:ci-wait');
    expect(normalizeMonitorCommand(renamed)).not.toBe(normalizeMonitorCommand(RULE_LINE));
  });

  it('keeps an added flag visible', () => {
    const extra = `${RULE_LINE} --poll 5`;
    expect(normalizeMonitorCommand(extra)).not.toBe(normalizeMonitorCommand(RULE_LINE));
  });

  it('keeps a changed flag NAME visible', () => {
    const renamedFlag = RULE_LINE.replace('--sha', '--commit');
    expect(normalizeMonitorCommand(renamedFlag)).not.toBe(normalizeMonitorCommand(RULE_LINE));
  });
});

describe('MONITOR_COMMAND_SURFACES', () => {
  it('keeps the hook first, because index 0 is the drift reference', () => {
    // Reordering this array (alphabetizing, inserting a surface) would silently
    // change which copy the guard calls authoritative — and the in-sync case
    // would still pass, so nothing else would catch it.
    expect(MONITOR_COMMAND_SURFACES[0]).toBe('.claude/hooks/pr-monitor-reminder.sh');
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

  it('does not match prose that merely names the command', () => {
    const prose = 'Arm `pnpm ops gh:ci-gate` in a Monitor after every push.';
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
    const drifted = `${RULE_LINE} --poll 5`;
    const result = findMonitorCommandDrift(surfaces(HOOK_LINE, RULE_LINE, drifted));
    expect(result.map(c => c.file)).toEqual(['f2.md']);
  });

  it('treats the FIRST surface as the reference, not the majority', () => {
    // Two matching docs copies do not outvote the hook — the hook is the copy
    // that actually gets emitted, so it is what the other two must match.
    const changed = `${RULE_LINE} --poll 5`;
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

describe('checkMonitorCommand (entry point)', () => {
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedExitCode: typeof process.exitCode;

  /** Writes the three surfaces at their real relative paths under a fixture root. */
  function writeFixture(overrides?: { hook?: string; rule?: string; skill?: string }): void {
    mkdirSync(join(tmp, '.claude/hooks'), { recursive: true });
    mkdirSync(join(tmp, '.claude/rules'), { recursive: true });
    mkdirSync(join(tmp, '.claude/skills/tzurot-git-workflow'), { recursive: true });

    writeFileSync(
      join(tmp, '.claude/hooks/pr-monitor-reminder.sh'),
      `${overrides?.hook ?? HOOK_LINE}\n`
    );
    writeFileSync(join(tmp, '.claude/rules/05-tooling.md'), `${overrides?.rule ?? RULE_LINE}\n`);
    writeFileSync(
      join(tmp, '.claude/skills/tzurot-git-workflow/SKILL.md'),
      `${overrides?.skill ?? RULE_LINE}\n`
    );
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'guard-monitor-command-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = savedExitCode;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('leaves exitCode untouched and logs success when all three surfaces agree', () => {
    writeFixture();
    checkMonitorCommand();
    expect(process.exitCode).not.toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('CI-monitor command identical across')
    );
  });

  it('sets exitCode=1 and names the offending file and its drifted command on mismatch', () => {
    const drifted = `${RULE_LINE} --poll 5`;
    writeFixture({ skill: drifted });
    checkMonitorCommand();
    expect(process.exitCode).toBe(1);
    const output = errorSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    expect(output).toContain('.claude/skills/tzurot-git-workflow/SKILL.md');
    expect(output).toContain('--poll 5');
  });
});
