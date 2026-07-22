/**
 * Tests for the ops:health aggregator. The pure pieces (summary-line
 * extraction, aggregation, formatting) are tested directly; the run loop is
 * exercised with a mocked subprocess seam, asserting the args that cross it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('chalk', () => ({
  default: { dim: (s: string) => s, red: (s: string) => s, green: (s: string) => s },
}));

// Mock the advisory module so runHealth's alerts-count derivation is hermetic:
// collectOpenAdvisories otherwise walks the real filesystem (findPackageJsonFiles)
// against process.cwd(). The advisory logic itself is covered in advisories.test.ts.
vi.mock('./advisories.js', () => ({
  collectOpenAdvisories: vi.fn(),
  formatAdvisoriesReport: vi.fn(() => ''),
}));

import { execFileSync } from 'node:child_process';
import { collectOpenAdvisories, formatAdvisoriesReport } from './advisories.js';
import {
  HEALTH_TOOLS,
  extractSummaryLine,
  aggregateHealth,
  formatHealthReport,
  runHealth,
  type ToolHealth,
} from './health.js';
import { AUDIT_TOOL_REGISTRY } from './audit-tool-registry.js';

describe('HEALTH_TOOLS roster integrity', () => {
  it('every roster entry is a registered audit tool', () => {
    // Guards against roster rot: renaming/removing a registered command
    // without updating HEALTH_TOOLS would otherwise leave that slot
    // perma-BROKEN in the weekly report with no compile-time signal —
    // the same silent-rot failure mode the aggregator exists to catch,
    // one level up.
    const registered = new Set(AUDIT_TOOL_REGISTRY.map(entry => entry.command));
    for (const tool of HEALTH_TOOLS) {
      expect(registered, `HEALTH_TOOLS entry "${tool}" is not in AUDIT_TOOL_REGISTRY`).toContain(
        tool
      );
    }
  });
});

function summaryLine(tool: string, status: 'ok' | 'warn' | 'fail', findings = 0): string {
  return JSON.stringify({ tool, status, findings, baseline: 0 });
}

function healthy(tool: string): ToolHealth {
  return { tool, summary: { tool, status: 'ok', findings: 0, baseline: 0 } };
}

describe('extractSummaryLine', () => {
  it('takes the last valid JSONL line, tolerating report noise', () => {
    const stdout = [
      'Human-readable report header',
      '{"not":"a summary"}',
      'more prose',
      summaryLine('lint:complexity-report', 'warn', 3),
      '',
    ].join('\n');

    const summary = extractSummaryLine(stdout);

    expect(summary?.tool).toBe('lint:complexity-report');
    expect(summary?.status).toBe('warn');
    expect(summary?.findings).toBe(3);
  });

  it('returns null when no line parses as a summary', () => {
    expect(extractSummaryLine('all prose\n{"malformed": true}\n')).toBeNull();
    expect(extractSummaryLine('')).toBeNull();
  });
});

describe('aggregateHealth', () => {
  it('is ok when every tool is ok', () => {
    expect(aggregateHealth([healthy('a'), healthy('b')]).overall).toBe('ok');
  });

  it('is warn when soft findings exist but nothing fails', () => {
    const warned: ToolHealth = {
      tool: 'b',
      summary: { tool: 'b', status: 'warn', findings: 2, baseline: 0 },
    };
    expect(aggregateHealth([healthy('a'), warned]).overall).toBe('warn');
  });

  it('is fail when any tool fails', () => {
    const failed: ToolHealth = {
      tool: 'b',
      summary: { tool: 'b', status: 'fail', findings: 5, baseline: 0 },
    };
    expect(aggregateHealth([healthy('a'), failed]).overall).toBe('fail');
  });

  it('is fail when any tool is BROKEN (no summary) — tool rot is the loudest signal', () => {
    const broken: ToolHealth = { tool: 'b', summary: null, brokenReason: 'no line' };
    expect(aggregateHealth([healthy('a'), broken]).overall).toBe('fail');
  });
});

describe('formatHealthReport', () => {
  it('renders one line per tool with broken tools called out', () => {
    const report = aggregateHealth([
      healthy('guard:proposal-links'),
      { tool: 'commands:audit', summary: null, brokenReason: 'exploded' },
    ]);

    const text = formatHealthReport(report);

    expect(text).toContain('Audit health: ❌ FAIL');
    expect(text).toContain('✅ **guard:proposal-links** — 0 finding(s)');
    expect(text).toContain('💥 **commands:audit** — TOOL BROKEN: exploded');
  });
});

describe('runHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
    // Default: advisories available + empty (no alerts). Individual tests
    // override to exercise the count-derivation and degradation paths.
    vi.mocked(collectOpenAdvisories).mockReturnValue({ available: true, advisories: [] });
  });

  it('runs every roster tool via `pnpm ops <tool> --summary`', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const tool = (args as string[])[1];
      return summaryLine(tool, 'ok');
    });

    const report = runHealth({ noFail: true });

    // The extras section adds `gh` subprocess calls; the roster contract is
    // about the `pnpm ops <tool> --summary` invocations specifically.
    const pnpmCalls = vi.mocked(execFileSync).mock.calls.filter(call => call[0] === 'pnpm');
    expect(pnpmCalls).toHaveLength(HEALTH_TOOLS.length);
    for (const tool of HEALTH_TOOLS) {
      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        'pnpm',
        ['ops', tool, '--summary'],
        expect.objectContaining({ encoding: 'utf-8' })
      );
    }
    expect(report.overall).toBe('ok');
    expect(process.exitCode).toBeUndefined();
  });

  it('treats a non-zero exit WITH a fail summary as a finding, not a broken tool', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const tool = (args as string[])[1];
      if (tool === 'guard:proposal-links') {
        const error = new Error('Command failed') as Error & { stdout: string };
        error.stdout = summaryLine(tool, 'fail', 2);
        throw error;
      }
      return summaryLine(tool, 'ok');
    });

    const report = runHealth({ noFail: true });

    const proposalResult = report.results.find(r => r.tool === 'guard:proposal-links');
    expect(proposalResult?.summary?.status).toBe('fail');
    expect(proposalResult?.brokenReason).toBeUndefined();
    expect(report.overall).toBe('fail');
  });

  it('surfaces the tool own stderr diagnostics when a tool crashes with empty stdout', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const tool = (args as string[])[1];
      if (tool === 'guard:boundaries') {
        const error = new Error('Command failed: pnpm ops guard:boundaries') as Error & {
          stdout: string;
          stderr: string;
        };
        error.stdout = '';
        error.stderr = 'first diagnostic\nError: depcruise config not found\n';
        throw error;
      }
      return summaryLine(tool, 'ok');
    });

    const report = runHealth({ noFail: true });

    const broken = report.results.find(r => r.tool === 'guard:boundaries');
    expect(broken?.summary).toBeNull();
    // Message composition: exec error line + the LAST stderr line (the
    // closest thing to the tool's own root-cause diagnostic).
    expect(broken?.brokenReason).toBe(
      'Command failed: pnpm ops guard:boundaries — Error: depcruise config not found'
    );
    expect(report.overall).toBe('fail');
  });

  it('keeps the crash diagnostics when a tool dies with partial non-summary stdout', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const tool = (args as string[])[1];
      if (tool === 'commands:audit') {
        const error = new Error('Command failed: pnpm ops commands:audit') as Error & {
          stdout: string;
          stderr: string;
        };
        error.stdout = 'Loading manifest…\n'; // partial output, no summary line
        error.stderr = 'Error: manifest file corrupted\n';
        throw error;
      }
      return summaryLine(tool, 'ok');
    });

    const report = runHealth({ noFail: true });

    const broken = report.results.find(r => r.tool === 'commands:audit');
    expect(broken?.summary).toBeNull();
    // Both signals compose: the no-summary fact AND the crash root cause.
    expect(broken?.brokenReason).toContain('no parseable JSONL summary line');
    expect(broken?.brokenReason).toContain('Error: manifest file corrupted');
    expect(report.overall).toBe('fail');
  });

  it('flags a tool with no summary line as BROKEN and fails overall', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const tool = (args as string[])[1];
      if (tool === 'commands:audit') {
        return 'oops, just prose output\n';
      }
      return summaryLine(tool, 'ok');
    });

    const report = runHealth({ noFail: true });

    const brokenResult = report.results.find(r => r.tool === 'commands:audit');
    expect(brokenResult?.summary).toBeNull();
    expect(brokenResult?.brokenReason).toContain('no parseable JSONL summary line');
    expect(report.overall).toBe('fail');
  });

  it('sets the failure exit code unless noFail', () => {
    vi.mocked(execFileSync).mockReturnValue('prose only');

    runHealth();

    expect(process.exitCode).toBe(1);
  });

  it('prints the report-only extras sections after the tool bullets', () => {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'gh') {
        return (args as string[])[0] === 'pr' ? '2\n' : '1\n';
      }
      return summaryLine((args as string[])[1], 'ok');
    });

    const report = runHealth({ noFail: true });

    const output = vi
      .mocked(console.log)
      .mock.calls.flat()
      .map(arg => String(arg))
      .join('\n');
    expect(output).toContain('### Security surface (report-only)');
    expect(output).toContain('- Dependabot PRs open: 2');
    expect(output).toContain('### Ratchet margins (report-only)');
    expect(output).toContain('### Docs orphans (report-only)');
    // The extras must appear AFTER the per-tool verdict block.
    expect(output.indexOf('## Audit health')).toBeLessThan(output.indexOf('### Security surface'));
    expect(report.overall).toBe('ok');
  });

  it('derives the alerts count from the single advisory fetch (no second gh call)', () => {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'gh') {
        return (args as string[])[0] === 'pr' ? '0\n' : '99\n';
      }
      return summaryLine((args as string[])[1], 'ok');
    });
    // Two open advisories — the alerts count must reflect THIS, not the gh
    // count call (which would report 99). The objects only need a length here.
    vi.mocked(collectOpenAdvisories).mockReturnValue({
      available: true,
      advisories: [{}, {}] as never,
    });

    runHealth({ noFail: true });

    const output = vi
      .mocked(console.log)
      .mock.calls.flat()
      .map(arg => String(arg))
      .join('\n');
    expect(output).toContain('- Dependabot alerts open: 2');
    // The alerts endpoint was NOT queried a second time for a count.
    const alertsCountCalls = vi
      .mocked(execFileSync)
      .mock.calls.filter(
        call => call[0] === 'gh' && (call[1] as string[]).includes('dependabot/alerts')
      );
    expect(alertsCountCalls).toHaveLength(0);
    // With advisories present, the actionable detail block is rendered.
    expect(formatAdvisoriesReport).toHaveBeenCalled();
  });

  it('extras degradation never affects the verdict or exit code', () => {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'gh') {
        throw new Error('gh: command not found');
      }
      return summaryLine((args as string[])[1], 'ok');
    });
    // The alerts count now derives from the advisory fetch — degrade it too.
    vi.mocked(collectOpenAdvisories).mockReturnValue({
      available: false,
      reason: 'gh: command not found',
    });

    const report = runHealth();

    const output = vi
      .mocked(console.log)
      .mock.calls.flat()
      .map(arg => String(arg))
      .join('\n');
    // Per-metric degradation: each security bullet carries its own reason.
    expect(output).toContain('- Dependabot PRs open: unavailable');
    expect(output).toContain('- Dependabot alerts open: unavailable');
    expect(report.overall).toBe('ok');
    expect(process.exitCode).toBeUndefined();
  });
});
