/**
 * Session Context
 *
 * Provides quick codebase state summary for AI session startup.
 * Gathers git state, pending work, migrations, and task status.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { isTimeoutKill } from '../utils/timeoutKill.js';

/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-duplicate-string -- CLI orchestrator: git state collection → migration status → service health with decorative output separators */

interface ContextOptions {
  verbose?: boolean;
  skipMigrations?: boolean;
}

interface GitState {
  branch: string;
  status: string[];
  recentCommits: string[];
  hasUncommittedChanges: boolean;
}

/**
 * Bound on everything `execFileSafe` runs — the local git probes AND
 * `getCIStatus`'s `gh` calls, one of which (`gh run list`) is a network round
 * trip. Deliberately one value despite that split, unlike
 * `check-workflow-sync.ts`, which gives its network `git fetch` a larger
 * bound: there, a spurious timeout silently skips a guard whose whole job is
 * catching drift, so the cost is asymmetric. Here every failure already
 * degrades to `null` and the caller just omits a display section, and 15s on
 * a `gh` call matches `ci-gate.ts`'s existing `HEAD_FETCH_TIMEOUT_MS`.
 */
export const SESSION_CONTEXT_TIMEOUT_MS = 15_000;

/**
 * Separate, larger bound for the migration check. That call spawns npx, boots
 * the Prisma CLI and opens a database connection, so it is legitimately far
 * slower than a git probe — the git value would make a working check flaky.
 */
export const MIGRATION_STATUS_TIMEOUT_MS = 60_000;

/**
 * Execute a command safely with array arguments (no shell injection)
 */
