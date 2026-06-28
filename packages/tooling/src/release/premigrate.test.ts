import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
