/**
 * Tests for the claude-content reference check.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  findContentRefs,
  parseRegisteredCommands,
  checkClaudeContentRefs,
} from './check-claude-content-refs.js';
import { parseSummary } from './summary.js';

async function withTempRepo<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'claude-refs-'));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scaffold(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

describe('parseRegisteredCommands', () => {
  it('extracts simple command names', () => {
    const help = `Commands:
  db:status                Show migration status
  db:migrate               Run pending migrations
  logs                     Fetch logs`;
    const commands = parseRegisteredCommands(help);
    expect(commands.has('db:status')).toBe(true);
    expect(commands.has('db:migrate')).toBe(true);
    expect(commands.has('logs')).toBe(true);
  });

  it('extracts commands with template args', () => {
    const help = `Commands:
  db:fix-drift [...migrations]   Fix migration drift
  gh:pr-info <number>            Get PR info`;
    const commands = parseRegisteredCommands(help);
    expect(commands.has('db:fix-drift')).toBe(true);
    expect(commands.has('gh:pr-info')).toBe(true);
  });

  it('ignores non-command lines (usage, options, blank lines)', () => {
    const help = `Usage:
  $ ops <command> [options]

Commands:
  db:status                Show migration status

Options:
  -h, --help               Display this message`;
    const commands = parseRegisteredCommands(help);
    expect(commands.size).toBe(1);
    expect(commands.has('db:status')).toBe(true);
  });

  it('extracts complex multi-segment names', () => {
    const help = `Commands:
  lint:complexity-report   Report complexity
  cpd:update-baseline      Refresh baseline
  guard:audit-tool-docs    Check WHY.md docs`;
    const commands = parseRegisteredCommands(help);
    expect(commands.has('lint:complexity-report')).toBe(true);
    expect(commands.has('cpd:update-baseline')).toBe(true);
    expect(commands.has('guard:audit-tool-docs')).toBe(true);
  });
});

describe('findContentRefs', () => {
  const validCommands = new Set(['db:status', 'guard:proposal-links', 'test:audit']);

  it('returns no findings when all references are valid', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        '.claude/rules/01-foo.md': '# Foo\n\nUse `pnpm ops db:status` to check status.',
        '.claude/skills/bar/SKILL.md': '# Bar\n\nRun `pnpm ops test:audit` after changes.',
      });
      const result = findContentRefs(root, validCommands);
      expect(result.totalFiles).toBe(2);
      expect(result.danglingRefs).toEqual([]);
    });
  });

  it('detects a dangling command reference', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        '.claude/rules/01-foo.md': '# Foo\n\nUse `pnpm ops nonexistent:cmd` to do a thing.',
      });
      const result = findContentRefs(root, validCommands);
      expect(result.danglingRefs).toHaveLength(1);
      expect(result.danglingRefs[0].command).toBe('nonexistent:cmd');
      expect(result.danglingRefs[0].file).toBe('.claude/rules/01-foo.md');
      expect(result.danglingRefs[0].line).toBe(3);
    });
  });

  it('detects multiple dangling references in one file', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        '.claude/rules/01-foo.md': '# Foo\n\n`pnpm ops a:gone` first.\n\nThen `pnpm ops b:gone`.',
      });
      const result = findContentRefs(root, validCommands);
      expect(result.danglingRefs).toHaveLength(2);
      const cmds = result.danglingRefs.map(d => d.command).sort();
      expect(cmds).toEqual(['a:gone', 'b:gone']);
    });
  });

  it('detects multiple dangling references on the same line', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        '.claude/rules/01-foo.md':
          '# Foo\n\nRun `pnpm ops a:gone` then `pnpm ops b:gone` then done.',
      });
      const result = findContentRefs(root, validCommands);
      expect(result.danglingRefs).toHaveLength(2);
    });
  });

  it('walks nested skill directories', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        '.claude/skills/level1/level2/SKILL.md': 'Use `pnpm ops db:status`.',
        '.claude/skills/other/SKILL.md': 'Use `pnpm ops nonexistent:thing`.',
      });
      const result = findContentRefs(root, validCommands);
      expect(result.totalFiles).toBe(2);
      expect(result.danglingRefs).toHaveLength(1);
      expect(result.danglingRefs[0].command).toBe('nonexistent:thing');
    });
  });

  it('handles missing scan directories gracefully', async () => {
    await withTempRepo(root => {
      // No .claude directory at all
      const result = findContentRefs(root, validCommands);
      expect(result.totalFiles).toBe(0);
      expect(result.danglingRefs).toEqual([]);
    });
  });

  it('flags files with lastUpdated older than the staleness threshold', async () => {
    await withTempRepo(root => {
      // 200 days ago (above the 180-day threshold)
      const oldDate = new Date('2025-11-04');
      const now = new Date('2026-05-23');
      scaffold(root, {
        '.claude/skills/foo/SKILL.md': `---\nname: foo\nlastUpdated: '${oldDate.toISOString().split('T')[0]}'\n---\n\nContent.`,
      });
      const result = findContentRefs(root, validCommands, ['.claude/rules', '.claude/skills'], now);
      expect(result.stale).toHaveLength(1);
      expect(result.stale[0].ageDays).toBeGreaterThan(180);
    });
  });

  it('does NOT flag files within the staleness threshold', async () => {
    await withTempRepo(root => {
      const now = new Date('2026-05-23');
      scaffold(root, {
        '.claude/skills/foo/SKILL.md': `---\nname: foo\nlastUpdated: '2026-04-01'\n---\n\nContent.`, // ~52 days ago
      });
      const result = findContentRefs(root, validCommands, ['.claude/rules', '.claude/skills'], now);
      expect(result.stale).toEqual([]);
    });
  });

  it('does NOT flag files without a lastUpdated frontmatter', async () => {
    await withTempRepo(root => {
      const now = new Date('2026-05-23');
      scaffold(root, {
        '.claude/rules/01-foo.md': '# Foo\n\nNo frontmatter here.',
      });
      const result = findContentRefs(root, validCommands, ['.claude/rules', '.claude/skills'], now);
      expect(result.stale).toEqual([]);
    });
  });
});

describe('checkClaudeContentRefs (CLI entry point with --summary)', () => {
  it('emits ok status when no dangling refs', async () => {
    await withTempRepo(async root => {
      scaffold(root, {
        '.claude/rules/01-foo.md': 'Use `pnpm ops db:status`.',
      });
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      try {
        await checkClaudeContentRefs({
          repoRoot: root,
          summary: true,
          validCommands: new Set(['db:status']),
        });
      } finally {
        consoleSpy.mockRestore();
      }
      const summary = parseSummary(captured[captured.length - 1]);
      expect(summary.tool).toBe('guard:claude-content-refs');
      expect(summary.status).toBe('ok');
      expect(summary.findings).toBe(0);
    });
  });

  it('emits fail status + exits 1 on dangling ref', async () => {
    await withTempRepo(async root => {
      scaffold(root, {
        '.claude/rules/01-foo.md': 'Use `pnpm ops nonexistent:cmd`.',
      });
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        await checkClaudeContentRefs({
          repoRoot: root,
          summary: true,
          validCommands: new Set(['db:status']),
        });
        const summary = parseSummary(captured[captured.length - 1]);
        expect(summary.tool).toBe('guard:claude-content-refs');
        expect(summary.status).toBe('fail');
        expect(summary.findings).toBe(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  it('staleness alone does NOT fail (warning-only)', async () => {
    // A file with stale lastUpdated but valid command refs should not
    // exit 1. The staleness is informational; only dangling refs gate.
    await withTempRepo(async root => {
      scaffold(root, {
        '.claude/skills/foo/SKILL.md': `---\nname: foo\nlastUpdated: '2025-01-01'\n---\n\nUse \`pnpm ops db:status\`.`,
      });
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        await checkClaudeContentRefs({
          repoRoot: root,
          summary: true,
          validCommands: new Set(['db:status']),
        });
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
      const summary = parseSummary(captured[captured.length - 1]);
      expect(summary.status).toBe('ok');
      expect(summary.findings).toBe(0);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});

describe('findContentRefs (against real repo)', () => {
  it('reports zero dangling references on the actual project state', async () => {
    // Sanity check against the current repo state. This is a real-repo
    // integration test analogous to the orphan-check sanity test in
    // check-proposal-orphans.test.ts. We use a fixed set of commands
    // (the ones existing skills/rules actually reference) so the test
    // doesn't depend on `pnpm ops --help` being available.
    //
    // NOTE: removal direction — if a command is removed from the CLI,
    // it MUST also be removed from this set. Otherwise this test
    // passes (the doc still references a command the set claims is
    // valid) but the production `guard:claude-content-refs` CI step
    // fails because the actual `pnpm ops --help` no longer exports it.
    // CI surfaces the divergence eventually, but updating the set
    // proactively keeps the test honest.
    //
    // NOTE: addition direction — if a NEW command lands in the CLI and
    // a rule/skill starts referencing it before this set is updated,
    // this test will report it as dangling (a "false dangling") and
    // fail locally even though production CI would pass. The remedy is
    // the same: add the new command name to this set. The two failure
    // modes converge on "keep this set in sync with `pnpm ops --help`"
    // — the symmetric directional callout is just to set expectations
    // for contributors who add a new command and run the test suite.
    const repoRoot = join(__dirname, '../../../..');
    // We import this lazily to give vitest's mocks a chance to apply,
    // and we use a hardcoded set rather than spawning `pnpm ops --help`
    // because the test runner shouldn't pay the spawn cost.
    const validCommands = new Set([
      // Sample of commands from the project's current registration.
      // If the actual rule/skill content references something not here,
      // the test will surface a useful "what's actually referenced"
      // signal rather than failing on a spurious dangling.
      'backlog',
      'cache:clear',
      'cache:inspect',
      'context',
      'cpd:check',
      'cpd:filtered',
      'cpd:update-baseline',
      'db:check-drift',
      'db:check-safety',
      'db:deploy',
      'db:fix-drift',
      'db:inspect',
      'db:migrate',
      'db:safe-migrate',
      'db:status',
      'deploy:dev',
      'deploy:setup-vars',
      'deploy:update-gateway',
      'deploy:verify',
      'dev:dead-files',
      'dev:focus',
      'dev:lint',
      'dev:schema-audit',
      'dev:test',
      'dev:test-summary',
      'dev:typecheck',
      'dev:update-deps',
      'gh:pr-all',
      'gh:pr-comments',
      'gh:pr-conversation',
      'gh:pr-edit',
      'gh:pr-info',
      'gh:pr-reviews',
      'guard:audit-tool-docs',
      'guard:boundaries',
      'guard:claude-content-refs',
      'guard:dockerfile-dist',
      'guard:duplicate-exports',
      'guard:gate-parity',
      'guard:proposal-links',
      'lines:check',
      'lines:update-baseline',
      'guard:test-taxonomy',
      'guard:workflow-sync',
      'inspect:dlq',
      'inspect:queue',
      'inspect:tts-configs',
      'lint:complexity-report',
      'logs',
      'memory:analyze',
      'memory:backfill',
      'memory:cleanup',
      'release:bump',
      'release:draft-notes',
      'release:finalize',
      'release:premigrate',
      'release:verify-notes',
      'run',
      'session:clear',
      'session:load',
      'session:save',
      'test:audit',
      'test:audit-contracts',
      'test:audit-services',
      'test:generate-schema',
      'test:tiers',
      'voice-refs:audit',
      'xray',
    ]);
    const result = findContentRefs(repoRoot, validCommands);
    expect(
      result.danglingRefs,
      `Found dangling refs: ${result.danglingRefs.map(d => `${d.file}:${d.line} → ${d.command}`).join(', ')}. ` +
        `Either fix the reference in the markdown file or add the command to the test's validCommands set ` +
        `(if it was just added to the registry).`
    ).toEqual([]);
  });
});
