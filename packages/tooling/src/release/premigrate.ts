/**
 * release:premigrate — apply prod migrations BEFORE the release merge.
 *
 * Closes the breaking-migration deploy window: Railway auto-deploys all services
 * in parallel on the release merge, but migrations were applied manually AFTER
 * it, so new code briefly ran against the old schema (`column ... does not exist`
 * → user-visible errors).
 *
 * Running migrations BEFORE the merge — while prod still runs the old code —
 * makes the schema ready before any new code goes live, closing the window for
 * every service at once. This is safe for ADDITIVE migrations (old code ignores
 * a new column/table/constraint). DESTRUCTIVE migrations (drop/rename a column,
 * tighten a constraint on existing data) INVERT the window: applying them breaks
 * the still-live old code immediately, so they need a brief maintenance window.
 * This command detects the likely-destructive shapes and refuses without
 * --allow-destructive.
 *
 * Where this fits the flow: run it as the step right before merging the release
 * PR. See `.claude/skills/tzurot-git-workflow/SKILL.md` (release procedure) and
 * `.claude/rules/03-database.md` (Deployment).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { type Environment, validateEnvironment } from '../utils/env-runner.js';
import { runMigration } from '../db/run-migration.js';

export interface PremigrateOptions {
  env?: Environment;
  dryRun?: boolean;
  force?: boolean;
  allowDestructive?: boolean;
}

/**
 * Heuristic markers for migration SQL that breaks the still-live old code when
 * applied before the merge. Fallible by design — this gates and warns; the
 * human makes the final call (a complex CHECK-constraint tighten or a data
 * rewrite the patterns don't match still needs operator judgment).
 */
const DESTRUCTIVE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  { label: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { label: 'RENAME COLUMN', re: /\bRENAME\s+COLUMN\b/i },
  { label: 'RENAME TO', re: /\bRENAME\s+TO\b/i },
  // May false-positive on a new-column backfill-then-constrain (the new column
  // is additive-in-spirit, so old code never writes a null) — operator overrides
  // with --allow-destructive.
  { label: 'SET NOT NULL', re: /\bSET\s+NOT\s+NULL\b/i },
  { label: 'DROP CONSTRAINT', re: /\bDROP\s+CONSTRAINT\b/i },
  // A type change can break old writes (e.g. TEXT→INTEGER); a widening
  // (INT→BIGINT) is benign but flags anyway — over-warning is the safe
  // direction. `[^;]` bounds the match to a single statement (no greedy span).
  { label: 'ALTER COLUMN TYPE', re: /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i },
];

/**
 * Run a git subcommand with array args (no shell interpolation — see
 * `.claude/rules/00-critical.md` § "Shell Command Safety"). Returns trimmed
 * stdout; throws on non-zero exit.
 */
function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

/**
 * The migration `.sql` files added in this release range (changes on develop
 * since its merge-base with main). Three-dot diff so commits that landed on
 * main after the merge-base don't count as "new in this release."
 */
function newMigrationSqlFiles(): string[] {
  const out = git([
    'diff',
    '--name-only',
    '--diff-filter=A', // only files ADDED in this release (migrations are immutable once created)
    'origin/main...origin/develop',
    '--',
    'prisma/migrations/',
  ]);
  return out
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.endsWith('.sql'));
}

/** A possibly-quoted, possibly-schema-qualified table reference in DDL. */
const TABLE_REF = String.raw`(?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))?`;

