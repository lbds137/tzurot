/**
 * Session State Management
 *
 * Captures and restores session state for AI continuity.
 * Helps preserve context across session boundaries.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

interface SessionState {
  timestamp: string;
  branch: string;
  uncommittedChanges: string[];
  recentCommits: string[];
  currentWork?: string;
  notes?: string;
}

const SESSION_FILE = '.claude-session.json';

/**
 * Execute a command safely with array arguments
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
function getGitState(cwd: string): { branch: string; changes: string[]; commits: string[] } | null {
  const branch = execFileSafe('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (!branch) return null;

  const statusRaw = execFileSafe('git', ['status', '--porcelain'], cwd) ?? '';
  const changes = statusRaw.split('\n').filter(Boolean);

  const commitsRaw = execFileSafe('git', ['log', '--oneline', '-10'], cwd) ?? '';
  const commits = commitsRaw.split('\n').filter(Boolean);

  return { branch, changes, commits };
}

/**
 * Get CURRENT_WORK.md content
 */
function getCurrentWork(cwd: string): string | null {
  const workFile = join(cwd, 'CURRENT_WORK.md');
  if (!existsSync(workFile)) return null;
  return readFileSync(workFile, 'utf-8');
}

/**
 * Save current session state
 */
export async function saveSession(options: { notes?: string } = {}): Promise<void> {
  const cwd = process.cwd();
  const sessionFile = join(cwd, SESSION_FILE);

  // eslint-disable-next-line sonarjs/no-duplicate-string -- CLI decorative separator shared across display functions
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('              SAVING SESSION STATE                      '));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log('');

  const git = getGitState(cwd);
  if (!git) {
    console.error(chalk.red('❌ Not in a git repository'));
    process.exitCode = 1;
    return;
  }

  const currentWork = getCurrentWork(cwd);

  const state: SessionState = {
    timestamp: new Date().toISOString(),
    branch: git.branch,
    uncommittedChanges: git.changes,
    recentCommits: git.commits,
    currentWork: currentWork ?? undefined,
    notes: options.notes,
  };

  writeFileSync(sessionFile, JSON.stringify(state, null, 2) + '\n');

  console.log(chalk.green(`✅ Session state saved to ${SESSION_FILE}`));
  console.log('');
  console.log(chalk.dim(`   Branch: ${state.branch}`));
  console.log(chalk.dim(`   Uncommitted changes: ${state.uncommittedChanges.length}`));
  console.log(chalk.dim(`   Recent commits: ${state.recentCommits.length}`));
  if (state.currentWork) {
    console.log(chalk.dim('   CURRENT_WORK.md: Captured'));
  }
  if (state.notes) {
    console.log(chalk.dim(`   Notes: ${state.notes}`));
  }
  console.log('');
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.dim('💡 Restore with: pnpm ops session:load'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
}

/**
 * Display branch info section
 */
function displayBranchSection(
  state: SessionState,
  currentGit: { branch: string; changes: string[]; commits: string[] } | null
): void {
  console.log(chalk.yellow('📌 Branch'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`   ${state.branch}`);
  if (currentGit && currentGit.branch !== state.branch) {
    console.log(chalk.yellow(`   ⚠️  Now on: ${currentGit.branch}`));
  }
  console.log('');
}

/**
 * Display uncommitted changes section
 */
function displayChangesSection(changes: string[]): void {
  if (changes.length === 0) return;
  console.log(chalk.yellow('📝 Uncommitted Changes (at save time)'));
  console.log(chalk.dim('─'.repeat(50)));
  for (const change of changes.slice(0, 10)) {
    console.log(chalk.dim(`   ${change}`));
  }
  if (changes.length > 10) {
    console.log(chalk.dim(`   ... and ${changes.length - 10} more`));
  }
  console.log('');
}

/**
 * Display recent commits section
 */
function displayCommitsSection(commits: string[]): void {
  console.log(chalk.yellow('📋 Recent Commits (at save time)'));
  console.log(chalk.dim('─'.repeat(50)));
  for (const commit of commits.slice(0, 5)) {
    console.log(chalk.dim(`   ${commit}`));
  }
  console.log('');
}

/**
 * Display optional sections (notes and current work)
 */
function displayOptionalSections(state: SessionState): void {
  if (state.notes) {
    console.log(chalk.yellow('💭 Session Notes'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log(`   ${state.notes}`);
    console.log('');
  }

  if (state.currentWork) {
    console.log(chalk.yellow('📋 CURRENT_WORK.md (at save time)'));
    console.log(chalk.dim('─'.repeat(50)));
    const lines = state.currentWork.split('\n').slice(0, 20);
    for (const line of lines) {
      console.log(`   ${line}`);
    }
    if (state.currentWork.split('\n').length > 20) {
      console.log(chalk.dim('   ... (truncated)'));
    }
    console.log('');
  }
}

/**
 * Load and display saved session state
 */
export async function loadSession(): Promise<void> {
  const cwd = process.cwd();
  const sessionFile = join(cwd, SESSION_FILE);

  if (!existsSync(sessionFile)) {
    console.error(chalk.yellow('⚠️  No saved session found'));
    console.error(chalk.dim(`   Save one with: pnpm ops session:save`));
    return;
  }

  const state = JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionState;

  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('              PREVIOUS SESSION STATE                    '));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log('');

  // Check if state is stale (different branch or newer commits)
  const currentGit = getGitState(cwd);
  const isStale =
    currentGit &&
    (currentGit.branch !== state.branch || currentGit.commits[0] !== state.recentCommits[0]);

  if (isStale) {
    console.log(chalk.yellow('⚠️  Session state may be stale (branch or commits changed)'));
    console.log('');
  }

  console.log(chalk.dim(`Saved: ${new Date(state.timestamp).toLocaleString()}`));
  console.log('');

  displayBranchSection(state, currentGit);
  displayChangesSection(state.uncommittedChanges);
  displayCommitsSection(state.recentCommits);
  displayOptionalSections(state);

  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.dim('💡 This was the state when session was saved.'));
  console.log(chalk.dim('   Run `pnpm ops context` for current state.'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
}

/**
 * Clear saved session state
 */
export async function clearSession(): Promise<void> {
  const cwd = process.cwd();
  const sessionFile = join(cwd, SESSION_FILE);

  if (!existsSync(sessionFile)) {
    console.log(chalk.dim('No saved session to clear'));
    return;
  }

  const { unlinkSync } = await import('node:fs');
  unlinkSync(sessionFile);
  console.log(chalk.green(`✅ Session state cleared (${SESSION_FILE} deleted)`));
}
