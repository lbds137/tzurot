import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
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

// Mock env-runner to avoid Railway CLI checks in tests
vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
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

describe('checkMigrationDrift', () => {
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

  it('should export checkMigrationDrift function', async () => {
    const module = await import('./check-migration-drift.js');
    expect(typeof module.checkMigrationDrift).toBe('function');
  });

  it('should check all migrations and report no drift', async () => {
    const testChecksum = crypto.createHash('sha256').update(Buffer.from('SELECT 1;')).digest('hex');

    mockQueryRaw.mockResolvedValue([{ migration_name: 'test_migration', checksum: testChecksum }]);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('SELECT 1;'));

    const { checkMigrationDrift } = await import('./check-migration-drift.js');
    await checkMigrationDrift();

    expect(mockQueryRaw).toHaveBeenCalled();
    expect(disconnectPrisma).toHaveBeenCalled();
  });

  it('should report drift when checksums differ', async () => {
    const dbChecksum = crypto.createHash('sha256').update(Buffer.from('SELECT 1;')).digest('hex');

    mockQueryRaw.mockResolvedValue([{ migration_name: 'drifted_migration', checksum: dbChecksum }]);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('SELECT 2;')); // Different content

    const { checkMigrationDrift } = await import('./check-migration-drift.js');
    await checkMigrationDrift();

    // Should log drift detection
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('DRIFT');
  });

  it('should handle missing migration files', async () => {
    mockQueryRaw.mockResolvedValue([{ migration_name: 'missing_migration', checksum: 'abc123' }]);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { checkMigrationDrift } = await import('./check-migration-drift.js');
    await checkMigrationDrift();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('not found');
  });
});

describe('checksum calculation', () => {
  it('should produce consistent SHA-256 checksums', () => {
    const content = Buffer.from('SELECT 1;');
    const checksum = crypto.createHash('sha256').update(content).digest('hex');

    // SHA-256 produces 64 character hex string
    expect(checksum).toHaveLength(64);
    expect(checksum).toMatch(/^[a-f0-9]+$/);

    // Same content should produce same checksum
    const checksum2 = crypto.createHash('sha256').update(content).digest('hex');
    expect(checksum).toBe(checksum2);
  });

  it('should produce different checksums for different content', () => {
    const content1 = Buffer.from('SELECT 1;');
    const content2 = Buffer.from('SELECT 2;');

    const checksum1 = crypto.createHash('sha256').update(content1).digest('hex');
    const checksum2 = crypto.createHash('sha256').update(content2).digest('hex');

    expect(checksum1).not.toBe(checksum2);
  });
});
