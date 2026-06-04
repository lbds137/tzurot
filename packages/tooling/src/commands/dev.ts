/**
 * Dev Commands
 *
 * Development workflow commands for running focused checks on changed code.
 */

import type { CAC } from 'cac';

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
      'Surface deferred-backlog entries referencing the given (or staged) files — informational, never fails'
    )
    .option('--staged', 'Use the git staged file list')
    .example('ops dev:deferred-refs --staged')
    .example('ops dev:deferred-refs services/ai-worker/src/services/MemoryRetriever.ts')
    .action(async (files: string[], options: { staged?: boolean }) => {
      const { checkDeferredRefs } = await import('../dev/check-deferred-refs.js');
      await checkDeferredRefs({ staged: options.staged, files });
    });

  registerSchemaAuditCommand(cli);
  registerComplexityReportCommand(cli);
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
