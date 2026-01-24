import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// Mock chalk
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
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock fs
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { saveSession, loadSession, clearSession } from './session-state.js';

describe('session-state', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    // Default git behavior
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      const argsArray = args ?? [];
      if (cmd === 'git' && argsArray.includes('rev-parse')) return 'main';
      if (cmd === 'git' && argsArray.includes('status')) return '';
      if (cmd === 'git' && argsArray.includes('log')) return 'abc123 Test commit';
      return '';
    });

    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  describe('saveSession', () => {
    it('should save session state to file', async () => {
      await saveSession();

      expect(writeFileSync).toHaveBeenCalled();
      const [path, content] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      expect(path).toContain('.claude-session.json');
      const state = JSON.parse(content);
      expect(state.branch).toBe('main');
      expect(state.timestamp).toBeDefined();
    });

    it('should capture uncommitted changes', async () => {
      vi.mocked(execFileSync).mockImplementation((cmd, args) => {
        const argsArray = args ?? [];
        if (cmd === 'git' && argsArray.includes('rev-parse')) return 'feature-branch';
        if (cmd === 'git' && argsArray.includes('status')) return 'M file1.ts\nA file2.ts';
        if (cmd === 'git' && argsArray.includes('log')) return 'abc123 Commit';
        return '';
      });

      await saveSession();

      const [, content] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      const state = JSON.parse(content);
      expect(state.uncommittedChanges).toHaveLength(2);
      expect(state.uncommittedChanges).toContain('M file1.ts');
    });

    it('should capture CURRENT_WORK.md if exists', async () => {
      vi.mocked(existsSync).mockImplementation((path: unknown) =>
        String(path).includes('CURRENT_WORK.md')
      );
      vi.mocked(readFileSync).mockReturnValue('# Current Work\nWorking on feature');

      await saveSession();

      const [, content] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      const state = JSON.parse(content);
      expect(state.currentWork).toContain('Working on feature');
    });

    it('should include notes when provided', async () => {
      await saveSession({ notes: 'Remember to fix the auth bug' });

      const [, content] = vi.mocked(writeFileSync).mock.calls[0] as [string, string];
      const state = JSON.parse(content);
      expect(state.notes).toBe('Remember to fix the auth bug');
    });

    it('should fail if not in git repo', async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      await saveSession();

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Not in a git repository');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('loadSession', () => {
    it('should display saved session state', async () => {
      const savedState = {
        timestamp: new Date().toISOString(),
        branch: 'feature-branch',
        uncommittedChanges: ['M file.ts'],
        recentCommits: ['abc123 Recent commit'],
        notes: 'Test notes',
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(savedState));

      await loadSession();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('feature-branch');
      expect(output).toContain('Test notes');
      expect(output).toContain('PREVIOUS SESSION STATE');
    });

    it('should warn if no session exists', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await loadSession();

      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No saved session found');
    });

    it('should warn if session is stale (different branch)', async () => {
      const savedState = {
        timestamp: new Date().toISOString(),
        branch: 'old-branch',
        uncommittedChanges: [],
        recentCommits: ['abc123 Commit'],
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(savedState));
      vi.mocked(execFileSync).mockImplementation((cmd, args) => {
        const argsArray = args ?? [];
        if (cmd === 'git' && argsArray.includes('rev-parse')) return 'new-branch';
        if (cmd === 'git' && argsArray.includes('status')) return '';
        if (cmd === 'git' && argsArray.includes('log')) return 'def456 New commit';
        return '';
      });

      await loadSession();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('stale');
    });

    it('should display CURRENT_WORK.md if saved', async () => {
      const savedState = {
        timestamp: new Date().toISOString(),
        branch: 'main',
        uncommittedChanges: [],
        recentCommits: ['abc123 Commit'],
        currentWork: '# Current Work\n\nWorking on the API',
      };

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(savedState));

      await loadSession();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Working on the API');
    });
  });

  describe('clearSession', () => {
    it('should delete session file', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      await clearSession();

      expect(unlinkSync).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('cleared');
    });

    it('should do nothing if no session exists', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await clearSession();

      expect(unlinkSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No saved session to clear');
    });
  });
});
