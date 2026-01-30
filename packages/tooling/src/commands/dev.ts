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
    .command('guard:boundaries', 'Check for architecture boundary violations')
    .option('--verbose', 'Show detailed output')
    .example('ops guard:boundaries')
    .example('ops guard:boundaries --verbose')
    .action(async (options: { verbose?: boolean }) => {
      const { checkBoundaries } = await import('../dev/check-boundaries.js');
      await checkBoundaries(options);
    });

  cli
    .command(
      'lint:complexity-report',
      'Report files/functions approaching ESLint complexity limits'
    )
    .option('--verbose', 'Show all findings instead of top 5 per category')
    .option('--allow-failures', 'Exit 0 even if items are at/over limits (for local dev)')
    .option('--json', 'Output JSON for CI integration')
    .example('ops lint:complexity-report')
    .example('ops lint:complexity-report --verbose')
    .example('ops lint:complexity-report --json')
    .action(async (options: { verbose?: boolean; allowFailures?: boolean; json?: boolean }) => {
      const { runComplexityReport } = await import('../lint/complexity-report.js');
      await runComplexityReport({
        verbose: options.verbose,
        noFail: options.allowFailures,
        json: options.json,
      });
    });
}
