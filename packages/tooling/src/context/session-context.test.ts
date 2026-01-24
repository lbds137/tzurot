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
});
