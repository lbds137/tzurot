/**
 * Dev Commands
 *
 * Development workflow commands for running focused checks on changed code.
 */

import type { CAC } from 'cac';

import { parseIntFlag, rawOptionValue } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';

/** A commit SHA is 7-40 hex characters; a hand-completed or truncated value fails cleanly here rather than downstream in `git`. */
const SHA_FORMAT = /^[0-9a-f]{7,40}$/i;

function parseShaFlag(raw: string, flagName: string): string {
  const trimmed = raw.trim();
  if (!SHA_FORMAT.test(trimmed)) {
    throw new UsageError(`${flagName} must be a 7–40 character hex commit SHA`);
  }
  return trimmed;
}

export function registerDevCommands(cli: CAC): void {
  cli
    .command('dev:focus <task>', 'Run turbo task only on packages with changes')
    .option('--all', 'Run on all packages instead of just changed ones')
    .example('ops dev:focus lint')
    .example('ops dev:focus test')
    .example('ops dev:focus build --all')
    .action(async (task: string, options: { all?: boolean; '--': string[] }) => {
      const { runFocusedTask } = await import('../dev/focus-runner.js');
      runFocusedTask({
        task,
        extraArgs: options['--'] ?? [],
        all: options.all,
      });
    });

  cli
    .command('dev:lint', 'Lint only changed packages (shortcut for dev:focus lint)')
    .option('--all', 'Lint all packages')
    .option('--errors-only', 'Show only errors, no warnings')
    .action(async (options: { all?: boolean; errorsOnly?: boolean }) => {
      const { runFocusedTask } = await import('../dev/focus-runner.js');
      const extraArgs: string[] = [];
      if (options.errorsOnly) {
        extraArgs.push('--quiet', '--format=pretty');
      }
      runFocusedTask({
        task: 'lint',
        extraArgs,
        all: options.all,
      });
    });

  cli
    .command('dev:test', 'Test only changed packages (shortcut for dev:focus test)')
    .option('--all', 'Test all packages')
    .action(async (options: { all?: boolean }) => {
      const { runFocusedTask } = await import('../dev/focus-runner.js');
      runFocusedTask({
        task: 'test',
        all: options.all,
      });
    });

  cli
    .command('dev:typecheck', 'Typecheck only changed packages (shortcut for dev:focus typecheck)')
    .option('--all', 'Typecheck all packages')
    .action(async (options: { all?: boolean }) => {
      const { runFocusedTask } = await import('../dev/focus-runner.js');
      runFocusedTask({
        task: 'typecheck',
        all: options.all,
      });
    });

  cli.command('dev:test-summary', 'Run tests and show a clean summary').action(async () => {
    const { runTestSummary } = await import('../dev/test-summary.js');
    runTestSummary();
  });

  cli
    .command('dev:update-deps', 'Update all dependencies to latest versions')
    .option('--skip-build', 'Skip build verification after updating')
    .option('--dry-run', 'Show what would be changed without making changes')
    .example('ops dev:update-deps')
    .example('ops dev:update-deps --skip-build')
    .example('ops dev:update-deps --dry-run')
    .action(async (options: { skipBuild?: boolean; dryRun?: boolean }) => {
      const { updateDeps } = await import('../dev/update-deps.js');
      await updateDeps(options);
    });

  cli
    .command('dev:dead-files', 'Find production files only referenced by their own tests')
    .example('ops dev:dead-files')
    .action(async () => {
      const { runFindDeadFiles } = await import('../dev/find-dead-files.js');
      runFindDeadFiles();
    });

  cli
    .command(
      'dev:deferred-refs [...files]',
      'Surface tracker tasks (tracker/tasks/) referencing the given (or staged) files — informational, never fails'
    )
    .option('--staged', 'Use the git staged file list')
    .example('ops dev:deferred-refs --staged')
    .example('ops dev:deferred-refs services/ai-worker/src/services/MemoryRetriever.ts')
    .action(async (files: string[], options: { staged?: boolean }) => {
      const { checkDeferredRefs } = await import('../dev/check-deferred-refs.js');
      await checkDeferredRefs({ staged: options.staged, files });
    });

  registerSchemaAuditCommand(cli);
  registerStaleDebugCommand(cli);
  registerComplexityReportCommand(cli);
  registerCommandsAuditCommand(cli);
  registerBacklogCommand(cli);
  registerWorktreeTransferCommand(cli);
  registerUnitCloseoutCommand(cli);
}

