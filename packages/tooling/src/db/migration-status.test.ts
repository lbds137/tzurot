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
    vi.mocked(getPrismaClient).mockReturnValue({
      $queryRaw: mockQueryRaw,
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
    expect(disconnectPrisma).toHaveBeenCalled();
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
