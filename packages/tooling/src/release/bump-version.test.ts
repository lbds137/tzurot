import { join } from 'node:path';
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

/**
 * Every bump now runs the CURRENT.md reset gate first (see current-md-gate.ts),
 * so a fixture tree needs a CURRENT.md whose header agrees with the root
 * package.json — otherwise the bump refuses before it discovers a single file.
 * The gate's own cases live in current-md-gate.test.ts; the block at the bottom
 * of this file covers its wiring into bumpVersion.
 */
const currentMdText = (version: string): string =>
  `# Current\n\n> **Version**: v${version} — session notes\n`;

/** `readFileSync` over a tree: package.json content per path, plus CURRENT.md. */
function mockTree(pkgFor: (path: string) => unknown, currentVersion: string): void {
  mockReadFileSync.mockImplementation((path: string) =>
    String(path).endsWith('CURRENT.md')
      ? currentMdText(currentVersion)
      : JSON.stringify(pkgFor(String(path)))
  );
}

/** The common shape: every package.json at `version`, CURRENT.md agreeing. */
function mockPackages(version: string, currentVersion = version): void {
  mockTree(() => ({ version }), currentVersion);
}

/** Distinct package.json paths that were read, gate reads and all. */
function packageJsonPathsRead(): Set<string> {
  return new Set(
    mockReadFileSync.mock.calls
      .map(call => String(call[0]))
      .filter(path => path.endsWith('package.json'))
  );
}

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

    // Default: empty directory, and a tree whose CURRENT.md is already reset —
    // every test below is about the bump, not about the gate in front of it.
    mockReaddirSync.mockReturnValue([]);
    mockPackages('0.0.1');
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

      mockPackages('0.0.1');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      // Should only read the root package.json, not anything in node_modules.
      // Asserted over the PATHS rather than the call count: the reset gate reads
      // CURRENT.md and the root package.json before discovery starts, so a count
      // no longer isolates what discovery touched.
      expect(packageJsonPathsRead()).toEqual(new Set([join(process.cwd(), 'package.json')]));
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

      mockPackages('0.0.1');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(packageJsonPathsRead()).toEqual(
        new Set([
          join(process.cwd(), 'package.json'),
          join(process.cwd(), 'packages', 'package.json'),
        ])
      );
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
      mockPackages('0.0.1');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string;
      expect(writtenContent).toContain('"version": "1.0.0"');
    });

    it('should skip packages already at target version', async () => {
      mockPackages('1.0.0');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('already at');
    });

    it('should skip packages without version field', async () => {
      // The versionless package is a NESTED one: the root package.json is what
      // the reset gate compares CURRENT.md against, so a versionless root would
      // be testing the gate's fail-closed path instead of this skip.
      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir === process.cwd()) {
          return [{ name: 'packages', isDirectory: () => true, isFile: () => false }];
        }
        if (dir.endsWith('packages')) {
          return [{ name: 'package.json', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      mockTree(
        path =>
          path === join(process.cwd(), 'package.json')
            ? { version: '0.0.1' }
            : { name: 'no-version-pkg' },
        '0.0.1'
      );

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('no version field');
    });

    it('should not write in dry-run mode', async () => {
      mockPackages('0.0.1');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0', { dryRun: true });

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('DRY RUN');
    });

    it('should show count of updated files', async () => {
      mockPackages('0.0.1');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('1.0.0');

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Updated');
      expect(output).toContain('package.json');
    });
  });

  describe('CURRENT.md reset gate', () => {
    beforeEach(() => {
      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir === process.cwd()) {
          return [{ name: 'package.json', isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
    });

    it('refuses to bump when CURRENT.md still declares the previous release', async () => {
      // The exact signature of a skipped reset: the file names the release
      // before last while package.json has already moved on.
      mockPackages('3.0.0-beta.196', '3.0.0-beta.195');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('3.0.0-beta.197');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('release step 9');
      expect(output).toContain('--allow-stale-current');
    });

    it('refuses when CURRENT.md has no parseable version header', async () => {
      // Fail-closed. An unparseable header cannot establish that the reset
      // happened, and reading it as a pass would silently disarm the gate.
      mockReadFileSync.mockImplementation((path: string) =>
        String(path).endsWith('CURRENT.md')
          ? '# Current\n\nsomebody reformatted the header\n'
          : JSON.stringify({ version: '3.0.0-beta.196' })
      );

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('3.0.0-beta.197');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('proceeds when CURRENT.md agrees with package.json', async () => {
      mockPackages('3.0.0-beta.196');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('3.0.0-beta.197');

      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('proceeds on a stale CURRENT.md when the bypass flag is passed', async () => {
      mockPackages('3.0.0-beta.196', '3.0.0-beta.195');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('3.0.0-beta.197', { allowStaleCurrent: true });

      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('refuses in dry-run too, rather than previewing a bump it would refuse', async () => {
      mockPackages('3.0.0-beta.196', '3.0.0-beta.195');

      const { bumpVersion } = await import('./bump-version.js');
      await bumpVersion('3.0.0-beta.197', { dryRun: true });

      expect(process.exitCode).toBe(1);
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('release step 9');
    });
  });
});
