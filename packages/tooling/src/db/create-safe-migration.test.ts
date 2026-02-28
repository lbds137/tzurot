import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sanitizeMigrationSql,
  generateMigrationTimestamp,
  computeFileChecksum,
  reconcileMigrationChecksum,
} from './create-safe-migration.js';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

// Mock common-types for reconcileMigrationChecksum tests
vi.mock('@tzurot/common-types', () => ({
  getPrismaClient: vi.fn(),
  disconnectPrisma: vi.fn(),
}));

/**
 * Tests for create-safe-migration
 *
 * The core sanitization logic is tested directly via the exported `sanitizeMigrationSql`.
 * The timestamp generation is tested for format correctness.
 * The full command flow (createSafeMigration) requires:
 * - Real filesystem operations
 * - Real prisma command execution
 * - Proper module isolation for mocking
 *
 * Integration testing of the full command is done manually via:
 *   pnpm ops db:safe-migrate --name test_migration
 */

describe('sanitizeMigrationSql', () => {
  const defaultPatterns = [
    {
      pattern: 'DROP INDEX.*idx_memories_embedding',
      reason: 'IVFFlat vector index cannot be represented in Prisma schema',
      action: 'remove' as const,
    },
    {
      pattern: 'CREATE INDEX.*memories_chunk_group_id_idx(?!.*WHERE)',
      reason: 'Prisma generates non-partial index, but we need the partial version',
      action: 'remove' as const,
    },
    {
      pattern: 'DROP INDEX.*memories_chunk_group_id_idx',
      reason: 'Partial index cannot be represented in Prisma schema',
      action: 'remove' as const,
    },
  ];

  describe('vector index protection', () => {
    it('should remove DROP INDEX for protected vector index', () => {
      const sql = `-- DropIndex
DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "test" ADD COLUMN "foo" TEXT;
`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(1);
      expect(removed[0].statement).toContain('idx_memories_embedding');
      expect(removed[0].reason).toContain('IVFFlat');
      expect(sanitized).toContain('-- REMOVED:');
      expect(sanitized).toContain('ALTER TABLE "test"');
    });
  });

  describe('partial index protection', () => {
    it('should remove CREATE INDEX without WHERE clause for partial index', () => {
      const sql = `-- CreateIndex
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");

-- AlterTable
ALTER TABLE "test" ADD COLUMN "bar" TEXT;
`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(1);
      expect(removed[0].statement).toContain('memories_chunk_group_id_idx');
      expect(removed[0].reason).toContain('non-partial');
      expect(sanitized).toContain('-- REMOVED:');
      expect(sanitized).toContain('ALTER TABLE "test"');
    });

    it('should NOT remove CREATE INDEX with WHERE clause (proper partial index)', () => {
      const sql = `-- CreateIndex (proper partial index)
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id") WHERE "chunk_group_id" IS NOT NULL;
`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(0);
      expect(sanitized).not.toContain('-- REMOVED:');
      expect(sanitized).toContain('WHERE');
    });

    it('should remove DROP INDEX for partial index', () => {
      const sql = `-- DropIndex
DROP INDEX "memories_chunk_group_id_idx";

-- AlterTable
ALTER TABLE "test" ADD COLUMN "baz" TEXT;
`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(1);
      expect(removed[0].statement).toContain('memories_chunk_group_id_idx');
      expect(sanitized).toContain('-- REMOVED:');
    });
  });

  describe('multiple patterns', () => {
    it('should handle multiple dangerous patterns in one migration', () => {
      const sql = `-- DropIndex
DROP INDEX "idx_memories_embedding";

-- DropIndex
DROP INDEX "memories_chunk_group_id_idx";

-- AlterTable
ALTER TABLE "test" ADD COLUMN "foo" TEXT;
`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(2);
      expect(removed.some(r => r.statement.includes('idx_memories_embedding'))).toBe(true);
      expect(removed.some(r => r.statement.includes('memories_chunk_group_id_idx'))).toBe(true);
      // Both lines should be marked as removed
      expect((sanitized.match(/-- REMOVED:/g) || []).length).toBe(2);
    });
  });

  describe('no matches', () => {
    it('should return empty removed array when no patterns match', () => {
      const sql = `-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" TEXT;

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");
`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(0);
      expect(sanitized).not.toContain('-- REMOVED:');
      expect(sanitized).toBe(sql);
    });

    it('should work with empty patterns array', () => {
      const sql = `DROP INDEX "idx_memories_embedding";`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, []);

      expect(removed).toHaveLength(0);
      expect(sanitized).toBe(sql);
    });
  });

  describe('formatting', () => {
    it('should clean up multiple blank lines left by removals', () => {
      const sql = `-- DropIndex
DROP INDEX "idx_memories_embedding";



-- AlterTable
ALTER TABLE "test" ADD COLUMN "foo" TEXT;
`;

      const { sanitized } = sanitizeMigrationSql(sql, defaultPatterns);

      // Should not have more than 2 consecutive newlines
      expect(sanitized).not.toMatch(/\n{4,}/);
    });

    it('should preserve line context in removed statements', () => {
      const sql = `-- This is a comment before
DROP INDEX "idx_memories_embedding"; -- inline comment
-- This is a comment after`;

      const { removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(1);
      // The full line including inline comment should be captured
      expect(removed[0].statement).toContain('inline comment');
    });
  });

  describe('custom patterns', () => {
    it('should handle custom patterns', () => {
      const customPatterns = [
        {
          pattern: 'DROP TABLE.*deprecated_table',
          reason: 'Custom protection for deprecated table',
          action: 'remove' as const,
        },
      ];

      const sql = `DROP TABLE "deprecated_table";

ALTER TABLE "users" ADD COLUMN "new_col" TEXT;
`;

      const { sanitized, removed } = sanitizeMigrationSql(sql, customPatterns);

      expect(removed).toHaveLength(1);
      expect(removed[0].reason).toContain('Custom protection');
      expect(sanitized).toContain('-- REMOVED:');
    });
  });

  describe('case insensitivity', () => {
    it('should match patterns case-insensitively', () => {
      const sql = `drop index "idx_memories_embedding";`;

      const { removed } = sanitizeMigrationSql(sql, defaultPatterns);

      expect(removed).toHaveLength(1);
    });
  });
});

