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

/** Upper bound for every git call here; the `fetch` is the one that can stall. */
const GIT_TIMEOUT_MS = 30_000;

/**
 * Run a git subcommand with array args (no shell interpolation — see
 * `.claude/rules/00-critical.md` § "Shell Command Safety"). Returns trimmed
 * stdout; throws on non-zero exit.
 */
function git(args: string[]): string {
  // Bounded because one of these calls is `fetch origin`, which touches the
  // network. A STALLED connection (not a clean failure) would otherwise hang
  // premigrate indefinitely — and this runs in the pre-merge migration path,
  // where an operator waiting on a silent hang is worse than a clear error.
  return execFileSync('git', args, { encoding: 'utf-8', timeout: GIT_TIMEOUT_MS }).trim();
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
 * Strip SQL comments before statement splitting + shape matching, so a `--`
 * or `/* *\/` comment that merely MENTIONS a destructive keyword (a migration
 * header explaining why it looks destructive, for instance) doesn't trip the
 * scan. String-literal aware for single-quoted strings: a `--` or `/*` inside
 * `'...'` is data and survives untouched, and the standard SQL `''`
 * escape-for-embedded-quote is handled for free — toggling the in-string flag
 * on every `'` means the two quotes of an escape flip it twice in a row with
 * no character between them for a comment marker to land on, so the net
 * effect is the same as never leaving the string.
 *
 * Also recognizes dollar-quoted strings (`$$...$$` / `$tag$...$tag$`, used
 * for several existing PL/pgSQL trigger-function and `DO` bodies in this
 * repo's migrations — at least one contains a `'` inside, e.g. a
 * `RAISE EXCEPTION` message literal). The whole quoted span, opener through
 * matching closer, is copied through verbatim: it's PL/pgSQL source, not SQL
 * to be comment-stripped by this pass, and a `'` or `--` inside is data, not
 * a string boundary or comment marker. A DIFFERENT tag nested inside (e.g.
 * `$inner$` inside `$outer$...$outer$`) is just content — only the matching
 * closer for the OPENING tag ends the span. An unterminated dollar-quote (no
 * matching closer before end of input) runs to end of input, same handling
 * as an unterminated block comment.
 *
 * Without this, an odd (unbalanced) `'` count inside a dollar-quoted body
 * leaves the single-quote tracker stuck "inside a string" for the rest of the
 * file, which does NOT delete any code — every character is still copied
 * through — but it DOES stop later `--`/`/* *\/` comments from being
 * recognized and stripped. A leftover, unstripped comment mentioning
 * `CREATE TABLE <name>` can then satisfy `scanSqlForDestructive`'s
 * created-earlier-in-file exemption for a table name that was never actually
 * created, silently exempting a REAL later `DROP`/`RENAME`/etc. on that same
 * table — the concrete fail-open path, not a merely theoretical one.
 *
 * Comments are stripped before the `;` split further down, so a `;` that
 * only appeared inside a comment (previously able to fracture a statement in
 * two) is also fixed by this same pass — not handled separately.
 */
function stripSqlComments(sql: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (inString) {
      result += ch;
      if (ch === "'") inString = false;
      i++;
      continue;
    }
    const step = stepOutsideString(sql, i);
    result += step.append;
    i = step.next;
    if (step.opensString) inString = true;
  }
  return result;
}

/** Index just past the end of a `--` line comment starting at `i` (the newline itself is left for the caller to copy through). */
function skipLineComment(sql: string, i: number): number {
  let j = i;
  while (j < sql.length && sql[j] !== '\n') j++;
  return j;
}

/** Index just past the closing delimiter of a block comment starting at `i`. */
function skipBlockComment(sql: string, i: number): number {
  let j = i + 2;
  while (j < sql.length && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
  return j + 2;
}

/** A dollar-quote opener/closer tag: `$$` or `$name$` (name starts with a letter/underscore). */
const DOLLAR_QUOTE_TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * If `sql[i]` starts a dollar-quoted string, the whole span (opener through
 * matching closer, or to end of input if unterminated) verbatim; otherwise
 * `null` so the caller treats `$` as an ordinary character.
 */
function matchDollarQuote(sql: string, i: number): string | null {
  if (sql[i] !== '$') return null;
  const openerMatch = DOLLAR_QUOTE_TAG_RE.exec(sql.slice(i));
  if (openerMatch === null) return null;
  const tag = openerMatch[0];
  const closerIndex = sql.indexOf(tag, i + tag.length);
  const end = closerIndex === -1 ? sql.length : closerIndex + tag.length;
  return sql.slice(i, end);
}

/**
 * One step outside a single-quoted string: recognizes string-open, `--`/`/*`
 * comments, and dollar-quotes, falling back to copying an ordinary
 * character. Returns the text to append and the index to resume from, plus
 * whether the appended `'` opens a string (the only case the caller's
 * `inString` flag needs to change here — closing a string is handled on the
 * inString side, in `stripSqlComments` itself).
 */
function stepOutsideString(
  sql: string,
  i: number
): { append: string; next: number; opensString: boolean } {
  const ch = sql[i];
  if (ch === "'") {
    return { append: ch, next: i + 1, opensString: true };
  }
  if (ch === '-' && sql[i + 1] === '-') {
    return { append: '', next: skipLineComment(sql, i), opensString: false };
  }
  if (ch === '/' && sql[i + 1] === '*') {
    // preserve a token boundary where the comment stood
    return { append: ' ', next: skipBlockComment(sql, i), opensString: false };
  }
  const dollarQuote = matchDollarQuote(sql, i);
  if (dollarQuote !== null) {
    return { append: dollarQuote, next: i + dollarQuote.length, opensString: false };
  }
  return { append: ch, next: i + 1, opensString: false };
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
  for (const statement of stripSqlComments(sql).split(';')) {
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