function registerWorktreeTransferCommand(cli: CAC): void {
  cli
    .command(
      'worktree:transfer <path>',
      "Apply a worker worktree's staged diff into the main tree, verify it byte-for-byte, then remove the worktree and its throwaway branch"
    )
    .option('--base <sha>', "Refuse unless the main tree's HEAD still equals this SHA")
    .example('ops worktree:transfer .claude/worktrees/agent-xyz')
    .example(
      'ops worktree:transfer .claude/worktrees/agent-xyz --base 6bbfaeaa1faa683b91a6249095aa3ebe96bed0b7'
    )
    .action(async (worktreePath: string) => {
      // Read --base from raw argv, not cac's parsed options: mri coerces a
      // digit-only value to a Number before any type declaration applies, and
      // an all-decimal SHA (rare, not impossible) would arrive as a number.
      // Same reason gh:ci-gate reads --sha this way.
      const rawBase = rawOptionValue(process.argv, '--base');
      const base = rawBase === undefined ? undefined : parseShaFlag(rawBase, '--base');
      const { transferWorktree } = await import('../dev/worktree-transfer.js');
      const result = transferWorktree({ worktreePath, base });
      if (!result.ok) {
        console.error(`worktree:transfer refused (${result.check}): ${result.reason}`);
        process.exitCode = 1;
      }
    });
}

function registerUnitCloseoutCommand(cli: CAC): void {
  cli
    .command(
      'unit:closeout <task-id>',
      'Close a tracker task, commit and push the tracker file to develop, and print the now.md/CURRENT.md lines that still need judgment'
    )
    .option('--pr <n>', 'PR number the unit merged as')
    .option('--sha <sha>', 'Merge commit SHA')
    .example('ops unit:closeout TASK-934 --pr 2400 --sha 6bbfaeaa1faa683b91a6249095aa3ebe96bed0b7')
    .action(async (taskId: string, options: { pr?: string | number; sha?: string }) => {
      const pr = parseIntFlag(options.pr, '--pr', { min: 1 });
      if (pr === undefined) {
        throw new UsageError('--pr <n> is required');
      }
      // Read --sha from raw argv, not cac's parsed options: mri coerces a
      // digit-only value to a Number before any type declaration applies, and
      // an all-decimal SHA (rare, not impossible) would arrive as a number.
      // Same reason gh:ci-gate reads --sha this way.
      const rawSha = rawOptionValue(process.argv, '--sha');
      if (rawSha === undefined || rawSha.trim().length === 0) {
        throw new UsageError('--sha <merge-sha> is required');
      }
      const sha = parseShaFlag(rawSha, '--sha');
      const { unitCloseout } = await import('../dev/unit-closeout.js');
      const result = unitCloseout({ taskId, pr, sha });
      if (!result.ok) {
        console.error(`unit:closeout refused (${result.check}): ${result.reason}`);
        process.exitCode = 1;
      }
    });
}

function registerStaleDebugCommand(cli: CAC): void {
  cli
    .command('dev:stale-debug', 'Audit for debug-typed commits whose scaffolding survives at HEAD')
    .option('--summary', 'Emit a JSONL summary line for the audit aggregator')
    .option('--max-age-days <n>', 'Age at which surviving scaffolding fails (default 14)')
    .example('ops dev:stale-debug')
    .example('ops dev:stale-debug --summary')
    .action(async (options: { summary?: boolean; maxAgeDays?: string }) => {
      const { runStaleDebugAudit } = await import('../dev/stale-debug-audit.js');
      runStaleDebugAudit({
        summary: options.summary,
        maxAgeDays: parseIntFlag(options.maxAgeDays, '--max-age-days', { min: 1 }),
      });
    });
}