function execFileSafe(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: SESSION_CONTEXT_TIMEOUT_MS,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get current git state
 */
function getGitState(cwd: string): GitState | null {
  const branch = execFileSafe('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (!branch) return null;

  const statusRaw = execFileSafe('git', ['status', '--porcelain'], cwd) ?? '';
  const status = statusRaw.split('\n').filter(Boolean);

  const commitsRaw = execFileSafe('git', ['log', '--oneline', '-5'], cwd) ?? '';
  const recentCommits = commitsRaw.split('\n').filter(Boolean);

  return {
    branch,
    status,
    recentCommits,
    hasUncommittedChanges: status.length > 0,
  };
}

/**
 * Extract summary from CURRENT_WORK.md if it exists
 */
function getCurrentWorkSummary(cwd: string): string | null {
  const workFile = join(cwd, 'CURRENT_WORK.md');
  if (!existsSync(workFile)) return null;

  const content = readFileSync(workFile, 'utf-8');
  const lines = content.split('\n');

  // Find the first non-empty, non-header line or first section
  const summaryLines: string[] = [];
  let foundContent = false;
  let lineCount = 0;

  for (const line of lines) {
    // Skip empty lines at the start
    if (!foundContent && line.trim() === '') continue;

    // Skip the title line
    if (line.startsWith('# ')) {
      foundContent = true;
      continue;
    }

    if (foundContent) {
      // Stop at next heading or after 10 lines of content
      if (line.startsWith('## ') && summaryLines.length > 0) break;
      if (lineCount >= 10) break;

      summaryLines.push(line);
      if (line.trim()) lineCount++;
    }
  }

  return summaryLines.length > 0 ? summaryLines.join('\n').trim() : null;
}

/**
 * Migration status, with "could not determine" kept distinct from "this repo
 * has no migrations". Collapsing them into one `null` made a DB hang render
 * identically to a repo with no `prisma/` directory — total silence — which is
 * the one degradation a session-startup warning must not choose.
 */
type MigrationStatus =
  { kind: 'absent' } | { kind: 'unknown'; reason: string } | { kind: 'known'; pending: string[] };

/** A status the display function can actually render — everything but `absent`. */
type ResolvedMigrationStatus = Exclude<MigrationStatus, { kind: 'absent' }>;

const PENDING_MARKER = 'have not yet been applied';

/** Migration names listed under prisma's pending-migrations marker. */
function parsePendingNames(output: string): string[] {
  const pending: string[] = [];
  let inPendingSection = false;

  for (const line of output.split('\n')) {
    if (line.includes(PENDING_MARKER)) {
      inPendingSection = true;
      continue;
    }
    if (inPendingSection && line.trim().startsWith('-')) {
      pending.push(line.trim().substring(1).trim());
    }
    if (inPendingSection && line.trim() === '') {
      break;
    }
  }

  return pending;
}

/**
 * Everything a failed run wrote, both streams, or `null` when neither is
 * readable.
 *
 * BOTH streams, because prisma splits them and the half that matters is the
 * one a stdout-only read misses. Probed against a real unreachable database:
 * stdout carries `Datasource "db": PostgreSQL database …` while stderr carries
 * `Error: P1001: Can't reach database server at …`. Reading stdout alone
 * therefore does not fail loudly — it produces a plausible-looking reason
 * naming the datasource while the actual error goes unread.
 *
 * `'stdout' in error` is also true when stdout is the EMPTY STRING (probed),
 * so a presence check on it cannot be used to fall through to another source.
 *
 * And on a SPAWN failure the keys are present with the value `undefined`
 * (probed against a missing binary: `code` is `ENOENT`, both streams are
 * `undefined`, and the identifying text lives only on `message`). `String()`
 * over that yields the literal `"undefined"` — a non-empty string that would
 * pass a length check and render as `failed: undefined` while suppressing the
 * `message` fallback that carries the real answer. Hence a nullish check on
 * the VALUE, not a presence check on the key.
 */
function streamText(error: unknown, key: 'stdout' | 'stderr'): string {
  if (error === null || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>)[key];
  // `encoding: 'utf-8'` on the call makes both streams strings when they hold
  // anything at all; every other shape (undefined on a spawn failure, a Buffer
  // if the encoding is ever dropped) is treated as absent so the caller falls
  // through to `message` — the direction that yields a real answer rather than
  // a stringified placeholder.
  return typeof value === 'string' ? value : '';
}

function capturedOutput(error: unknown): string | null {
  const streams = [streamText(error, 'stdout'), streamText(error, 'stderr')].filter(
    text => text.trim().length > 0
  );
  if (streams.length > 0) return streams.join('\n');
  if (error !== null && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return null;
}

const REASON_MAX_LENGTH = 160;

/**
 * The line of a failure's output most likely to identify it, bounded.
 *
 * One line because this is rendered into the session banner and prisma's
 * failures run to many lines of hints and connection detail. The
 * error-looking line is preferred over the first non-empty one for the same
 * reason both streams are read: the first line of a prisma failure is
 * routinely a benign datasource echo, and the identifying `Error: P1001…` sits
 * several lines below it.
 */
function failureLine(output: string): string {
  const lines = output.split('\n').filter(candidate => candidate.trim().length > 0);
  const line = (lines.find(candidate => /error/i.test(candidate)) ?? lines[0] ?? '').trim();
  return line.length > REASON_MAX_LENGTH ? `${line.slice(0, REASON_MAX_LENGTH)}…` : line;
}

/**
 * Check for pending migrations
 */
function getPendingMigrations(cwd: string): MigrationStatus {
  // Check if prisma migrations directory exists
  const migrationsDir = join(cwd, 'prisma', 'migrations');
  if (!existsSync(migrationsDir)) return { kind: 'absent' };

  // Try to get migration status via prisma CLI
  // Using execFileSync with npx to avoid shell injection
  try {
    // Exit 0 is the only output this function trusts as a complete answer.
    return { kind: 'known', pending: parsePendingNames(execSuccessOutput(cwd)) };
  } catch (error) {
    // A timeout kill must NOT fall through to the stdout branch below. Node
    // still attaches whatever stdout was captured before the SIGTERM, and
    // prisma typically hangs on the DB connection before printing anything —
    // so the partial (usually empty) output would fail the content match and
    // return [], reporting "no migrations pending" when the truth is unknown.
    // `code` is the discriminator: `killed` is undefined on this path.
    if (isTimeoutKill(error)) {
      return {
        kind: 'unknown',
        reason: `prisma migrate status timed out after ${MIGRATION_STATUS_TIMEOUT_MS / 1000}s`,
      };
    }
    // Prisma migrate status exits with non-zero when migrations are pending,
    // so a non-zero exit's output is the answer — when it is the pending shape.
    //
    // Two different reads of the same failure, deliberately: the pending LIST
    // is structured data and comes from stdout alone, while the failure REASON
    // is diagnostic prose and may come from either stream. Parsing the list out
    // of the merged blob would let a stderr warning that lands next to the
    // marker be absorbed as a migration name — and the merge exists only for
    // the reason, which is the half that was demonstrably on the wrong stream.
    // If prisma ever moved the list to stderr, the marker check below fails and
    // the answer degrades to `unknown`, never to a false all-clear.
    const stdout = streamText(error, 'stdout');
    const output = capturedOutput(error);
    if (output === null) {
      return { kind: 'unknown', reason: 'prisma migrate status failed with no readable output' };
    }

    // A non-zero exit is only a COMPLETE answer when it is the pending-migrations
    // exit. Every other non-zero shape — an unreachable database (P1001), schema
    // drift, a permission error, a spawn failure — carries output that simply
    // does not contain the marker, and reading that as "no marker, therefore
    // nothing pending" is the same confident-wrong all-clear this function's
    // timeout branch exists to prevent. A refused connection fails FAST, so it
    // is the likelier trigger of the two.
    if (!stdout.includes(PENDING_MARKER)) {
      // The fallback keeps the reason a complete sentence when both streams are
      // whitespace-only — otherwise it renders as a dangling colon.
      const detail = failureLine(output);
      return {
        kind: 'unknown',
        reason:
          detail === ''
            ? 'prisma migrate status failed with no readable output'
            : `prisma migrate status failed: ${detail}`,
      };
    }
    return { kind: 'known', pending: parsePendingNames(stdout) };
  }
}

/** The success-path invocation, split out so the `try` above wraps one call. */
function execSuccessOutput(cwd: string): string {
  return execFileSync('npx', ['prisma', 'migrate', 'status'], {
    encoding: 'utf-8',
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: MIGRATION_STATUS_TIMEOUT_MS,
  });
}

interface CIStatus {
  conclusion: 'success' | 'failure' | 'pending' | 'unknown';
  workflowName: string;
  url?: string;
}

/**
 * Get CI status for current branch using GitHub CLI
 */
function getCIStatus(cwd: string, branch: string): CIStatus | null {
  // Check if gh CLI is available
  const ghCheck = execFileSafe('gh', ['--version'], cwd);
  if (!ghCheck) return null;

  // Get the latest run status for this branch
  const result = execFileSafe(
    'gh',
    ['run', 'list', '--branch', branch, '--limit', '1', '--json', 'conclusion,name,url,status'],
    cwd
  );

  if (!result) return null;

  try {
    const runs = JSON.parse(result) as {
      conclusion: string | null;
      name: string;
      url: string;
      status: string;
    }[];

    if (runs.length === 0) return null;

    const run = runs[0];

    let conclusion: CIStatus['conclusion'];
    if (run.status === 'in_progress' || run.status === 'queued') {
      conclusion = 'pending';
    } else if (run.conclusion === 'success') {
      conclusion = 'success';
    } else if (run.conclusion === 'failure') {
      conclusion = 'failure';
    } else {
      conclusion = 'unknown';
    }

    return {
      conclusion,
      workflowName: run.name,
      url: run.url,
    };
  } catch {
    return null;
  }
}

/**
 * Get ROADMAP.md next items
 */
function getRoadmapNextItems(cwd: string): string[] | null {
  const roadmapFile = join(cwd, 'ROADMAP.md');
  if (!existsSync(roadmapFile)) return null;

  const content = readFileSync(roadmapFile, 'utf-8');
  const lines = content.split('\n');

  // Find unchecked items (- [ ])
  const unchecked: string[] = [];
  for (const line of lines) {
    if (line.includes('- [ ]')) {
      unchecked.push(line.trim());
      if (unchecked.length >= 5) break;
    }
  }

  return unchecked.length > 0 ? unchecked : null;
}

/**
 * Display git state section
 */
function displayGitState(git: GitState, verbose: boolean): void {
  console.log(chalk.yellow('📌 Git State'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`   Branch: ${chalk.green(git.branch)}`);

  if (git.hasUncommittedChanges) {
    console.log(`   Status: ${chalk.yellow(`${git.status.length} uncommitted change(s)`)}`);
    if (verbose) {
      for (const line of git.status.slice(0, 10)) {
        console.log(chalk.dim(`           ${line}`));
      }
      if (git.status.length > 10) {
        console.log(chalk.dim(`           ... and ${git.status.length - 10} more`));
      }
    }
  } else {
    console.log(`   Status: ${chalk.green('Clean')}`);
  }

  console.log('');
  console.log(chalk.dim('   Recent commits:'));
  for (const commit of git.recentCommits) {
    console.log(chalk.dim(`     ${commit}`));
  }
  console.log('');
}

/**
 * Display current work section
 */
function displayCurrentWork(currentWork: string): void {
  console.log(chalk.yellow('📋 Current Work'));
  console.log(chalk.dim('─'.repeat(50)));
  for (const line of currentWork.split('\n')) {
    console.log(`   ${line}`);
  }
  console.log('');
}

/**
 * Display roadmap items section
 */
function displayRoadmapItems(items: string[]): void {
  console.log(chalk.yellow('🗺️  Next Roadmap Items'));
  console.log(chalk.dim('─'.repeat(50)));
  for (const item of items) {
    console.log(`   ${item}`);
  }
  console.log('');
}

/**
 * Display migrations section
 */
function displayMigrations(status: ResolvedMigrationStatus): void {
  console.log(chalk.yellow('🗄️  Migrations'));
  console.log(chalk.dim('─'.repeat(50)));
  if (status.kind === 'unknown') {
    console.log(`   ${chalk.yellow(`Status unknown — ${status.reason}`)}`);
    // Deliberately cause-agnostic: an unknown can be a timeout, an unreachable
    // database, schema drift, or a permission error, and naming reachability
    // for all of them points a reader at the wrong thing three times out of four.
    console.log(chalk.dim('     Re-run `pnpm ops context` once the cause is cleared'));
    console.log('');
    return;
  }
  const { pending } = status;
  if (pending.length > 0) {
    console.log(`   ${chalk.yellow(`${pending.length} pending migration(s)`)}`);
    for (const migration of pending) {
      console.log(chalk.dim(`     - ${migration}`));
    }
  } else {
    console.log(`   ${chalk.green('All migrations applied')}`);
  }
  console.log('');
}

/**
 * Display CI status section
 */
function displayCIStatus(ci: CIStatus): void {
  console.log(chalk.yellow('🔄 CI Status'));
  console.log(chalk.dim('─'.repeat(50)));

  const statusIcon =
    ci.conclusion === 'success'
      ? chalk.green('✓')
      : ci.conclusion === 'failure'
        ? chalk.red('✗')
        : ci.conclusion === 'pending'
          ? chalk.yellow('⏳')
          : chalk.dim('?');

  const statusColor =
    ci.conclusion === 'success'
      ? chalk.green
      : ci.conclusion === 'failure'
        ? chalk.red
        : ci.conclusion === 'pending'
          ? chalk.yellow
          : chalk.dim;

  console.log(`   ${statusIcon} ${ci.workflowName}: ${statusColor(ci.conclusion)}`);
  if (ci.url) {
    console.log(chalk.dim(`     ${ci.url}`));
  }
  console.log('');
}

/**
 * Display summary section
 */
function displaySummary(
  hasUncommittedChanges: boolean,
  hasCurrentWork: boolean,
  ciStatus: CIStatus | null
): void {
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));

  if (hasUncommittedChanges) {
    console.log(chalk.yellow('⚠️  Uncommitted changes detected - review before starting'));
  }

  if (ciStatus?.conclusion === 'failure') {
    console.log(chalk.red('❌ CI is failing - check before making changes'));
  } else if (ciStatus?.conclusion === 'pending') {
    console.log(chalk.yellow('⏳ CI is running - wait for results'));
  }

  if (hasCurrentWork) {
    console.log(chalk.dim('💡 CURRENT_WORK.md found - check for pending tasks'));
  }

  console.log(chalk.dim('📚 See ROADMAP.md for full project status'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
}

/**
 * Output session context for AI startup
 */
export async function getSessionContext(options: ContextOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const { verbose = false, skipMigrations = false } = options;

  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('                    SESSION CONTEXT                     '));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log('');

  const git = getGitState(cwd);
  if (git) {
    displayGitState(git, verbose);
  }

  // Check CI status using current branch
  const ciStatus = git ? getCIStatus(cwd, git.branch) : null;
  if (ciStatus) {
    displayCIStatus(ciStatus);
  }

  const currentWork = getCurrentWorkSummary(cwd);
  if (currentWork) {
    displayCurrentWork(currentWork);
  }

  const roadmapItems = getRoadmapNextItems(cwd);
  if (roadmapItems) {
    displayRoadmapItems(roadmapItems);
  }

  if (!skipMigrations) {
    const migrations = getPendingMigrations(cwd);
    if (migrations.kind !== 'absent') {
      displayMigrations(migrations);
    }
  }

  displaySummary(git?.hasUncommittedChanges ?? false, currentWork !== null, ciStatus);
}
