import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

// chalk → identity strings so assertions match plain text
vi.mock('chalk', () => {
  const id = (s: string): string => s;
  const chalk = {
    cyan: id,
    dim: id,
    yellow: id,
    green: id,
    red: Object.assign(id, { bold: id }),
  };
  return { default: chalk };
});

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('../utils/env-runner.js', () => ({ validateEnvironment: vi.fn() }));
vi.mock('../db/run-migration.js', () => ({ runMigration: vi.fn() }));

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runMigration } from '../db/run-migration.js';
import { premigrate } from './premigrate.js';

const ADDITIVE_MIGRATION = 'prisma/migrations/20260627_add_kind/migration.sql';
const DESTRUCTIVE_MIGRATION = 'prisma/migrations/20260628_drop_old/migration.sql';

// The real specimen that motivated the comment-stripping fix: a pure-DML
// migration whose header comments explain the destructive-shape detector
// itself (and therefore mention DROP/RENAME COLUMN by name).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(__dirname, '../../../..');
const COLLAPSE_MIGRATION_REL =
  'prisma/migrations/20260814120000_collapse_reasoning_to_thinking/migration.sql';
const COLLAPSE_MIGRATION_ABS = pathResolve(REPO_ROOT, COLLAPSE_MIGRATION_REL);

/**
 * Wire the git() mock: `diff` returns the supplied file list, everything else
 * (fetch / rev-parse) returns a benign value.
 */
