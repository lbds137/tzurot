/**
 * Focus Runner
 *
 * Runs turbo tasks only on packages affected by current changes.
 * Automatically detects the git comparison base (develop, main, or HEAD^1).
 */

import { execFileSync, spawnSync } from 'node:child_process';

interface FocusRunnerOptions {
  /** Turbo task to run (lint, test, build, typecheck) */
  task: string;
  /** Additional arguments to pass to the underlying command */
  extraArgs?: string[];
  /** Force run on all packages (ignore git diff) */
  all?: boolean;
}

/**
 * Bound on every git call this runner makes. Each call already degrades to a
 * fallback or `null`/`false` on failure — bounded, a stall lands in that same
 * degradation path instead of hanging a local `pnpm focus:*` invocation.
 */
export const FOCUS_RUNNER_TIMEOUT_MS = 15_000;

/**
 * Detect the appropriate git base for comparison
 */
function detectGitBase(): string | null {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: FOCUS_RUNNER_TIMEOUT_MS,
    }).trim();

    if (branch === 'main' || branch === 'master') {
      return 'HEAD^1';
    }

    // Check if origin/develop exists
    try {
      execFileSync('git', ['rev-parse', '--verify', 'origin/develop'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: FOCUS_RUNNER_TIMEOUT_MS,
      });
      return 'origin/develop';
    } catch {
      // Fall back to origin/main
      try {
        execFileSync('git', ['rev-parse', '--verify', 'origin/main'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: FOCUS_RUNNER_TIMEOUT_MS,
        });
        return 'origin/main';
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Check if there are uncommitted changes
 */
function hasUncommittedChanges(): boolean {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: FOCUS_RUNNER_TIMEOUT_MS,
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Run a turbo task focused on changed packages
 */
export function runFocusedTask(options: FocusRunnerOptions): void {
  const { task, extraArgs = [], all = false } = options;

  const turboArgs = ['run', task];

  if (!all) {
    const base = detectGitBase();
    if (base !== null) {
      turboArgs.push('--filter', `...[${base}]`);

      if (hasUncommittedChanges()) {
        console.log('\x1b[90m› Detected uncommitted changes\x1b[0m');
      }
      console.log(`\x1b[90m› Comparing against: ${base}\x1b[0m`);
    } else {
      console.log('\x1b[33m› Could not determine git base, running on all packages\x1b[0m');
    }
  }

  if (extraArgs.length > 0) {
    turboArgs.push('--', ...extraArgs);
  }

  console.log(`\x1b[36m› Running focused ${task}...\x1b[0m`);
  console.log(`\x1b[90m› turbo ${turboArgs.join(' ')}\x1b[0m\n`);

  // Deliberately unbounded: this is the actual lint/test/build run, not a
  // probe, so it legitimately runs for minutes — a bound would turn a working
  // command flaky. Same reasoning as the knip spawn in find-dead-files.ts.
  const result = spawnSync('turbo', turboArgs, {
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error('\x1b[31mError running turbo:\x1b[0m', result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
