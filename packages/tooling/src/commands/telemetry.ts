/**
 * Telemetry CLI commands
 *
 * Read-only reporting over the `command_events` table.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

const ENV_OPTION = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const ENV_OPTION_DEFAULT = { default: 'dev' } as const;

export function registerTelemetryCommands(cli: CAC): void {
  cli
    .command('telemetry:report', 'Command discoverability report over command_events (read-only)')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--days <n>', 'Trailing window in days', { default: 30 })
    .option('--output <file>', 'Write the markdown to a file instead of stdout')
    .action(async (options: { env?: Environment; days?: number | string; output?: string }) => {
      const { telemetryReport } = await import('../telemetry/discoverability-report.js');
      await telemetryReport({
        env: options.env ?? 'dev',
        days: options.days,
        output: options.output,
      });
    });
}
