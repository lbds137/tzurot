import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: Object.assign((s: string) => s, { bold: (s: string) => s }),
    red: Object.assign((s: string) => s, { bold: (s: string) => s }),
    dim: (s: string) => s,
  },
}));

// Mock fs
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { checkBoundaries } from './check-boundaries.js';

describe('checkBoundaries', () => {
  let consoleLogSpy: MockInstance;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    // Default: empty directories
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
      typeof statSync
    >);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('should export checkBoundaries function', () => {
    expect(typeof checkBoundaries).toBe('function');
  });

  describe('when no files exist', () => {
    it('should report no violations', async () => {
      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });
  });

  describe('violation detection', () => {
    it('should detect bot-client importing @prisma/client', async () => {
      // Setup: bot-client has one file
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(output).toContain('@prisma/client');
      expect(process.exitCode).toBe(1);
    });

    it('should detect api-gateway importing from bot-client', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('api-gateway/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { something } from '@tzurot/bot-client';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('boundary violation');
      expect(process.exitCode).toBe(1);
    });

    it('should report warnings for discord.js in ai-worker', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('ai-worker/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { Client } from 'discord.js';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('warning');
      // Warnings don't set exit code
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('allowed imports', () => {
    it('should allow common-types imports', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { PersonalityConfig } from '@tzurot/common-types';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });

    it('should allow internal service imports', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);
      vi.mocked(readFileSync).mockReturnValue(`
import { formatMessage } from './utils/formatter.js';
`);

      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No boundary violations found');
    });
  });

  describe('file filtering', () => {
    it('should skip test files', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['test.test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<
        typeof statSync
      >);

      await checkBoundaries();

      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('should skip node_modules', async () => {
      vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
        const dirStr = String(dir);
        if (dirStr.includes('bot-client/src')) return ['node_modules', 'test.ts'];
        return [];
      }) as typeof readdirSync);
      vi.mocked(statSync).mockImplementation((path: unknown) => {
        const pathStr = String(path);
        return {
          isDirectory: () => pathStr.includes('node_modules'),
        } as ReturnType<typeof statSync>;
      });
      vi.mocked(readFileSync).mockReturnValue('// clean file');

      await checkBoundaries();

      // Should only read test.ts, not anything in node_modules
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('output formatting', () => {
    it('should show tips', async () => {
      await checkBoundaries();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Tips');
      expect(output).toContain('common-types');
    });

    it('should show verbose output when requested', async () => {
      await checkBoundaries({ verbose: true });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Checking');
    });
  });
});
