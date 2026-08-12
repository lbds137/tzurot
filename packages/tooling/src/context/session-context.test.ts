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

      // Without the guard the empty stdout parses as an empty pending list,
      // which prints the all-clear — the exact wrong answer.
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).not.toContain('All migrations applied');
      // ...and silence is the other wrong answer: an unknown must be VISIBLE,
      // otherwise a DB hang renders identically to a repo with no migrations.
      expect(output).toContain('Migrations');
      expect(output).toContain('Status unknown');
      expect(output).toContain('timed out');
    });

    it('reports UNKNOWN when the failure carries no readable output at all', async () => {
      // The third `null` path pre-fix: a thrown value with neither stdout nor
      // message. Same epistemic state as the timeout — nothing was learned —
      // so it must degrade the same way rather than to silence.
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') throw 'not an Error object';
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Status unknown');
      expect(output).not.toContain('All migrations applied');
    });

    it('renders the pending list parsed out of a non-zero prisma exit', async () => {
      // The KNOWN path, which had no test before this change touched its
      // return shape: prisma exits non-zero precisely when migrations are
      // pending, so the names arrive on the error's stdout.
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') {
          const error = new Error('exit 1') as Error & { stdout: string };
          error.stdout = [
            'Following migration(s) have not yet been applied:',
            '- 20260101000000_add_widgets',
            '- 20260102000000_add_gadgets',
            '',
          ].join('\n');
          throw error;
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('2 pending migration(s)');
      expect(output).toContain('20260101000000_add_widgets');
      expect(output).toContain('20260102000000_add_gadgets');
      expect(output).not.toContain('Status unknown');
    });

    it('reports UNKNOWN for a non-zero exit that is not the pending-migrations one', async () => {
      // The likelier failure of the two this function guards: a refused DB
      // connection fails FAST rather than hanging, so it never reaches the
      // timeout branch. Its output carries no pending marker, and reading
      // "no marker" as "nothing pending" is the same all-clear the timeout
      // branch exists to prevent.
      // Fixture copied from a REAL probe against an unreachable database, not
      // invented: prisma splits the two halves across streams, putting a benign
      // datasource echo on stdout and the identifying error on stderr. A
      // synthetic fixture that puts P1001 on stdout passes while the code reads
      // only stdout — green, and blind to the actual shape.
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') {
          const error = new Error('command failed') as Error & {
            stdout: string;
            stderr: string;
          };
          error.stdout = 'Datasource "db": PostgreSQL database "nope" at "127.0.0.1:59999"\n';
          error.stderr = [
            'Prisma schema loaded from prisma/schema.prisma.',
            "Error: P1001: Can't reach database server at `127.0.0.1:59999`",
            '',
            'Please make sure your database server is running.',
          ].join('\n');
          throw error;
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).not.toContain('All migrations applied');
      expect(output).toContain('Status unknown');
      // The identifying line, from STDERR — not the datasource echo that a
      // stdout-only read would surface as a plausible-looking wrong reason.
      expect(output).toContain('P1001');
      expect(output).not.toContain('Datasource');
      // ...and only that line, not prisma's whole essay.
      expect(output).not.toContain('Please make sure your database server');
    });

    it('surfaces the spawn-failure message instead of the string "undefined"', async () => {
      // Probed shape for a missing binary: both stream KEYS are present with
      // the value `undefined`, and the identifying text lives only on
      // `message`. A presence check on the key plus `String()` yields the
      // literal "undefined" — non-empty, so it wins over the message fallback
      // and renders as `failed: undefined`.
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') {
          const error = new Error('spawnSync npx ENOENT') as Error & {
            code: string;
            stdout: undefined;
            stderr: undefined;
          };
          error.code = 'ENOENT';
          error.stdout = undefined;
          error.stderr = undefined;
          throw error;
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Status unknown');
      expect(output).toContain('ENOENT');
      expect(output).not.toContain('undefined');
    });

    it('does not absorb stderr noise into the pending-migration list', async () => {
      // The pending LIST is read from stdout alone. Merging the streams for the
      // list would let a stderr warning sitting next to the marker be parsed as
      // a migration name; the merge exists only for the failure REASON.
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') {
          const error = new Error('exit 1') as Error & { stdout: string; stderr: string };
          // NO trailing blank line on stdout: the parser stops at the first
          // blank after the marker, so a fixture that ends with one can never
          // reach stderr and passes whether the streams are merged or not.
          // (Written that way first; the canary caught it staying green.)
          error.stdout = [
            'Following migration(s) have not yet been applied:',
            '- 20260101000000_add_widgets',
          ].join('\n');
          error.stderr = '- warning: a deprecation notice shaped like a list item';
          throw error;
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('1 pending migration(s)');
      expect(output).toContain('20260101000000_add_widgets');
      expect(output).not.toContain('deprecation notice');
    });

    it('says so plainly when both streams are empty, rather than trailing a colon', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') {
          const error = new Error('') as Error & { stdout: string; stderr: string };
          error.stdout = '';
          error.stderr = '   \n';
          throw error;
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('failed with no readable output');
      expect(output).not.toContain('failed: ');
    });

    it('truncates a very long failure line instead of flooding the banner', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'npx') {
          const error = new Error('boom') as Error & { stdout: string; stderr: string };
          error.stdout = '';
          error.stderr = `Error: ${'x'.repeat(400)}`;
          throw error;
        }
        return '';
      });

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('…');
      expect(output).not.toContain('x'.repeat(200));
    });

    it('renders the all-clear when prisma reports the schema up to date', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('');
      execFileSyncMock.mockImplementation((cmd: string) =>
        cmd === 'npx' ? 'Database schema is up to date!' : ''
      );

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('All migrations applied');
      expect(output).not.toContain('Status unknown');
    });

    it('prints NO migrations section when the repo has no migrations directory', async () => {
      // The distinction the unknown line exists to preserve: absent stays
      // silent. If this went to the unknown branch, every non-Prisma repo
      // would get a spurious warning at session start.
      fsMock.existsSync.mockReturnValue(false);
      execFileSyncMock.mockReturnValue('');

      const { getSessionContext } = await import('./session-context.js');
      await getSessionContext({});

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).not.toContain('Migrations');
      expect(output).not.toContain('Status unknown');
      // Prove the run completed, so "section skipped" is distinguishable from
      // "died before printing anything".
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