function registerBacklogCommand(cli: CAC): void {
  cli
    .command(
      'backlog',
      'Lint the backlog surfaces: now.md caps, queue.md doc refs, tracker store integrity'
    )
    .example('ops backlog')
    .action(async () => {
      const { runBacklogLint } = await import('../dev/backlogLint.js');
      await runBacklogLint();
    });

  cli
    .command(
      'backlog:digest',
      'Generate the session-start briefing from the tracker store (areas, oldest 20, newest 10)'
    )
    .example('ops backlog:digest')
    .action(async () => {
      const { runBacklogDigest } = await import('../dev/backlogDigest.js');
      await runBacklogDigest();
    });
}

function registerCommandsAuditCommand(cli: CAC): void {
  cli
    .command('commands:audit', 'Slash-command surface inventory + consistency audit')
    .option('--format <format>', 'Inventory output format: tree (default), md, json')
    .option(
      '--summary',
      'Output only the standardized JSONL audit-summary line (for the audit-aggregator)'
    )
    .example('ops commands:audit')
    .example('ops commands:audit --format md')
    .example('ops commands:audit --format json')
    .example('ops commands:audit --summary')
    .action(async (options: { format?: string; summary?: boolean }) => {
      const { runCommandsAudit } = await import('../dev/commandsAudit.js');
      const fmt = options.format;
      if (fmt !== undefined && fmt !== 'tree' && fmt !== 'md' && fmt !== 'json') {
        console.warn(`Unknown --format "${fmt}"; falling back to tree.`);
      }
      const format = fmt === 'md' || fmt === 'json' ? fmt : 'tree';
      await runCommandsAudit({ format, summary: options.summary });
    });
}

function registerComplexityReportCommand(cli: CAC): void {
  cli
    .command(
      'lint:complexity-report',
      'Report files/functions approaching ESLint complexity limits'
    )
    .option('--verbose', 'Show all findings instead of top 5 per category')
    .option('--allow-failures', 'Exit 0 even if items are at/over limits (for local dev)')
    .option('--json', 'Output JSON for CI integration')
    .option(
      '--summary',
      'Output only the standardized JSONL audit-summary line (for the audit-aggregator)'
    )
    .example('ops lint:complexity-report')
    .example('ops lint:complexity-report --verbose')
    .example('ops lint:complexity-report --json')
    .example('ops lint:complexity-report --summary')
    .action(
      async (options: {
        verbose?: boolean;
        allowFailures?: boolean;
        json?: boolean;
        summary?: boolean;
      }) => {
        const { runComplexityReport } = await import('../lint/complexity-report.js');
        await runComplexityReport({
          verbose: options.verbose,
          noFail: options.allowFailures,
          json: options.json,
          summary: options.summary,
        });
      }
    );
}

function registerSchemaAuditCommand(cli: CAC): void {
  cli
    .command('dev:schema-audit', 'Audit Prisma optional columns for fake-optionality')
    .option('--json', 'Emit JSON instead of markdown')
    .option('--config <path>', 'Path to audit.config.ts/.json (default: ./audit.config.ts)')
    .example('ops dev:schema-audit')
    .example('ops dev:schema-audit --json')
    .example('ops dev:schema-audit --config ./audit.config.json')
    .action(async (options: { json?: boolean; config?: string }) => {
      const { runSchemaAudit } = await import('../dev/schema-audit.js');
      await runSchemaAudit({
        format: options.json === true ? 'json' : 'markdown',
        configPath: options.config,
      });
    });
}
