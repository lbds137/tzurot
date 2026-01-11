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
}
