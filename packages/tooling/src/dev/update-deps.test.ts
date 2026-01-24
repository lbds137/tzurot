import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: Object.assign((s: string) => s, { bold: (s: string) => s }),
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
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
};
vi.mock('node:fs', () => fsMock);

describe('updateDeps', () => {
  let consoleLogSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Default mocks
    fsMock.readdirSync.mockReturnValue([]);
    fsMock.statSync.mockReturnValue({ isDirectory: () => false });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should export updateDeps function', async () => {
    const module = await import('./update-deps.js');
    expect(typeof module.updateDeps).toBe('function');
  });

  describe('dry run mode', () => {
    it('should not run pnpm update in dry run mode', async () => {
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) {
          return 'importers:\n  .:\n    dependencies:\n';
        }
        return JSON.stringify({ dependencies: {} });
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ dryRun: true });

      // Should not call execFileSync for pnpm update
      expect(execFileSyncMock).not.toHaveBeenCalledWith(
        'pnpm',
        expect.arrayContaining(['update']),
        expect.anything()
      );
    });

    it('should not write files in dry run mode', async () => {
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) {
          return 'importers:\n  .:\n    dependencies:\n';
        }
        return JSON.stringify({ dependencies: {} });
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ dryRun: true });

      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it('should show dry run message', async () => {
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) {
          return 'importers:\n  .:\n    dependencies:\n';
        }
        return JSON.stringify({ dependencies: {} });
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ dryRun: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Dry run');
    });
  });

  describe('skip build option', () => {
    it('should skip build when skipBuild is true', async () => {
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) {
          return 'importers:\n  .:\n    dependencies:\n';
        }
        return JSON.stringify({ dependencies: {} });
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ skipBuild: true, dryRun: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Build verification skipped');
    });
  });

  describe('lockfile parsing', () => {
    it('should parse dependencies from lockfile', async () => {
      // When specifier matches resolved version, should be in sync
      const lockfileContent = `
importers:
  .:
    dependencies:
      'express':
        specifier: ^4.19.0
        version: 4.19.0
`;
      const packageJson = JSON.stringify({
        dependencies: { express: '^4.19.0' },
      });

      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) return lockfileContent;
        return packageJson;
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ dryRun: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Already in sync');
    });
  });

  describe('package.json syncing', () => {
    it('should detect version mismatches', async () => {
      const lockfileContent = `
importers:
  .:
    dependencies:
      'express':
        specifier: ^4.19.0
        version: 4.19.0
`;
      const packageJson = JSON.stringify({
        dependencies: { express: '^4.18.0' },
      });

      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) return lockfileContent;
        return packageJson;
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ dryRun: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('express');
      expect(output).toContain('4.18.0');
      expect(output).toContain('4.19.0');
    });

    it('should skip workspace dependencies', async () => {
      const lockfileContent = `
importers:
  .:
    dependencies:
      '@tzurot/common-types':
        specifier: workspace:*
        version: link:packages/common-types
`;
      const packageJson = JSON.stringify({
        dependencies: { '@tzurot/common-types': 'workspace:*' },
      });

      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) return lockfileContent;
        return packageJson;
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ dryRun: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Already in sync');
    });
  });

  describe('command execution', () => {
    it('should use execFileSync with array arguments', async () => {
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) {
          return 'importers:\n  .:\n    dependencies:\n';
        }
        return JSON.stringify({ dependencies: {} });
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ skipBuild: false, dryRun: false });

      // Verify pnpm update is called with array args (security)
      expect(execFileSyncMock).toHaveBeenCalledWith(
        'pnpm',
        ['update', '--latest'],
        expect.objectContaining({ encoding: 'utf-8' })
      );
    });

    it('should run pnpm build when not skipped', async () => {
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) {
          return 'importers:\n  .:\n    dependencies:\n';
        }
        return JSON.stringify({ dependencies: {} });
      });

      const { updateDeps } = await import('./update-deps.js');
      await updateDeps({ skipBuild: false, dryRun: false });

      expect(execFileSyncMock).toHaveBeenCalledWith('pnpm', ['build'], expect.anything());
    });
  });
});
