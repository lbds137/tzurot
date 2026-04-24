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

// Mock fs — include the new CHECK-constraint extraction surface. Each fn is
// typed to match the real signature so tests can install `mockImplementation`
// that reads the path argument without tripping TS strict-mode overload checks.
const fsMock = {
  writeFileSync: vi.fn<(path: string, content: string) => void>(),
  existsSync: vi.fn<(path: string) => boolean>(() => false),
  readdirSync: vi.fn<
    (path: string, opts?: unknown) => Array<{ name: string; isDirectory: () => boolean }>
  >(() => []),
  readFileSync: vi.fn<(path: string, encoding?: string) => string>(() => ''),
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

    // Reset fs mock defaults — `vi.clearAllMocks()` only clears call history,
    // not implementations, so CHECK-constraint tests that install their own
    // `mockImplementation` would otherwise leak into later tests.
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readdirSync.mockReturnValue([]);
    fsMock.readFileSync.mockReturnValue('');
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
      expect(path).toContain('packages/test-utils/schema');
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

  describe('CHECK-constraint preservation', () => {
    /**
     * Build a mock-fs layout for a set of migrations. Each entry becomes a
     * directory under prisma/migrations/ with the provided SQL inside.
     */
    function mockMigrations(migrations: Record<string, string>): void {
      fsMock.existsSync.mockImplementation((path: string) => {
        // migrations dir always exists in this test
        if (path.endsWith('prisma/migrations')) return true;
        // migration.sql exists only for entries in the map
        for (const name of Object.keys(migrations)) {
          if (path.endsWith(`${name}/migration.sql`)) return true;
        }
        return false;
      });
      fsMock.readdirSync.mockImplementation(() =>
        Object.keys(migrations).map(name => ({
          name,
          isDirectory: () => true,
        }))
      );
      fsMock.readFileSync.mockImplementation((path: string) => {
        for (const [name, sql] of Object.entries(migrations)) {
          if (path.endsWith(`${name}/migration.sql`)) return sql;
        }
        return '';
      });
    }

    it('extracts a single-line ADD CONSTRAINT CHECK statement', async () => {
      mockMigrations({
        '20251127110000_add_checks':
          'ALTER TABLE "users" ADD CONSTRAINT "valid_month" CHECK ("m" >= 1 AND "m" <= 12);',
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(content).toContain(
        'ALTER TABLE "users" ADD CONSTRAINT "valid_month" CHECK ("m" >= 1 AND "m" <= 12);'
      );
    });

    it('extracts multi-line ADD CONSTRAINT CHECK statements, normalizing whitespace', async () => {
      mockMigrations({
        '20260416164756_phase_5': `
          ALTER TABLE "personas"
            ADD CONSTRAINT "personas_name_non_empty" CHECK (LENGTH(TRIM("name")) > 0);

          ALTER TABLE "personas"
            ADD CONSTRAINT "personas_name_not_snowflake" CHECK ("name" !~ '^\\d{17,19}$');
        `,
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(content).toContain(
        'ALTER TABLE "personas" ADD CONSTRAINT "personas_name_non_empty" CHECK (LENGTH(TRIM("name")) > 0);'
      );
      expect(content).toContain(
        `ALTER TABLE "personas" ADD CONSTRAINT "personas_name_not_snowflake" CHECK ("name" !~ '^\\d{17,19}$');`
      );
    });

    it('preserves CHECK expressions with nested parentheses', async () => {
      // Parens inside the CHECK expression would confuse any regex that tries
      // to balance them; the split-on-; approach handles this cleanly.
      mockMigrations({
        '20251127110000_nested':
          'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK ("x" IS NULL OR ("x" >= 1 AND "x" <= 12));',
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(content).toContain(
        'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK ("x" IS NULL OR ("x" >= 1 AND "x" <= 12));'
      );
    });

    it('ignores non-CHECK constraints (foreign keys, unique)', async () => {
      // A foreign-key add-constraint is NOT a CHECK. The extractor must leave
      // those to Prisma's own generator — otherwise we'd double-add FKs.
      mockMigrations({
        '20251127110000_mixed': `
          ALTER TABLE "a" ADD CONSTRAINT "a_b_fkey" FOREIGN KEY ("b") REFERENCES "b"("id");
          ALTER TABLE "c" ADD CONSTRAINT "c_unique" UNIQUE ("name");
          ALTER TABLE "d" ADD CONSTRAINT "d_check" CHECK ("n" > 0);
        `,
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(content).toContain('ALTER TABLE "d" ADD CONSTRAINT "d_check" CHECK ("n" > 0);');
      expect(content).not.toContain('a_b_fkey');
      expect(content).not.toContain('c_unique');
    });

    it('strips -- single-line comments before splitting on ;', async () => {
      // If comments were preserved, splitting on `;` would leave comment text
      // attached to the next statement and the CHECK-detection regex would
      // fail to anchor on ALTER TABLE.
      mockMigrations({
        '20251127110000_commented': `
          -- This comment mentions ADD CONSTRAINT CHECK and contains fake SQL;
          ALTER TABLE "real" ADD CONSTRAINT "real_check" CHECK ("n" > 0);
        `,
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(content).toContain('ALTER TABLE "real" ADD CONSTRAINT "real_check" CHECK ("n" > 0);');
    });

    // Block comments matter because `/* foo; bar */` contains a raw `;` that
    // would split the surrounding statement in half. Without the block-comment
    // strip, the CHECK after a block-commented prologue would be silently
    // dropped — the exact failure mode this PR was built to prevent.
    it('strips /* */ block comments before splitting on ;', async () => {
      mockMigrations({
        '20251127110000_block_commented': `
          /* Drops the old check;
             a new one follows. */
          ALTER TABLE "t" ADD CONSTRAINT "c" CHECK ("n" > 0);
        `,
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(content).toContain('ALTER TABLE "t" ADD CONSTRAINT "c" CHECK ("n" > 0);');
    });

    // Realistic "same name appears twice" shape: migration B drops the
    // constraint, then re-adds it with a different expression. Without the
    // dedup, both ADDs would land in the output and PGLite would reject the
    // second. With dedup, the **last** migration's version must win — that's
    // what prod Postgres enforces after applying both migrations.
    //
    // Two ADDs with no intervening DROP would fail `prisma migrate deploy`
    // in real Postgres ("constraint already exists"), so we don't test that
    // shape — it can't appear in a valid migration history.
    it('keeps the last migration definition when a CHECK is dropped and re-added', async () => {
      mockMigrations({
        '20251127110000_first': 'ALTER TABLE "t" ADD CONSTRAINT "c1" CHECK ("n" > 0);',
        '20260501000000_second': `
          ALTER TABLE "t" DROP CONSTRAINT "c1";
          ALTER TABLE "t" ADD CONSTRAINT "c1" CHECK ("n" > 100);
        `,
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      // Only one definition of c1 in the output.
      const matches = content.match(/ADD CONSTRAINT "c1"/g) ?? [];
      expect(matches).toHaveLength(1);
      // The winning definition is the later one (n > 100), matching the
      // state prod Postgres is in after applying both migrations.
      expect(content).toContain('ALTER TABLE "t" ADD CONSTRAINT "c1" CHECK ("n" > 100);');
      expect(content).not.toContain('CHECK ("n" > 0)');
    });

    it('processes migration folders in chronological order', async () => {
      // Later migrations may override/refine earlier ones. Deterministic
      // ordering (by folder name, which carries the YYYYMMDDHHMMSS prefix)
      // means the output is reproducible across machines and over time.
      mockMigrations({
        '20260501000000_later': 'ALTER TABLE "t" ADD CONSTRAINT "second" CHECK ("n" > 100);',
        '20251127110000_earlier': 'ALTER TABLE "t" ADD CONSTRAINT "first" CHECK ("n" > 0);',
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      const firstPos = content.indexOf('"first"');
      const secondPos = content.indexOf('"second"');
      expect(firstPos).toBeGreaterThan(-1);
      expect(secondPos).toBeGreaterThan(firstPos);
    });

    it('reports the CHECK count in the success message', async () => {
      mockMigrations({
        '20251127110000_two': `
          ALTER TABLE "t" ADD CONSTRAINT "a" CHECK ("x" > 0);
          ALTER TABLE "t" ADD CONSTRAINT "b" CHECK ("y" > 0);
        `,
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('2 CHECK constraints preserved');
    });

    it('does not add the CHECK-constraint banner when no CHECKs exist', async () => {
      mockMigrations({
        '20251127110000_none':
          'ALTER TABLE "t" ADD CONSTRAINT "fk" FOREIGN KEY ("b") REFERENCES "b"("id");',
      });

      const { generateSchema } = await import('./generate-schema.js');
      await generateSchema();

      const [, content] = fsMock.writeFileSync.mock.calls[0] as [string, string];
      expect(content).not.toContain('CHECK constraints harvested from');
    });

    it('handles missing migrations directory gracefully', async () => {
      // Fresh clones / CI cache-miss scenarios may not have migrations yet.
      // The extractor should noop rather than throw.
      fsMock.existsSync.mockReturnValue(false);

      const { generateSchema } = await import('./generate-schema.js');
      await expect(generateSchema()).resolves.not.toThrow();
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
