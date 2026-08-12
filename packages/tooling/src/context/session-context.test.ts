import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk with chainable methods
vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

// Mock child_process
const execFileSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

// Mock fs
const fsMock = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
};
vi.mock('node:fs', () => fsMock);

describe('getSessionContext', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Default: no files exist, git commands succeed
    fsMock.existsSync.mockReturnValue(false);
    execFileSyncMock.mockReturnValue('');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should export getSessionContext function', async () => {
    const module = await import('./session-context.js');
    expect(typeof module.getSessionContext).toBe('function');
  });

  describe('git state', () => {
    it('bounds every execFileSafe shell-out with SESSION_CONTEXT_TIMEOUT_MS', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'main';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return '';
        return '';
      });

      const { getSessionContext, SESSION_CONTEXT_TIMEOUT_MS } =
        await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const gitCalls = execFileSyncMock.mock.calls.filter(call => call[0] === 'git');
      expect(gitCalls.length).toBeGreaterThan(0);
      for (const call of gitCalls) {
        expect(call[2]).toMatchObject({ timeout: SESSION_CONTEXT_TIMEOUT_MS });
      }
    });

    it('bounds the prisma migration check with its own larger timeout', async () => {
      // The migration check only runs when the migrations directory exists and
      // skipMigrations is not set — the default path for `pnpm ops context`.
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockReturnValue('');

      const { getSessionContext, MIGRATION_STATUS_TIMEOUT_MS } =
        await import('./session-context.js');
      await getSessionContext({});

      const npxCalls = execFileSyncMock.mock.calls.filter(call => call[0] === 'npx');
      expect(npxCalls.length).toBeGreaterThan(0);
      for (const call of npxCalls) {
        expect(call[2]).toMatchObject({ timeout: MIGRATION_STATUS_TIMEOUT_MS });
      }
    });

    it('reports migrations as UNKNOWN on a timeout kill, not as "none pending"', async () => {
      // The regression this guards: a killed prisma still carries stdout, and
      // the content branch below would read the empty/partial text as "no
      // pending migrations" — a confident wrong answer in session startup.
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') {
          const error = new Error('timed out') as Error & { code: string; stdout: string };
          error.code = 'ETIMEDOUT';
          error.stdout = '';
          throw error;
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      // `null` skips the section entirely. Without the guard the empty stdout
      // parses as an empty pending list, which prints the all-clear — the
      // exact wrong answer, so that string is what this asserts against.
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).not.toContain('All migrations applied');
      // Pin the null path specifically, not merely the absence of one string:
      // the whole section is skipped. Without this, a regression that dropped
      // the migration block entirely would still satisfy the assertion above.
      expect(output).not.toContain('Migrations');
      // ...and prove the run still completed, so "section skipped" is
      // distinguishable from "died before printing anything". (Git state is
      // also absent here — this fixture returns '' for git, so that section
      // legitimately skips too; the banner is what proves the run finished.)
      expect(output).toContain('SESSION CONTEXT');
    });

    it('should show current branch', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'feature/test-branch';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return 'abc123 First commit';
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('feature/test-branch');
    });

    it('should show uncommitted changes count', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'main';
        if (cmd === 'git' && args.includes('status')) return 'M file1.ts\nA file2.ts\n?? file3.ts';
        if (cmd === 'git' && args.includes('log')) return '';
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('3 uncommitted change');
    });

    it('should show clean status when no changes', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'main';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return 'abc123 Commit';
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Clean');
    });

    it('should show recent commits', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'main';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log'))
          return 'abc123 First\ndef456 Second\nghi789 Third';
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('abc123 First');
      expect(output).toContain('def456 Second');
    });

    it('should handle git command failure gracefully', async () => {
      execFileSyncMock.mockImplementation(() => {
        throw new Error('Not a git repo');
      });

      const { getSessionContext } = await import('./session-context.js');
      // Should not throw
      await getSessionContext({ skipMigrations: true });

      // Just verify it completes without crashing
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('CURRENT_WORK.md', () => {
    it('should show summary when file exists', async () => {
      execFileSyncMock.mockReturnValue('main');
      fsMock.existsSync.mockImplementation((path: string) => path.includes('CURRENT_WORK.md'));
      fsMock.readFileSync.mockReturnValue('# Current Work\n\nWorking on feature X\n\n## Details');

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Current Work');
      expect(output).toContain('Working on feature X');
    });

    it('should skip when file does not exist', async () => {
      execFileSyncMock.mockReturnValue('main');
      fsMock.existsSync.mockReturnValue(false);

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      expect(fsMock.readFileSync).not.toHaveBeenCalledWith(
        expect.stringContaining('CURRENT_WORK.md'),
        expect.anything()
      );
    });
  });

  describe('ROADMAP.md', () => {
    it('should show unchecked items from roadmap', async () => {
      execFileSyncMock.mockReturnValue('main');
      fsMock.existsSync.mockImplementation((path: string) => path.includes('ROADMAP.md'));
      fsMock.readFileSync.mockReturnValue(
        '# Roadmap\n- [x] Done item\n- [ ] Todo item 1\n- [ ] Todo item 2'
      );

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Todo item 1');
      expect(output).toContain('Todo item 2');
    });

    it('should limit roadmap items shown', async () => {
      execFileSyncMock.mockReturnValue('main');
      fsMock.existsSync.mockImplementation((path: string) => path.includes('ROADMAP.md'));
      fsMock.readFileSync.mockReturnValue(
        '# Roadmap\n' + Array.from({ length: 10 }, (_, i) => `- [ ] Item ${i + 1}`).join('\n')
      );

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      // Should limit to first 5 items
      expect(output).toContain('Item 1');
      expect(output).toContain('Item 5');
      expect(output).not.toContain('Item 6');
    });
  });

  describe('migrations', () => {
    it('should skip migration check when skipMigrations is true', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'npx' && args.includes('prisma')) throw new Error('Should not be called');
        return 'main';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      // Should complete without prisma error
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('summary warnings', () => {
    it('should warn about uncommitted changes', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'main';
        if (cmd === 'git' && args.includes('status')) return 'M file.ts';
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Uncommitted changes detected');
    });

    it('should note when CURRENT_WORK.md exists', async () => {
      execFileSyncMock.mockReturnValue('main');
      fsMock.existsSync.mockImplementation((path: string) => path.includes('CURRENT_WORK.md'));
      fsMock.readFileSync.mockReturnValue('# Work\nContent');

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('CURRENT_WORK.md found');
    });
  });

  describe('CI status', () => {
    it('should show CI status when gh CLI is available', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'develop';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return 'abc123 Commit';
        if (cmd === 'gh' && args.includes('--version')) return 'gh version 2.0.0';
        if (cmd === 'gh' && args.includes('run')) {
          return JSON.stringify([
            {
              conclusion: 'success',
              name: 'CI',
              url: 'https://github.com/run/1',
              status: 'completed',
            },
          ]);
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('CI Status');
      expect(output).toContain('CI');
      expect(output).toContain('success');
    });

    it('should show failure warning in summary when CI is failing', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'develop';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return 'abc123 Commit';
        if (cmd === 'gh' && args.includes('--version')) return 'gh version 2.0.0';
        if (cmd === 'gh' && args.includes('run')) {
          return JSON.stringify([
            {
              conclusion: 'failure',
              name: 'CI',
              url: 'https://github.com/run/1',
              status: 'completed',
            },
          ]);
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('CI is failing');
    });

    it('should show pending warning when CI is in progress', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'develop';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return 'abc123 Commit';
        if (cmd === 'gh' && args.includes('--version')) return 'gh version 2.0.0';
        if (cmd === 'gh' && args.includes('run')) {
          return JSON.stringify([
            {
              conclusion: null,
              name: 'CI',
              url: 'https://github.com/run/1',
              status: 'in_progress',
            },
          ]);
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('CI is running');
    });

    it('should skip CI status when gh CLI is not available', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'develop';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return 'abc123 Commit';
        if (cmd === 'gh') throw new Error('gh not found');
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).not.toContain('CI Status');
    });

    it('should skip CI status when no runs found', async () => {
      execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args.includes('rev-parse')) return 'develop';
        if (cmd === 'git' && args.includes('status')) return '';
        if (cmd === 'git' && args.includes('log')) return 'abc123 Commit';
        if (cmd === 'gh' && args.includes('--version')) return 'gh version 2.0.0';
        if (cmd === 'gh' && args.includes('run')) return '[]';
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({ skipMigrations: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).not.toContain('CI Status');
    });
  });
});