const CREATE_TABLE_RE = new RegExp(
  String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${TABLE_REF})`,
  'i'
);

// Captures the FULL comma-separated table list: `DROP TABLE a, b;` is one
// statement targeting several tables (ALTER TABLE only ever targets one).
const TARGET_TABLES_RE = new RegExp(
  String.raw`\b(?:ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${TABLE_REF}(?:\s*,\s*${TABLE_REF})*)`,
  'i'
);

/** Strip quotes + schema qualifier so `"public"."memory_facts"` ≡ `memory_facts`. */
function normalizeTableRef(ref: string): string {
  const parts = ref.split('.').map(p => p.replace(/"/g, '').toLowerCase());
  return parts[parts.length - 1];
}

/**
 * Every table the statement targets, or null when none is identifiable
 * (no-target → the caller keeps the hit; over-warning is the safe direction).
 */
function statementTargetTables(statement: string): string[] | null {
  const match = TARGET_TABLES_RE.exec(statement);
  if (match === null) {
    return null;
  }
  return match[1].split(',').map(ref => normalizeTableRef(ref.trim()));
}

/**
 * Scan one migration file's SQL statement-by-statement for destructive shapes.
 *
 * A destructive statement targeting a table CREATEd **earlier in the same
 * file** is exempt: prod doesn't have that table until this migration runs,
 * so nothing live can break (e.g. CREATE TABLE + ALTER COLUMN TYPE on the new
 * table in one file — a false positive that previously forced
 * --allow-destructive). Order matters deliberately: DROP-then-reCREATE of the
 * same name destroys prod data, and stays flagged because the CREATE comes
 * after the DROP.
 */
function scanSqlForDestructive(sql: string): string[] {
  const labels: string[] = [];
  const createdEarlier = new Set<string>();
  for (const statement of sql.split(';')) {
    const created = CREATE_TABLE_RE.exec(statement);
    for (const { label, re } of DESTRUCTIVE_PATTERNS) {
      if (!re.test(statement)) continue;
      // Exempt ONLY when every targeted table was created earlier in this
      // file — `DROP TABLE new_one, live_one;` must keep its hit for the
      // table that exists in prod.
      const targets = statementTargetTables(statement);
      if (targets?.every(t => createdEarlier.has(t)) === true) continue;
      if (!labels.includes(label)) labels.push(label);
    }
    // Register AFTER scanning the statement itself, so a hypothetical
    // single-statement create+destroy can't self-exempt.
    if (created !== null) createdEarlier.add(normalizeTableRef(created[1]));
  }
  return labels;
}

/** Scan the given migration files for destructive SQL shapes. */
function scanDestructive(repoRoot: string, files: string[]): { file: string; label: string }[] {
  const hits: { file: string; label: string }[] = [];
  for (const file of files) {
    let sql: string;
    try {
      sql = readFileSync(resolve(repoRoot, file), 'utf-8');
    } catch {
      // Listed by git-diff but not readable from the working tree (e.g. a path
      // that changed in a later commit) — skip rather than fail the scan, but
      // warn so an unexpected read failure (permissions, corrupt tree) doesn't
      // silently downgrade a destructive migration to "safe".
      console.warn(
        chalk.yellow(`  ⚠️  could not read ${file} for the destructive scan — skipping`)
      );
      continue;
    }
    for (const label of scanSqlForDestructive(sql)) {
      hits.push({ file, label });
    }
  }
  return hits;
}

/**
 * Report destructive hits and decide whether to proceed. Returns true to
 * continue, false to stop (the caller exits). In dry-run we report but never
 * exit non-zero — it's a preview.
 */
function gateDestructive(
  hits: { file: string; label: string }[],
  opts: { dryRun: boolean; allowDestructive: boolean }
): boolean {
  if (hits.length === 0) return true;

  console.log(chalk.red.bold('\n⚠️  DESTRUCTIVE migration shapes detected:'));
  for (const hit of hits) console.log(chalk.red(`  ${hit.file}: ${hit.label}`));
  console.log(
    chalk.yellow(
      '\nApplying these BEFORE the merge will break the still-live old code — it runs against ' +
        'the changed schema until the new code deploys.'
    )
  );
  console.log(
    chalk.yellow(
      'Use a maintenance window instead: pause the user-facing services, re-run with ' +
        '--allow-destructive, merge, let auto-deploy land, then resume. See ' +
        'docs/reference/deployment/RAILWAY_OPERATIONS.md.'
    )
  );

  if (opts.allowDestructive) {
    console.warn(
      chalk.yellow(
        '\n--allow-destructive set — proceeding (ensure a maintenance window is in place).'
      )
    );
    return true;
  }

  if (opts.dryRun) {
    console.log(chalk.dim('\n[dry-run] would refuse without --allow-destructive'));
    return true;
  }

  console.error(
    chalk.red('\n❌ Refusing to premigrate destructive changes without --allow-destructive.')
  );
  return false;
}

/**
 * Apply the release's pending migrations to the target environment before the
 * merge, so auto-deploy lands into a ready schema.
 */
export async function premigrate(options: PremigrateOptions = {}): Promise<void> {
  const env = options.env ?? 'prod';
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const allowDestructive = options.allowDestructive ?? false;

  validateEnvironment(env);

  console.log(chalk.cyan(dryRun ? '[dry-run] Pre-merge migration check' : 'Pre-merge migration'));

  // Read-only: refresh origin refs so the release-range diff is accurate (a
  // stale origin/develop would miss migrations the release actually adds).
  console.log(chalk.dim('Fetching remote refs...'));
  git(['fetch', 'origin']);

  const newSqlFiles = newMigrationSqlFiles();
  if (newSqlFiles.length === 0) {
    console.log(
      chalk.green(
        '✓ No new migrations in origin/main...origin/develop — nothing to premigrate. Safe to merge.'
      )
    );
    return;
  }

  console.log(chalk.yellow(`\n${newSqlFiles.length} new migration file(s) in this release range:`));
  for (const file of newSqlFiles) console.log(chalk.dim(`  ${file}`));

  const repoRoot = git(['rev-parse', '--show-toplevel']);
  if (!gateDestructive(scanDestructive(repoRoot, newSqlFiles), { dryRun, allowDestructive })) {
    process.exit(1);
  }

  // runMigration owns the prod confirmation banner, `prisma migrate deploy`, and
  // the Railway-backup rollback guidance; dry-run flows to its read-only
  // `migrate status` path.
  await runMigration({ env, force, dryRun });

  if (!dryRun) {
    console.log(
      chalk.green(
        '\n✅ Prod schema migrated. NOW merge the release PR — auto-deploy lands into the ready schema.'
      )
    );
  }
}
