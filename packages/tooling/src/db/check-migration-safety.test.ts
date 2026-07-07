import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';

// Mock fs with memfs
vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    dim: (s: string) => s,
    green: (s: string) => s,
    red: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: (s: string) => s,
  },
}));

describe('checkMigrationSafety', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vol.reset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('ignores a sanitized DROP INDEX marker left by the drift sanitizer', async () => {
    vol.fromJSON({
      '/migrations/20240104_sanitized/migration.sql': [
        '-- REMOVED: DROP INDEX "idx_memories_embedding";',
        'CREATE TABLE foo (id UUID PRIMARY KEY);',
      ].join('\n'),
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations' });

    expect(processExitSpy).not.toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('All migrations are safe');
  });

  it('still flags a live DROP INDEX on a protected index', async () => {
    vol.fromJSON({
      '/migrations/20240105_dangerous/migration.sql': 'DROP INDEX "idx_memory_facts_embedding";',
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should pass when no migrations exist', async () => {
    vol.fromJSON({});

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations' });

    expect(processExitSpy).not.toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('No migration files found');
  });

  it('should pass for safe migrations', async () => {
    vol.fromJSON({
      '/migrations/20240101_add_users/migration.sql': `
        CREATE TABLE users (id UUID PRIMARY KEY);
        CREATE INDEX idx_users_email ON users(email);
      `,
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations' });

    expect(processExitSpy).not.toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('All migrations are safe');
  });

  it('should detect dropped idx_memories_embedding without recreate', async () => {
    vol.fromJSON({
      '/migrations/20240102_bad_migration/migration.sql': `
        DROP INDEX idx_memories_embedding;
        -- oops, forgot to recreate it
      `,
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('DANGEROUS MIGRATIONS DETECTED');
    expect(output).toContain('idx_memories_embedding');
  });

  it('should pass when index is dropped and recreated in same file', async () => {
    vol.fromJSON({
      '/migrations/20240103_safe_migration/migration.sql': `
        DROP INDEX idx_memories_embedding;
        -- alter column type
        ALTER TABLE memories ALTER COLUMN embedding TYPE vector(384);
        CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding);
      `,
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations' });

    expect(processExitSpy).not.toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('All migrations are safe');
  });

  it('should find sql files recursively', async () => {
    vol.fromJSON({
      '/migrations/20240101_first/migration.sql': 'CREATE TABLE a (id INT);',
      '/migrations/20240102_second/migration.sql': 'CREATE TABLE b (id INT);',
      '/migrations/20240103_third/migration.sql': 'CREATE TABLE c (id INT);',
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations', verbose: true });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Found 3 migration files');
  });

  it('should show verbose output when option is set', async () => {
    vol.fromJSON({
      '/migrations/20240101_test/migration.sql': 'CREATE TABLE x (id INT);',
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations', verbose: true });

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Found 1 migration files');
  });

  describe('--summary mode', () => {
    it('emits an ok JSONL summary line when migrations are safe', async () => {
      vol.fromJSON({
        '/migrations/20240101_test/migration.sql': 'CREATE TABLE x (id INT);',
      });

      const { checkMigrationSafety } = await import('./check-migration-safety.js');
      const { parseSummary } = await import('../audits/summary.js');
      await checkMigrationSafety({ migrationsPath: '/migrations', summary: true });

      expect(processExitSpy).not.toHaveBeenCalled();
      // The summary line is the last console.log call. Everything else
      // (human-readable output) is suppressed by `summary: true`.
      const lastLogCall = consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1];
      const summary = parseSummary(String(lastLogCall[0]));
      expect(summary.tool).toBe('db:check-safety');
      expect(summary.status).toBe('ok');
      expect(summary.findings).toBe(0);
    });

    it('emits a fail JSONL summary line + exits 1 when a violation is found', async () => {
      vol.fromJSON({
        '/migrations/20240101_test/migration.sql': 'DROP INDEX "idx_memories_embedding";',
      });

      const { checkMigrationSafety } = await import('./check-migration-safety.js');
      const { parseSummary } = await import('../audits/summary.js');
      await checkMigrationSafety({ migrationsPath: '/migrations', summary: true });

      const lastLogCall = consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1];
      const summary = parseSummary(String(lastLogCall[0]));
      expect(summary.tool).toBe('db:check-safety');
      expect(summary.status).toBe('fail');
      expect(summary.findings).toBe(1);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