describe('generateMigrationTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should produce a 14-digit YYYYMMDDHHMMSS string', () => {
    const ts = generateMigrationTimestamp();
    expect(ts).toMatch(/^\d{14}$/);
  });

  it('should match the current local date/time', () => {
    vi.useFakeTimers();
    const fakeDate = new Date('2026-03-15T09:05:07.000Z');
    vi.setSystemTime(fakeDate);

    const ts = generateMigrationTimestamp();

    // Build expected from local time (same as the function does)
    const pad = (n: number): string => String(n).padStart(2, '0');
    const expected =
      String(fakeDate.getFullYear()) +
      pad(fakeDate.getMonth() + 1) +
      pad(fakeDate.getDate()) +
      pad(fakeDate.getHours()) +
      pad(fakeDate.getMinutes()) +
      pad(fakeDate.getSeconds());

    expect(ts).toBe(expected);
  });

  it('should produce exactly 14 characters for any date', () => {
    vi.useFakeTimers();
    // Use a date with single-digit month/day/hour/minute/second in UTC
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

    const ts = generateMigrationTimestamp();
    expect(ts).toHaveLength(14);
    // Every component should be zero-padded (no single digits in output)
    expect(ts).toMatch(/^\d{14}$/);
  });
});

describe('computeFileChecksum', () => {
  it('should produce a 64-character hex SHA-256 digest', () => {
    const checksum = computeFileChecksum('test content');
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce deterministic output for the same input', () => {
    const a = computeFileChecksum('migration SQL content');
    const b = computeFileChecksum('migration SQL content');
    expect(a).toBe(b);
  });

  it('should produce different output for different input', () => {
    const original = computeFileChecksum('DROP INDEX "idx_memories_embedding";');
    const sanitized = computeFileChecksum('-- REMOVED: DROP INDEX "idx_memories_embedding";');
    expect(original).not.toBe(sanitized);
  });
});

describe('reconcileMigrationChecksum', () => {
  let mockExecuteRaw: ReturnType<typeof vi.fn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteRaw = vi.fn();
    vi.mocked(getPrismaClient).mockReturnValue({ $executeRaw: mockExecuteRaw } as never);
    vi.mocked(disconnectPrisma).mockResolvedValue(undefined as never);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should update checksum via $executeRaw when migration exists', async () => {
    mockExecuteRaw.mockResolvedValue(1);

    await reconcileMigrationChecksum('/migrations/20260228015810_test_migration', 'sanitized SQL');

    expect(getPrismaClient).toHaveBeenCalled();
    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Checksum reconciled'));
  });

  it('should be a no-op when no matching row exists (migration not yet applied)', async () => {
    mockExecuteRaw.mockResolvedValue(0); // No rows updated

    await reconcileMigrationChecksum('/migrations/20260228015810_new_migration', 'SQL content');

    expect(mockExecuteRaw).toHaveBeenCalled();
    // Still logs success — the UPDATE ran fine, just matched 0 rows
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Checksum reconciled'));
  });

  it('should handle DB errors non-fatally', async () => {
    mockExecuteRaw.mockRejectedValue(new Error('Connection refused'));

    await reconcileMigrationChecksum('/migrations/20260228015810_test_migration', 'SQL content');

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not reconcile checksum')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Connection refused'));
  });

  it('should disconnect in finally block even after error', async () => {
    mockExecuteRaw.mockRejectedValue(new Error('DB error'));

    await reconcileMigrationChecksum('/migrations/20260228015810_test_migration', 'SQL content');

    expect(disconnectPrisma).toHaveBeenCalled();
  });

  it('should handle disconnectPrisma failure silently', async () => {
    mockExecuteRaw.mockResolvedValue(1);
    vi.mocked(disconnectPrisma).mockRejectedValue(new Error('Already disconnected'));

    // Should not throw
    await reconcileMigrationChecksum('/migrations/20260228015810_test_migration', 'SQL content');

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Checksum reconciled'));
  });
});
