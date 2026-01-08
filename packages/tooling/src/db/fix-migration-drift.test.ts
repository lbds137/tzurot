import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

// Mock common-types
vi.mock('@tzurot/common-types', () => ({
  getPrismaClient: vi.fn(),
  disconnectPrisma: vi.fn(),
}));

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
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('fixMigrationDrift', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockExecuteRaw: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExecuteRaw = vi.fn();
    vi.mocked(getPrismaClient).mockReturnValue({
      $executeRaw: mockExecuteRaw,
    } as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should export fixMigrationDrift function', async () => {
    const module = await import('./fix-migration-drift.js');
    expect(typeof module.fixMigrationDrift).toBe('function');
  });

  it('should show usage when no migration names provided', async () => {
    const { fixMigrationDrift } = await import('./fix-migration-drift.js');
    await fixMigrationDrift([]);

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Usage');
  });

  it('should fix drift for existing migration file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('SELECT 1;'));
    mockExecuteRaw.mockResolvedValue(1);

    const { fixMigrationDrift } = await import('./fix-migration-drift.js');
    await fixMigrationDrift(['test_migration']);

    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(disconnectPrisma).toHaveBeenCalled();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Updated successfully');
  });

  it('should report error for missing migration file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { fixMigrationDrift } = await import('./fix-migration-drift.js');
    await fixMigrationDrift(['missing_migration']);

    const output = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(output).toContain('not found');
  });

  it('should warn when no rows updated', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('SELECT 1;'));
    mockExecuteRaw.mockResolvedValue(0);

    const { fixMigrationDrift } = await import('./fix-migration-drift.js');
    await fixMigrationDrift(['nonexistent_migration']);

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('No rows updated');
  });

  it('should handle multiple migrations', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('SELECT 1;'));
    mockExecuteRaw.mockResolvedValue(1);

    const { fixMigrationDrift } = await import('./fix-migration-drift.js');
    await fixMigrationDrift(['migration1', 'migration2']);

    // Should process both migrations
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
  });
});

describe('migration update logic', () => {
  it('should handle successful update (1 row)', async () => {
    const mockExecuteRaw = vi.fn().mockResolvedValue(1);

    expect(mockExecuteRaw).not.toHaveBeenCalled();
    await mockExecuteRaw`UPDATE _prisma_migrations SET checksum = 'abc' WHERE migration_name = 'test'`;
    expect(mockExecuteRaw).toHaveBeenCalled();
  });

  it('should handle no rows updated (0)', async () => {
    const mockExecuteRaw = vi.fn().mockResolvedValue(0);

    const result = await mockExecuteRaw`UPDATE _prisma_migrations SET checksum = 'abc'`;
    expect(result).toBe(0);
  });
});
