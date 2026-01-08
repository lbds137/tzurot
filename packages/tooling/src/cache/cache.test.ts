import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}));

// Mock fs
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    rmSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  rmSync: vi.fn(),
}));

describe('inspectCache', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should report when no cache exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { inspectCache } = await import('./inspect-cache.js');
    await inspectCache();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('No cache found');
  });

  it('should report cache stats when cache exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'file1', isDirectory: () => false },
      { name: 'file2', isDirectory: () => false },
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.statSync).mockReturnValue({
      size: 1024,
      mtime: new Date(),
    } as fs.Stats);

    vi.resetModules();
    const { inspectCache } = await import('./inspect-cache.js');
    await inspectCache();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Cache Inspection');
    expect(output).toContain('Location');
  });
});

describe('clearCache', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should report when no cache exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { clearCache } = await import('./clear-cache.js');
    await clearCache();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('No cache found');
  });

  it('should dry run without deleting', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    vi.resetModules();
    const { clearCache } = await import('./clear-cache.js');
    await clearCache({ dryRun: true });

    expect(fs.rmSync).not.toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('DRY RUN');
  });

  it('should delete cache when confirmed', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.rmSync).mockImplementation(() => {});

    vi.resetModules();
    const { clearCache } = await import('./clear-cache.js');
    await clearCache();

    expect(fs.rmSync).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('cleared successfully');
  });

  it('should handle deletion errors', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.rmSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    vi.resetModules();
    const { clearCache } = await import('./clear-cache.js');
    await clearCache();

    const output = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Failed to clear cache');
  });
});