function mockGitDiff(files: string[]): void {
  vi.mocked(execFileSync).mockImplementation(((_cmd: string, args: string[]) => {
    if (args[0] === 'rev-parse') return '/repo\n';
    if (args[0] === 'diff') return `${files.join('\n')}\n`;
    return ''; // fetch, etc.
  }) as unknown as typeof execFileSync);
}

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // process.exit throws so control flow stops like the real thing
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code}`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('premigrate', () => {
  it('bounds every git call with a timeout — the fetch touches the network', async () => {
    // Same motivation as countRangeChangedFiles in github-prs.ts: a STALLED
    // connection (not a clean failure) would hang premigrate indefinitely,
    // and this one runs in the pre-merge migration path where a silent hang
    // is worse. Asserted rather than assumed, so removing the bound reds
    // here instead of surfacing as a wedged release.
    mockGitDiff([]);

    await premigrate({ env: 'prod' });

    const gitCalls = vi.mocked(execFileSync).mock.calls.filter(call => call[0] === 'git');
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const call of gitCalls) {
      expect(call[2]).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
    }
  });

  it('does nothing and does not migrate when the release range adds no migrations', async () => {
    mockGitDiff([]);

    await premigrate({ env: 'prod' });

    expect(runMigration).not.toHaveBeenCalled();
  });

  it('migrates when the release range adds an additive migration', async () => {
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue('ALTER TABLE "llm_configs" ADD COLUMN "kind" TEXT;');

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('refuses a destructive migration without --allow-destructive (exit 1, no migrate)', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue('ALTER TABLE "llm_configs" DROP COLUMN "legacy";');

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('proceeds on a destructive migration when --allow-destructive is set', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue('ALTER TABLE "x" RENAME COLUMN "a" TO "b";');

    await premigrate({ env: 'prod', force: true, allowDestructive: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('exempts destructive statements on tables CREATEd earlier in the same file', async () => {
    // The vector-column false-positive class: CREATE TABLE + ALTER COLUMN TYPE
    // on the brand-new table in one migration cannot break live code.
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'CREATE TABLE "memory_facts" ("id" UUID NOT NULL, "embedding" vector);\n' +
        'ALTER TABLE "memory_facts" ALTER COLUMN "embedding" SET DATA TYPE vector(384);\n' +
        'ALTER TABLE "public"."memory_facts" DROP COLUMN "scratch";'
    );

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('still refuses DROP-then-reCREATE of the same table (order-aware exemption)', async () => {
    // Recreating a table destroys prod data; the CREATE after the DROP must
    // not retroactively bless it.
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DROP TABLE "memories";\nCREATE TABLE "memories" ("id" UUID NOT NULL);'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('still refuses a comma-list DROP TABLE that includes a pre-existing table', async () => {
    // `DROP TABLE new, existing;` — exempting on the first-listed (created)
    // table alone would silently bless dropping the live one.
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'CREATE TABLE "scratch_cache" ("id" UUID NOT NULL);\n' +
        'DROP TABLE "scratch_cache", "user_settings";'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('exempts a comma-list DROP TABLE when every listed table was created in the file', async () => {
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'CREATE TABLE "tmp_a" ("id" UUID NOT NULL);\n' +
        'CREATE TABLE "tmp_b" ("id" UUID NOT NULL);\n' +
        'DROP TABLE "tmp_a", "tmp_b";'
    );

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('still refuses ALTER COLUMN TYPE on a table not created in the file', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'CREATE TABLE "other" ("id" UUID NOT NULL);\n' +
        'ALTER TABLE "memories" ALTER COLUMN "content" SET DATA TYPE JSONB;'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('refuses when a release mixes additive and destructive migrations', async () => {
    mockGitDiff([ADDITIVE_MIGRATION, DESTRUCTIVE_MIGRATION]);
    // additive file → no destructive markers; destructive file → DROP COLUMN
    vi.mocked(readFileSync).mockImplementation(((path: string) =>
      path.includes('drop_old')
        ? 'ALTER TABLE "x" DROP COLUMN "legacy";'
        : 'ALTER TABLE "x" ADD COLUMN "kind" TEXT;') as unknown as typeof readFileSync);

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('threads dry-run into runMigration and does not exit on destructive in dry-run', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue('DROP TABLE "old_thing";');

    await premigrate({ env: 'prod', dryRun: true });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: false, dryRun: true });
  });

  it('defaults env to prod', async () => {
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue('CREATE TABLE "new_thing" (id uuid);');

    await premigrate({ force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('classifies the real collapse-reasoning-to-thinking migration (pure DML, header mentions destructive keywords) as non-destructive', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    let sql: string;
    try {
      sql = actualFs.readFileSync(COLLAPSE_MIGRATION_ABS, 'utf-8');
    } catch (err) {
      throw new Error(
        `Could not read the specimen migration at ${COLLAPSE_MIGRATION_ABS} — did it move or ` +
          `get deleted?`,
        { cause: err }
      );
    }
    mockGitDiff([COLLAPSE_MIGRATION_REL]);
    vi.mocked(readFileSync).mockReturnValue(sql);

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('still refuses a real ALTER TABLE ... RENAME COLUMN statement sitting beside explanatory comments', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      '-- this migration does NOT rename any column, honest\n' +
        'ALTER TABLE "x" RENAME COLUMN "a" TO "b";'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('does not let a `--` inside a single-quoted literal swallow the rest of the line', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(`UPDATE t SET c = 'a--b'; DROP TABLE live_t;`);

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('does not flag a destructive keyword mentioned only inside a block comment', async () => {
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      '/* historical note: an earlier draft used DROP TABLE old_thing here */\n' +
        'ALTER TABLE "x" ADD COLUMN "y" TEXT;'
    );

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('a dollar-quoted body with an odd (unbalanced) quote does not let a leaked-comment keyword mention flag the migration', async () => {
    // The dollar-quote fix's regression target: without it, the lone `'` in
    // `RAISE NOTICE 'unterminated` desyncs the single-quote tracker for the
    // rest of the file, so the trailing `--` comment below is never
    // recognized as a comment and its "DROP TABLE" text leaks into the
    // scanned statement — even though there's no real destructive statement
    // anywhere in this migration.
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DO $$\n' +
        'BEGIN\n' +
        "  RAISE NOTICE 'unterminated;\n" +
        'END $$;\n' +
        '-- an earlier draft of this migration used DROP TABLE old_stuff instead of this approach\n' +
        'ALTER TABLE "llm_configs" ADD COLUMN "kind" TEXT;'
    );

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('still refuses a real destructive statement after a dollar-quoted body with an odd quote (fail-open pinned closed)', async () => {
    // Same odd-quote desync as above, but the leaked comment mentions
    // `CREATE TABLE live_t` instead — which, pre-fix, wrongly registers
    // `live_t` in the created-earlier-in-file exemption set and exempts the
    // REAL `DROP TABLE live_t;` statement that follows. This is the concrete
    // fail-open path: a real destructive statement silently exempted.
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DO $$\n' +
        'BEGIN\n' +
        "  RAISE NOTICE 'unterminated;\n" +
        'END $$;\n' +
        '-- illustrative: an earlier draft used CREATE TABLE live_t (id int) and it was fine;\n' +
        'DROP TABLE live_t;'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('a tagged dollar-quote ($fn$...$fn$) closes the same way as $$...$$', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DO $fn$\n' +
        'BEGIN\n' +
        "  RAISE NOTICE 'unterminated;\n" +
        'END $fn$;\n' +
        '-- illustrative: an earlier draft used CREATE TABLE live_t (id int) and it was fine;\n' +
        'DROP TABLE live_t;'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('still refuses when the destructive keyword sits beside a double-quoted identifier containing --', async () => {
    // Without double-quote tracking, the `--` inside "foo--bar" is read as a
    // line comment starting a `--`, stripping "bar\" DROP COLUMN \"x\";"
    // entirely — deleting real DDL from the scan (fail-open).
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue('ALTER TABLE "foo--bar" DROP COLUMN "x";');

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('still refuses a real destructive statement when an internal ; inside a dollar body would otherwise bypass the self-exempt guard', async () => {
    // The naive-split fail-open: `scanSqlForDestructive` withholds a CREATE's
    // createdEarlier registration until AFTER its own statement is fully
    // scanned, specifically so a single atomic create+destroy can't
    // self-exempt. Splitting this DO $$ body's internal `;` (between the two
    // EXECUTE lines) into TWO separate array entries defeats that guard: the
    // CREATE TABLE mention registers from the first fragment BEFORE the
    // second fragment's DROP TABLE mention is checked, wrongly exempting it.
    // Keeping the walker-owned split means the whole dollar-quoted DO block
    // stays one statement, so the guard holds.
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DO $$\n' +
        'BEGIN\n' +
        "  EXECUTE 'CREATE TABLE sneaky_t (id int)';\n" +
        "  EXECUTE 'DROP TABLE sneaky_t';\n" +
        'END $$;'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('still refuses when a BALANCED dollar body leaks a CREATE TABLE mention through an unstripped inner comment', async () => {
    // No unbalanced quote anywhere in this body — it's perfectly
    // quote-balanced — so this is independent of quote-parity desync. The
    // bug is that `matchDollarQuote` used to copy the whole span verbatim,
    // comments included, so this `--` comment survived into the scanned
    // statement and phantom-registered `staging_data`.
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DO $$\n' +
        'BEGIN\n' +
        '  -- old approach used CREATE TABLE staging_data\n' +
        "  RAISE NOTICE 'done';\n" +
        'END $$;\n' +
        'DROP TABLE staging_data;'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('does not flag a destructive keyword mentioned only inside a dollar body comment, with nothing destructive outside', async () => {
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DO $$\n' +
        'BEGIN\n' +
        '  -- this used to DROP TABLE old_t\n' +
        "  RAISE NOTICE 'done';\n" +
        'END $$;'
    );

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('a ; inside a single-quoted literal does not fracture the statement it lives in (self-exempt guard holds)', async () => {
    // The literal itself contains both a CREATE TABLE mention and a DROP
    // TABLE mention, separated by an internal `;` — content-scanning inside
    // a string literal is accepted design (dynamic DDL lives in literals),
    // so this is EXPECTED to flag. The pin is that it flags for the RIGHT
    // reason: the whole VALUES(...) literal stays ONE statement, so the
    // self-exempt guard (registration withheld until the statement finishes
    // scanning) sees the CREATE and DROP mentions together and does not let
    // the CREATE exempt the DROP. A `;`-before-quote ordering bug would
    // fracture the literal into two array entries, letting the CREATE
    // mention register from the first fragment before the DROP mention (in
    // the second fragment) is checked — wrongly exempting it.
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      "INSERT INTO t (a) VALUES ('CREATE TABLE sneaky_t;DROP TABLE sneaky_t');"
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('advances by the SOURCE span length when a dollar body contained a comment (no walker desync)', async () => {
    // The stripped span is SHORTER than its source whenever an inner comment
    // was removed. If the walker advances by the stripped length instead of
    // the source length, it resumes mid-span in source coordinates and
    // re-processes the span's tail — here landing on the closer's `$$`,
    // which then reads as a fresh unterminated opener that swallows the rest
    // of the file into ONE statement, breaking the created-earlier exemption
    // for the CREATE + ALTER pair below. Correct behavior: the DO body is
    // one clean statement, CREATE TABLE registers, and the ALTER COLUMN TYPE
    // on the just-created table is exempt — premigrate proceeds.
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'DO $$\nBEGIN\n-- c\nZE$$;\n' +
        'CREATE TABLE t1 (a int);\n' +
        'ALTER TABLE t1 ALTER COLUMN a TYPE bigint;'
    );

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('still refuses when a single-quoted VALUES literal merely reads like a CREATE TABLE', async () => {
    // A literal that mentions a table name in prose ("...does what a CREATE
    // TABLE staging_data would do...") must not register that name as
    // created — the INSERT creates nothing. Registering it would wrongly
    // exempt the REAL DROP TABLE staging_data; that follows.
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      "INSERT INTO changelog (msg) VALUES ('…does what a CREATE TABLE staging_data would do');\n" +
        'DROP TABLE staging_data;'
    );

    await expect(premigrate({ env: 'prod' })).rejects.toThrow('process.exit:1');
    expect(runMigration).not.toHaveBeenCalled();
  });

  it('proceeds on a real double-quoted-identifier CREATE + ALTER pair (masking preserves identifiers)', async () => {
    // The regression guard for the load-bearing exception: masking must NOT
    // blank double-quoted content, or every real Prisma migration (which
    // emits `CREATE TABLE "name"`) would lose its created-earlier exemption
    // and force --allow-destructive on ordinary additive migrations.
    mockGitDiff([ADDITIVE_MIGRATION]);
    vi.mocked(readFileSync).mockReturnValue(
      'CREATE TABLE "q_t" (a int);\n' + 'ALTER TABLE "q_t" ALTER COLUMN a TYPE bigint;'
    );

    await premigrate({ env: 'prod', force: true });

    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });

  it('warns and skips an unreadable migration file in the destructive scan', async () => {
    mockGitDiff([DESTRUCTIVE_MIGRATION]);
    vi.mocked(readFileSync).mockImplementation((() => {
      throw new Error('EACCES');
    }) as unknown as typeof readFileSync);

    await premigrate({ env: 'prod', force: true });

    // Unreadable → skipped in the scan → no destructive hit → migration proceeds.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not read'));
    expect(runMigration).toHaveBeenCalledWith({ env: 'prod', force: true, dryRun: false });
  });
});
