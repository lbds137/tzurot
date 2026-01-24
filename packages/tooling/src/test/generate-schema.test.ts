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

// Mock child_process
const execFileSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

// Mock fs
const fsMock = {
  writeFileSync: vi.fn(),
};
vi.mock('node:fs', () => fsMock);

describe('generateSchema', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    // Default: successful prisma migrate diff
    execFileSyncMock.mockReturnValue('CREATE TABLE users (id INT);');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('should export generateSchema function', async () => {
    const module = await import('./generate-schema.js');
    expect(typeof module.generateSchema).toBe('function');
  });

  describe('schema generation', () => {
    it('should run prisma migrate diff command', async () => {
      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      expect(execFileSyncMock).toHaveBeenCalled();
      const [cmd, args] = execFileSyncMock.mock.calls[0] as [string, string[]];
      expect(cmd).toBe('npx');
      expect(args).toContain('prisma');
      expect(args).toContain('migrate');
      expect(args).toContain('diff');
      expect(args).toContain('--from-empty');
      expect(args).toContain('--to-schema');
      expect(args).toContain('--script');
    });

    it('should write SQL to output file', async () => {
      execFileSyncMock.mockReturnValue('CREATE TABLE test (id INT);');

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      expect(fsMock.writeFileSync).toHaveBeenCalled();
      const [, content] = fsMock.writeFileSync.mock.calls[0];
      expect(content).toContain('CREATE TABLE test');
    });

    it('should use default output path', async () => {
      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      expect(fsMock.writeFileSync).toHaveBeenCalled();
      const [path] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(path).toContain('pglite-schema.sql');
      expect(path).toContain('tests/integration/schema');
    });

    it('should use custom output path when provided', async () => {
      const customPath = '/custom/path/schema.sql';

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema({ output: customPath });

      expect(fsMock.writeFileSync).toHaveBeenCalled();
      const [path] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(path).toBe(customPath);
    });

    it('should show success message with line count', async () => {
      execFileSyncMock.mockReturnValue('LINE1\nLINE2\nLINE3');

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Generated');
      expect(output).toContain('3 lines');
    });
  });

  describe('error handling', () => {
    it('should handle prisma command failure', async () => {
      execFileSyncMock.mockImplementation(() => {
        throw new Error('Prisma failed');
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Failed to generate schema');
      expect(process.exitCode).toBe(1);
    });

    it('should show prisma install hint on failure', async () => {
      const error = new Error('prisma: command not found');
      execFileSyncMock.mockImplementation(() => {
        throw error;
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('pnpm install');
    });
  });
});
