import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

// Mock fs - need to track separately for hoisting
const mockReadFileSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
  writeFileSync: mockWriteFileSync,
}));

describe('bumpVersion', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    // Default: empty directory
    mockReaddirSync.mockReturnValue([]);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('should export bumpVersion function', async () => {
    const module = await import('./bump-version.js');
    expect(typeof module.bumpVersion).toBe('function');
  });

  describe('version validation', () => {
    it('should reject invalid version format', async () => {
      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('invalid-version');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Invalid version format');
      expect(process.exitCode).toBe(1);
    });

    it('should accept valid semver version', async () => {
      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.2.3');

      expect(process.exitCode).toBeUndefined();
    });

    it('should accept semver with prerelease', async () => {
      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('3.0.0-beta.49');

      expect(process.exitCode).toBeUndefined();
    });

    it('should reject version without dots', async () => {
      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('123');

      expect(process.exitCode).toBe(1);
    });
  });

  describe('file discovery', () => {
    it('should handle empty directory', async () => {
      mockReaddirSync.mockReturnValue([]);

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      // Message goes to console.error, not console.log
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No package.json files found');
    });

    it('should skip node_modules directory', async () => {
      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir === process.cwd()) {
          return [
            { name: 'node_modules', isDirectory: () => true, isFile: () => false },
            { name: 'package.json', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.0.1' }));

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      // Should only read the root package.json, not anything in node_modules
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it('should recursively find package.json files', async () => {
      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir === process.cwd()) {
          return [
            { name: 'package.json', isDirectory: () => false, isFile: () => true },
            { name: 'packages', isDirectory: () => true, isFile: () => false },
          ];
        }
        if (dir.endsWith('packages')) {
          return [{ name: 'package.json', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });

      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.0.1' }));

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('version updates', () => {
    beforeEach(() => {
      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir === process.cwd()) {
          return [{ name: 'package.json', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
    });

    it('should update version in package.json', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.0.1' }));

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
      expect(writtenContent).toContain('"version": "1.0.0"');
    });

    it('should skip packages already at target version', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('already at');
    });

    it('should skip packages without version field', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'no-version-pkg' }));

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('no version field');
    });

    it('should not write in dry-run mode', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.0.1' }));

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0', { dryRun: true });

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('DRY RUN');
    });

    it('should show count of updated files', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.0.1' }));

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Updated');
      expect(output).toContain('package.json');
    });
  });
});
