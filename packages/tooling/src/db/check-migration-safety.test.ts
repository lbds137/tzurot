import { fileURLToPath } from 'node:url';
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

// The module under test resolves prisma/drift-ignore.json relative to its own
// file location (not process.cwd()) — see DEFAULT_DRIFT_IGNORE_PATH in
// check-migration-safety.ts. Compute the identical absolute path here so the
// mocked memfs volume has a file at the exact location the loader will read.
const DRIFT_IGNORE_PATH = fileURLToPath(
  new URL('../../../../prisma/drift-ignore.json', import.meta.url)
);

/** Minimal, real-shaped protectedIndexes fixture seeded into every test's memfs volume. */
const DRIFT_IGNORE_FIXTURE = JSON.stringify({
  protectedIndexes: [
    {
      name: 'idx_memories_embedding',
      table: 'memories',
      type: 'ivfflat',
      description: 'IVFFlat vector index for BGE embeddings (384 dims)',
      recreateSQL:
        'CREATE INDEX "idx_memories_embedding" ON "memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);',
      dropPattern: 'DROP\\s+INDEX.*idx_memories_embedding',
      createPattern: 'CREATE\\s+INDEX.*idx_memories_embedding',
    },
    {
      name: 'memories_chunk_group_id_idx',
      table: 'memories',
      type: 'partial',
      description: 'Partial index with WHERE clause',
      recreateSQL:
        'CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id") WHERE "chunk_group_id" IS NOT NULL;',
      dropPattern: 'DROP\\s+INDEX.*memories_chunk_group_id_idx',
      createPattern: 'CREATE\\s+INDEX.*memories_chunk_group_id_idx',
    },
    {
      name: 'idx_memory_facts_embedding',
      table: 'memory_facts',
      type: 'ivfflat',
      description: 'IVFFlat vector index for fact similarity retrieval (384 dims)',
      recreateSQL:
        'CREATE INDEX "idx_memory_facts_embedding" ON "memory_facts" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50)',
      dropPattern: 'DROP\\s+INDEX.*idx_memory_facts_embedding',
      createPattern: 'CREATE\\s+INDEX.*idx_memory_facts_embedding',
    },
  ],
});

