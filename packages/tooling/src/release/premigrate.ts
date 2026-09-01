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
 *
 * A migration whose SQL reads additive but whose EFFECT breaks the old code
 * (a pure-DML reshape of data the old code reads) can't be detected by shape.
 * Its author declares it with an `-- tzurot:apply-after-deploy` comment line,
 * and this command refuses it, pointing at the merge-then-migrate order.
 *
 * The migration-file scanning itself (destructive shapes, the apply-after-
 * deploy marker) lives in `migration-scan.ts`, extracted purely to keep this
 * file under the `max-lines` cap — this file owns the gates and the actual
 * `prisma migrate deploy` orchestration.
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { type Environment, validateEnvironment, runPrismaCommand } from '../utils/env-runner.js';
import { runMigration } from '../db/run-migration.js';
import { isDbUnreachable } from '../db/migration-status.js';
import { RELEASE_GIT_TIMEOUT_MS } from './constants.js';
import {
  APPLY_AFTER_DEPLOY_MARKER,
  hasApplyAfterDeployMarker,
  scanDestructive,
  scanMarked,
} from './migration-scan.js';

export { APPLY_AFTER_DEPLOY_MARKER, hasApplyAfterDeployMarker };

export interface PremigrateOptions {
  env?: Environment;
  dryRun?: boolean;
  force?: boolean;
  allowDestructive?: boolean;
  allowMarked?: boolean;
  allowDevPending?: boolean;
}

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
  return execFileSync('git', args, { encoding: 'utf-8', timeout: RELEASE_GIT_TIMEOUT_MS }).trim();
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

/**
 * Report apply-after-deploy-marked migrations and decide whether to proceed.
 * Returns true to continue, false to stop (the caller exits). Mirrors
 * `gateDestructive`'s override/dry-run contract: `--allow-marked` proceeds with
 * a warning, and dry-run reports without ever exiting non-zero.
 */
