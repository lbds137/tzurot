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
 * Execute a command safely with array arguments (no shell injection)
 */
function execFileSafe(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
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
 * Check for pending migrations
 */
function getPendingMigrations(cwd: string): string[] | null {
  // Check if prisma migrations directory exists
  const migrationsDir = join(cwd, 'prisma', 'migrations');
  if (!existsSync(migrationsDir)) return null;

  // Try to get migration status via prisma CLI
  // Using execFileSync with npx to avoid shell injection
  let result: string;
  try {
    result = execFileSync('npx', ['prisma', 'migrate', 'status'], {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    // Prisma migrate status exits with non-zero when migrations are pending
    // We need to capture the output from stderr/stdout
    if (error && typeof error === 'object' && 'stdout' in error) {
      result = String((error as { stdout: unknown }).stdout);
    } else if (error && typeof error === 'object' && 'message' in error) {
      result = String((error as { message: unknown }).message);
    } else {
      return null;
    }
  }

  // Look for "Following migration(s) have not yet been applied"
  if (result.includes('have not yet been applied')) {
    const lines = result.split('\n');
    const pending: string[] = [];
    let inPendingSection = false;

    for (const line of lines) {
      if (line.includes('have not yet been applied')) {
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

  return [];
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
function displayMigrations(pending: string[]): void {
  console.log(chalk.yellow('🗄️  Migrations'));
  console.log(chalk.dim('─'.repeat(50)));
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
    const pending = getPendingMigrations(cwd);
    if (pending !== null) {
      displayMigrations(pending);
    }
  }

  displaySummary(git?.hasUncommittedChanges ?? false, currentWork !== null, ciStatus);
}
