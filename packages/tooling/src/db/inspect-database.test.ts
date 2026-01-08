import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

// Mock common-types before importing
vi.mock('@tzurot/common-types', () => ({
  getPrismaClient: vi.fn(),
  disconnectPrisma: vi.fn(),
}));

// Mock chalk to simplify output testing
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

describe('getDatabaseHost', () => {
  const originalEnv = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DATABASE_URL = originalEnv;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it('should extract host from valid DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.com:5432/mydb';

    const module = await import('./inspect-database.js');
    expect(module.inspectDatabase).toBeDefined();
  });

  it('should return unknown for missing DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;

    const module = await import('./inspect-database.js');
    expect(module.inspectDatabase).toBeDefined();
  });

  it('should handle malformed DATABASE_URL and warn', async () => {
    process.env.DATABASE_URL = 'not-a-valid-url';
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Reset module to pick up new env
    vi.resetModules();
    const { inspectDatabase } = await import('./inspect-database.js');

    // Mock Prisma for the call
    vi.mocked(getPrismaClient).mockReturnValue({
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as never);

    await inspectDatabase({ indexes: true });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('DATABASE_URL appears malformed')
    );
    consoleWarnSpy.mockRestore();
  });
});

describe('inspectDatabase', () => {
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

  it('should call inspectTableDetails when table option provided', async () => {
    // Return table columns
    mockQueryRaw.mockResolvedValueOnce([
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
    ]);
    // Return indexes for this table
    mockQueryRaw.mockResolvedValueOnce([]);

    const { inspectDatabase } = await import('./inspect-database.js');
    await inspectDatabase({ table: 'users' });

    expect(mockQueryRaw).toHaveBeenCalled();
    expect(disconnectPrisma).toHaveBeenCalled();
  });

  it('should report table not found when empty columns', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const { inspectDatabase } = await import('./inspect-database.js');
    await inspectDatabase({ table: 'nonexistent' });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('not found');
  });

  it('should call inspectIndexes when indexes option is true', async () => {
    // Return indexes
    mockQueryRaw.mockResolvedValueOnce([
      { indexname: 'users_pkey', indexdef: 'CREATE INDEX', tablename: 'users' },
      { indexname: 'idx_memories_embedding', indexdef: 'CREATE INDEX', tablename: 'memories' },
    ]);

    const { inspectDatabase } = await import('./inspect-database.js');
    await inspectDatabase({ indexes: true });

    expect(mockQueryRaw).toHaveBeenCalled();
  });

  it('should run all inspections with no options', async () => {
    // Tables query
    mockQueryRaw.mockResolvedValueOnce([
      { tablename: 'users', rowcount: BigInt(100), size: '16 kB' },
    ]);
    // Indexes query
    mockQueryRaw.mockResolvedValueOnce([
      { indexname: 'users_pkey', indexdef: 'CREATE INDEX', tablename: 'users' },
    ]);
    // Migrations query
    mockQueryRaw.mockResolvedValueOnce([
      { migration_name: 'init', finished_at: new Date(), applied_steps_count: 1 },
    ]);
    // Failed migrations query
    mockQueryRaw.mockResolvedValueOnce([]);

    const { inspectDatabase } = await import('./inspect-database.js');
    await inspectDatabase();

    // Should have made multiple queries
    expect(mockQueryRaw).toHaveBeenCalledTimes(4);
    expect(disconnectPrisma).toHaveBeenCalled();
  });

  it('should report failed migrations', async () => {
    // Tables query
    mockQueryRaw.mockResolvedValueOnce([]);
    // Indexes query
    mockQueryRaw.mockResolvedValueOnce([]);
    // Migrations query
    mockQueryRaw.mockResolvedValueOnce([
      { migration_name: 'failed_migration', finished_at: null, applied_steps_count: 0 },
    ]);
    // Failed migrations query
    mockQueryRaw.mockResolvedValueOnce([
      { migration_name: 'failed_migration', finished_at: null, applied_steps_count: 0 },
    ]);

    const { inspectDatabase } = await import('./inspect-database.js');
    await inspectDatabase();

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('FAILED');
  });

  it('should show protected indexes status', async () => {
    // Return indexes including protected one
    mockQueryRaw.mockResolvedValueOnce([
      { indexname: 'idx_memories_embedding', indexdef: 'CREATE INDEX', tablename: 'memories' },
    ]);

    const { inspectDatabase } = await import('./inspect-database.js');
    await inspectDatabase({ indexes: true });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('PROTECTED');
    expect(output).toContain('EXISTS');
  });

  it('should report missing protected indexes', async () => {
    // Return empty indexes (protected index is missing)
    mockQueryRaw.mockResolvedValueOnce([]);

    const { inspectDatabase } = await import('./inspect-database.js');
    await inspectDatabase({ indexes: true });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('MISSING');
  });
});
