/**
 * Periodic-maintenance cadence commands: the overdue nag and the stamp.
 * Implementation + rationale in ../dev/cadence.ts.
 */

import type { CAC } from 'cac';
import { runCadenceMark, runCadenceStatus } from '../dev/cadence.js';

export function registerCadenceCommands(cli: CAC): void {
  cli
    .command(
      'cadence:status',
      'Show the periodic-maintenance ledger with overdue state (exits 0 whatever is overdue)'
    )
    .option('--overdue-only', 'Print only overdue passes; print nothing when none are overdue')
    .example('ops cadence:status --overdue-only')
    .action((options: { overdueOnly?: boolean }) => {
      process.exitCode = runCadenceStatus({ overdueOnly: options.overdueOnly === true });
    });

  cli
    .command('cadence:mark <name>', 'Stamp a periodic pass as run (default: today, local date)')
    .option('--date <date>', 'Run date as YYYY-MM-DD instead of today')
    .example('ops cadence:mark session-mining')
    .example('ops cadence:mark usage-audit --date 2026-09-13')
    .action((name: string, options: { date?: string | number }) => {
      // cac's parser (mri) turns a numeric-looking value such as `--date 20260914`
      // into a number; String() hands it to the date validator in its typed form.
      const date = options.date === undefined ? undefined : String(options.date);
      process.exitCode = runCadenceMark({ name, date });
    });
}