function gateMarked(
  hits: { marked: string[]; unmarked: string[] },
  opts: { dryRun: boolean; allowMarked: boolean }
): boolean {
  if (hits.marked.length === 0) return true;

  console.log(chalk.red.bold('\n⚠️  Migration(s) marked apply-after-deploy:'));
  for (const file of hits.marked) console.log(chalk.red(`  ${file}`));
  console.log(
    chalk.yellow(
      `\nThe ${APPLY_AFTER_DEPLOY_MARKER} marker declares that this migration reshapes data ` +
        'the still-live OLD code reads, so applying it before the merge breaks prod for the ' +
        'deploy window. Correct order: merge the release PR, let auto-deploy land the new ' +
        'code, THEN apply it with `pnpm ops db:migrate --env prod`.'
    )
  );

  if (hits.unmarked.length > 0) {
    console.log(
      chalk.yellow('\nThis release ALSO adds unmarked migrations, which do want premigrating:')
    );
    for (const file of hits.unmarked) console.log(chalk.yellow(`  ${file}`));
    console.log(
      chalk.yellow(
        '`prisma migrate deploy` is all-or-nothing — it cannot apply a subset — so this one is ' +
          'yours to resolve: either re-run with --allow-marked to premigrate everything ' +
          '(accepting that the marked migration lands early), or split the release so the ' +
          'marked migration ships on its own.'
      )
    );
  }

  if (opts.allowMarked) {
    console.warn(
      chalk.yellow(
        '\n--allow-marked set — proceeding (the marked migration will land BEFORE the new code).'
      )
    );
    return true;
  }

  if (opts.dryRun) {
    console.log(chalk.dim('\n[dry-run] would refuse without --allow-marked'));
    return true;
  }

  console.error(
    chalk.red('\n❌ Refusing to premigrate an apply-after-deploy migration without --allow-marked.')
  );
  return false;
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
 * Handle the case where dev's migration status could not be OBSERVED at all,
 * as opposed to dev being observably behind. Returns true to continue, false
 * to stop (the caller exits).
 *
 * `detail` is whatever text names the reason — Prisma's stderr when
 * `migrate status` ran and exited non-zero, or the thrown error's message
 * when the call never got that far (a missing dev Railway link makes the
 * DATABASE_URL fetch throw before Prisma is ever spawned).
 *
 * Deliberately NOT overridable by `--allow-dev-pending`: that flag asserts
 * "I know dev is behind and I accept it," which is a claim the operator can
 * only make after seeing dev's status. Here nobody has seen it, so the gate
 * fails closed — the whole point of the check is that an unverified dev is
 * how the `column ... does not exist` window opens. Dry-run still reports
 * without exiting, matching every other gate in this file.
 */
function gateDevUnreachable(detail: string, dryRun: boolean): boolean {
  // Bounded to the tail because a Prisma stderr banner buries the actual
  // reason (host, port, auth) under its preamble. A thrown error's message is
  // typically well under the window, so the slice is a no-op for that shape.
  const tail = detail.trim().split('\n').slice(-5).join('\n');

  console.log(chalk.red.bold("\n⚠️  Could not verify dev's migration status:"));
  console.log(chalk.dim(tail));
  console.log(
    chalk.yellow(
      "\nThis is a connectivity/auth failure, not a report that dev is behind — dev's actual " +
        'state is unknown. Check the dev Railway link (`railway status`, `railway link`, ' +
        '`railway login`), then re-run. Verify dev directly with ' +
        '`pnpm ops db:status --env dev`.'
    )
  );
  console.log(
    chalk.yellow(
      '--allow-dev-pending does NOT cover this: it means "I know dev is behind", not "skip the ' +
        'check", and nothing here established what dev\'s state is.'
    )
  );

  if (dryRun) {
    console.log(chalk.dim("\n[dry-run] would refuse — dev's migration status is unverifiable"));
    return true;
  }

  console.error(chalk.red("\n❌ Refusing to premigrate prod without verifying dev's migrations."));
  return false;
}

/**
 * Confirm dev has actually applied this release's migrations before
 * premigrating prod. `release:premigrate` targets prod, but nothing else
 * re-checks that dev — which auto-deploys new code on every push to
 * `develop` — didn't fall a migration behind; a release could otherwise ship
 * with dev running new code against an un-migrated schema, the same failure
 * shape this whole command exists to close on prod, one environment over.
 *
 * Only meaningful for `env === 'prod'` (the caller gates the call on that);
 * checking dev against itself would be circular. Mirrors `gateMarked` /
 * `gateDestructive`'s override/dry-run contract: `--allow-dev-pending`
 * proceeds with a warning, dry-run reports without ever exiting non-zero,
 * and the default refuses. Reports both this release's migration range (so
 * the operator can see what's expected) and dev's own `migrate status`
 * output (so they can see what's actually missing).
 *
 * Asking dev fails in one of three shapes, and only two of them arrive as a
 * result to inspect. `prisma migrate status` exits non-zero for BOTH "dev is
 * behind" and "we could not reach dev at all," so those two are split on
 * `isDbUnreachable` (shared with `db:status` — see
 * `../db/migration-status.ts`). The third produces no result at all:
 * `runPrismaCommand` REJECTS when the dev Railway link is missing,
 * because resolving dev's DATABASE_URL throws before Prisma is spawned. The
 * catch below routes that rejection to the same unreachable gate, quoting the
 * fetch error — so a missing dev link refuses with the connectivity remedy
 * rather than escaping as a raw error.
 *
 * `--allow-dev-pending` covers only "dev is behind": the flag means "I know
 * dev is behind," not "skip the check," so an unverifiable dev fails closed
 * under either unreachable shape.
 *
 * Pinned by `premigrate.test.ts`: dev-clean, dev-pending (refuses),
 * dev-pending + `--allow-dev-pending` (warns and proceeds), dev-pending in
 * dry-run (reports, never exits), dev-unreachable-by-exit-code, and
 * dev-unreachable-by-rejection (both refuse, `--allow-dev-pending` overrides
 * neither, and both report without exiting in dry-run), plus non-prod-env
 * (never runs).
 */
async function gateDevPending(
  newSqlFiles: string[],
  opts: { dryRun: boolean; allowDevPending: boolean }
): Promise<boolean> {
  // `runPrismaCommand` REJECTS — rather than returning a non-zero result —
  // when it cannot even reach the point of running Prisma; a missing dev
  // Railway link makes the DATABASE_URL fetch throw. `isDbUnreachable` only
  // inspects a RETURNED result, so without this catch the raw error escapes
  // the whole command. Dev's state is equally unknown either way, so both
  // shapes route through the same fail-closed gate.
  //
  // The bound matters as much as the catch: this is a read-only status call on
  // every premigrate run, dry-run included, and a stalled connection with no
  // timeout would hang the release flow indefinitely. A timeout rejects, so it
  // lands on the same fail-closed path as an unreachable dev.
  let result;
  try {
    result = await runPrismaCommand('dev', 'migrate', ['status'], RELEASE_GIT_TIMEOUT_MS);
  } catch (error) {
    return gateDevUnreachable(error instanceof Error ? error.message : String(error), opts.dryRun);
  }

  if (result.exitCode === 0) {
    console.log(chalk.dim('✓ dev has applied every migration — no drift ahead of this release.'));
    return true;
  }

  if (isDbUnreachable(result)) {
    return gateDevUnreachable(result.stderr, opts.dryRun);
  }

  console.log(chalk.red.bold('\n⚠️  dev migration status is not clean:'));
  console.log(chalk.yellow(`\nThis release's range adds ${newSqlFiles.length} migration(s):`));
  for (const file of newSqlFiles) console.log(chalk.dim(`  ${file}`));
  console.log(chalk.yellow('\ndev reported (`prisma migrate status`):'));
  console.log(chalk.dim(result.stdout.trim()));
  console.log(
    chalk.yellow(
      '\nDev running new code against an un-migrated schema is how the ' +
        '`column ... does not exist` incident happened — the same deploy window this ' +
        'command exists to close, one environment over. Correct remedy: ' +
        '`pnpm ops db:migrate --env dev`.'
    )
  );

  if (opts.allowDevPending) {
    console.warn(chalk.yellow('\n--allow-dev-pending set — proceeding anyway.'));
    return true;
  }

  if (opts.dryRun) {
    console.log(chalk.dim('\n[dry-run] would refuse without --allow-dev-pending'));
    return true;
  }

  console.error(
    chalk.red(
      '\n❌ Refusing to premigrate prod while dev has pending migrations without --allow-dev-pending.'
    )
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
  const allowMarked = options.allowMarked ?? false;
  const allowDevPending = options.allowDevPending ?? false;

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

  // Marked BEFORE destructive: an apply-after-deploy migration is refused on
  // its own terms, so the operator reads one clear instruction instead of a
  // destructive-shape analysis of a migration that was never going to run here.
  const marked = scanMarked(repoRoot, newSqlFiles);
  const unmarked = newSqlFiles.filter(file => !marked.includes(file));
  if (!gateMarked({ marked, unmarked }, { dryRun, allowMarked })) {
    process.exit(1);
  }

  if (!gateDestructive(scanDestructive(repoRoot, newSqlFiles), { dryRun, allowDestructive })) {
    process.exit(1);
  }

  // Cross-check dev only when premigrating prod — checking dev against
  // itself would be circular, and dev has no "premigrate before merge"
  // window of its own (it auto-deploys on every push to develop).
  if (env === 'prod' && !(await gateDevPending(newSqlFiles, { dryRun, allowDevPending }))) {
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