describe('checkMigrationSafety', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vol.reset();
    vol.fromJSON({ [DRIFT_IGNORE_PATH]: DRIFT_IGNORE_FIXTURE });
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

  it('should detect dropped memories_chunk_group_id_idx without recreate', async () => {
    vol.fromJSON({
      '/migrations/20240106_bad_partial/migration.sql': `
        DROP INDEX "memories_chunk_group_id_idx";
        -- oops, forgot the partial recreate
      `,
    });

    const { checkMigrationSafety } = await import('./check-migration-safety.js');
    await checkMigrationSafety({ migrationsPath: '/migrations' });

    expect(processExitSpy).toHaveBeenCalledWith(1);
    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('DANGEROUS MIGRATIONS DETECTED');
    expect(output).toContain('memories_chunk_group_id_idx');
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

  describe('protected-index registry loading (fail-loud)', () => {
    // Each of these clears the beforeEach-seeded good fixture and replaces it
    // with a malformed one — the module computes PROTECTED_INDEXES at import
    // time, so a bad drift-ignore.json must make the import itself reject
    // rather than silently loading zero protected indexes.

    it('throws when drift-ignore.json is missing entirely', async () => {
      vol.reset();

      await expect(import('./check-migration-safety.js')).rejects.toThrow(
        /could not read drift-ignore\.json/
      );
    });

    it('throws when drift-ignore.json is not valid JSON', async () => {
      vol.reset();
      vol.fromJSON({ [DRIFT_IGNORE_PATH]: '{ not valid json' });

      await expect(import('./check-migration-safety.js')).rejects.toThrow(/is not valid JSON/);
    });

    it('throws when protectedIndexes is an empty array', async () => {
      vol.reset();
      vol.fromJSON({ [DRIFT_IGNORE_PATH]: JSON.stringify({ protectedIndexes: [] }) });

      await expect(import('./check-migration-safety.js')).rejects.toThrow(
        /empty or missing "protectedIndexes"/
      );
    });

    it('throws when protectedIndexes is missing from the file', async () => {
      vol.reset();
      vol.fromJSON({ [DRIFT_IGNORE_PATH]: JSON.stringify({ ignorePatterns: [] }) });

      await expect(import('./check-migration-safety.js')).rejects.toThrow(
        /empty or missing "protectedIndexes"/
      );
    });

    // Both directions: the source check is symmetric, so the tests are too —
    // an asymmetric pair here would leave one half of a symmetric guard
    // uncovered for no reason.
    it.each([['dropPattern'], ['createPattern']])(
      'throws when a protectedIndexes entry is missing %s entirely',
      async omitted => {
        const entry: Record<string, string> = {
          name: 'idx_x',
          description: 'x',
          dropPattern: 'DROP\\s+INDEX.*idx_x',
          createPattern: 'CREATE\\s+INDEX.*idx_x',
        };
        delete entry[omitted];

        vol.reset();
        vol.fromJSON({ [DRIFT_IGNORE_PATH]: JSON.stringify({ protectedIndexes: [entry] }) });

        await expect(import('./check-migration-safety.js')).rejects.toThrow(/is malformed/);
      }
    );

    it('throws a named error when the file parses to bare null', async () => {
      vol.reset();
      // Valid JSON, no properties to read — without the object guard this
      // throws a bare TypeError naming neither the file nor the problem.
      vol.fromJSON({ [DRIFT_IGNORE_PATH]: 'null' });

      await expect(import('./check-migration-safety.js')).rejects.toThrow(/is not a JSON object/);
    });

    it('throws a named error when an entry is null rather than an object', async () => {
      vol.reset();
      vol.fromJSON({
        [DRIFT_IGNORE_PATH]: JSON.stringify({ protectedIndexes: [null] }),
      });

      await expect(import('./check-migration-safety.js')).rejects.toThrow(
        /protectedIndexes\[0\].*is not an object/s
      );
    });

    it.each([
      ['dropPattern', { dropPattern: '', createPattern: 'CREATE\\s+INDEX.*idx_x' }],
      ['createPattern', { dropPattern: 'DROP\\s+INDEX.*idx_x', createPattern: '' }],
    ])('rejects an empty %s — an empty pattern matches every file', async (_label, patterns) => {
      vol.reset();
      vol.fromJSON({
        [DRIFT_IGNORE_PATH]: JSON.stringify({
          protectedIndexes: [{ name: 'idx_x', description: 'x', ...patterns }],
        }),
      });

      await expect(import('./check-migration-safety.js')).rejects.toThrow(
        /idx_x.*empty dropPattern or createPattern/s
      );
    });

    it.each([['name'], ['description']])(
      'rejects an empty %s — both are interpolated into the violation message',
      async field => {
        vol.reset();
        vol.fromJSON({
          [DRIFT_IGNORE_PATH]: JSON.stringify({
            protectedIndexes: [
              {
                name: 'idx_x',
                description: 'x',
                dropPattern: 'DROP\\s+INDEX.*idx_x',
                createPattern: 'CREATE\\s+INDEX.*idx_x',
                [field]: '',
              },
            ],
          }),
        });

        await expect(import('./check-migration-safety.js')).rejects.toThrow(
          /empty name or description/
        );
      }
    );

    it('names the offending entry when a pattern is not a valid regex', async () => {
      vol.reset();
      vol.fromJSON({
        [DRIFT_IGNORE_PATH]: JSON.stringify({
          protectedIndexes: [
            {
              name: 'idx_unclosed_group',
              description: 'x',
              // Well-typed string, uncompilable pattern — the type checks above
              // pass, so only the compile guard catches this.
              dropPattern: 'DROP\\s+INDEX.*(idx_x',
              createPattern: 'CREATE\\s+INDEX.*idx_x',
            },
          ],
        }),
      });

      await expect(import('./check-migration-safety.js')).rejects.toThrow(
        /idx_unclosed_group.*not a valid regular expression/s
      );
    });
  });
});
