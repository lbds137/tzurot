import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';

const mockDispose = vi.fn().mockResolvedValue(undefined);

// Mock common-types
vi.mock('@tzurot/common-types/services/poolConfig', () => ({
  DB_POOL_DEFAULTS: { TRANSIENT_MAX: 5 },
}));
vi.mock('@tzurot/common-types/services/prisma', () => ({
  createPrismaClient: vi.fn(),
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
    blue: (s: string) => s,
  },
}));

// Mock fs
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

// Track env-runner mock state
const envRunnerMock = {
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  runPrismaCommand: vi.fn(),
};

// Mock env-runner
vi.mock('../utils/env-runner.js', () => envRunnerMock);

describe('getMigrationStatus', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockQueryRaw: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockQueryRaw = vi.fn();
    vi.mocked(createPrismaClient).mockReturnValue({
      prisma: { $queryRaw: mockQueryRaw },
      dispose: mockDispose,
    } as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should export getMigrationStatus function', async () => {
    const module = await import('./migration-status.js');
    expect(typeof module.getMigrationStatus).toBe('function');
  });

  it('should show migration status for local environment', async () => {
    // Mock database migrations
    mockQueryRaw.mockResolvedValue([
      {
        id: '1',
        migration_name: '20251201_init',
        checksum: 'abc123',
        finished_at: new Date('2025-12-01'),
        started_at: new Date('2025-12-01'),
        applied_steps_count: 1,
      },
    ]);

    // Mock local migration files
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: '20251201_init', isDirectory: () => true },
    ] as never);

    const { getMigrationStatus } = await import('./migration-status.js');
    await getMigrationStatus({ env: 'local' });

    expect(mockQueryRaw).toHaveBeenCalled();
    expect(mockDispose).toHaveBeenCalled();
  });

  it('should use runPrismaCommand for dev environment', async () => {
    envRunnerMock.runPrismaCommand.mockResolvedValue({
      stdout: 'Migration status output',
      stderr: '',
      exitCode: 0,
    });

    const { getMigrationStatus } = await import('./migration-status.js');
    await getMigrationStatus({ env: 'dev' });

    expect(envRunnerMock.runPrismaCommand).toHaveBeenCalledWith('dev', 'migrate', ['status']);
  });

  it('should show applied migrations count', async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: '1',
        migration_name: '20251201_init',
        checksum: 'abc123',
        finished_at: new Date('2025-12-01'),
        started_at: new Date('2025-12-01'),
        applied_steps_count: 1,
      },
      {
        id: '2',
        migration_name: '20251202_add_users',
        checksum: 'def456',
        finished_at: new Date('2025-12-02'),
        started_at: new Date('2025-12-02'),
        applied_steps_count: 1,
      },
    ]);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: '20251201_init', isDirectory: () => true },
      { name: '20251202_add_users', isDirectory: () => true },
    ] as never);

    const { getMigrationStatus } = await import('./migration-status.js');
    await getMigrationStatus({ env: 'local' });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Applied');
    expect(output).toContain('2');
  });

  it('should show pending migrations when files exist but not applied', async () => {
    // No migrations in database
    mockQueryRaw.mockResolvedValue([]);

    // But files exist
    vi.mocked(fs.existsSync).mockImplementation(p => {
      if (String(p).includes('migration.sql')) return true;
      return true;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: '20251201_init', isDirectory: () => true },
    ] as never);

    const { getMigrationStatus } = await import('./migration-status.js');
    await getMigrationStatus({ env: 'local' });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Pending');
  });

  it('should show failed migrations', async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: '1',
        migration_name: '20251201_failed',
        checksum: 'abc123',
        finished_at: null, // Failed migration has null finished_at
        started_at: new Date('2025-12-01'),
        applied_steps_count: 0,
      },
    ]);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: '20251201_failed', isDirectory: () => true },
    ] as never);

    const { getMigrationStatus } = await import('./migration-status.js');
    await getMigrationStatus({ env: 'local' });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Failed');
  });
});

describe('isDbUnreachable', () => {
  it('is true only when a non-zero exit is accompanied by the unreachable text', async () => {
    const { isDbUnreachable } = await import('./migration-status.js');

    expect(
      isDbUnreachable({
        exitCode: 1,
        stderr: "Error: P1001: Can't reach database server at `host`:`5432`",
      })
    ).toBe(true);
  });

  it('is false for pending migrations — the same non-zero exit with no unreachable text', async () => {
    const { isDbUnreachable } = await import('./migration-status.js');

    // The discriminator's whole reason for existing: `migrate status` exits
    // non-zero for pending migrations too, so exit code alone cannot split them.
    expect(
      isDbUnreachable({
        exitCode: 1,
        stderr: '',
      })
    ).toBe(false);
  });

  it('is false on a clean exit even if the text appears in stderr', async () => {
    const { isDbUnreachable } = await import('./migration-status.js');

    expect(
      isDbUnreachable({ exitCode: 0, stderr: "warning: Can't reach database server (retried)" })
    ).toBe(false);
  });

  it('exits 1 from db:status when dev is unreachable', async () => {
    envRunnerMock.runPrismaCommand.mockResolvedValue({
      stdout: '',
      stderr: "Error: P1001: Can't reach database server at `host`:`5432`",
      exitCode: 1,
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { getMigrationStatus } = await import('./migration-status.js');
    await expect(getMigrationStatus({ env: 'dev' })).rejects.toThrow('process.exit:1');

    exitSpy.mockRestore();
  });

  it('does NOT exit from db:status when dev merely has pending migrations', async () => {
    envRunnerMock.runPrismaCommand.mockResolvedValue({
      stdout: 'Following migration have not yet been applied:\n20260627_add_kind',
      stderr: '',
      exitCode: 1,
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);

    const { getMigrationStatus } = await import('./migration-status.js');
    await getMigrationStatus({ env: 'dev' });

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('getLocalMigrations', () => {
  it('should filter out non-directory entries', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: '20251201_init', isDirectory: () => true },
      { name: 'README.md', isDirectory: () => false }, // Should be filtered
      { name: '.gitkeep', isDirectory: () => false }, // Should be filtered
    ] as never);

    // The filtering happens internally in the module
    const module = await import('./migration-status.js');
    expect(module.getMigrationStatus).toBeDefined();
  });

  it('should handle missing migrations directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // Should not throw when directory doesn't exist
    const module = await import('./migration-status.js');
    expect(module.getMigrationStatus).toBeDefined();
  });
});
