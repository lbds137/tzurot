/**
 * Telemetry CLI commands
 *
 * Read-only reporting over the `command_events`, `usage_logs` and
 * `llm_diagnostic_logs` tables.
 */

import type { CAC } from 'cac';
import { DIAGNOSTIC_RETENTION_DAYS } from '@tzurot/common-types/constants/diagnostics';
import type { Environment } from '../utils/env-runner.js';

const ENV_OPTION = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const ENV_OPTION_DEFAULT = { default: 'dev' } as const;
const DAYS_OPTION = '--days <n>';
const OUTPUT_OPTION = '--output <file>';
const OUTPUT_OPTION_DESC = 'Write the markdown to a file instead of stdout';

export function registerTelemetryCommands(cli: CAC): void {
  cli
    .command('telemetry:report', 'Command discoverability report over command_events (read-only)')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option(DAYS_OPTION, 'Trailing window in days', { default: 30 })
    .option(OUTPUT_OPTION, OUTPUT_OPTION_DESC)
    .action(async (options: { env?: Environment; days?: number | string; output?: string }) => {
      const { telemetryReport } = await import('../telemetry/discoverability-report.js');
      await telemetryReport({
        env: options.env ?? 'dev',
        days: options.days,
        output: options.output,
      });
    });

  cli
    .command('telemetry:inference', 'Inference usage report over usage_logs (read-only)')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option(DAYS_OPTION, 'Trailing window in days', { default: 30 })
    .option(OUTPUT_OPTION, OUTPUT_OPTION_DESC)
    .action(async (options: { env?: Environment; days?: number | string; output?: string }) => {
      const { telemetryInferenceReport } = await import('../telemetry/inference-report.js');
      await telemetryInferenceReport({
        env: options.env ?? 'dev',
        days: options.days,
        output: options.output,
      });
    });

  cli
    .command(
      'telemetry:upstream',
      'OpenRouter upstream-host report over llm_diagnostic_logs (read-only)'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    // No cac default: an omitted --days arrives as undefined, and telemetryUpstreamReport
    // applies DIAGNOSTIC_RETENTION_DAYS through parseDays. A cac default would pin 7 here.
    .option(
      DAYS_OPTION,
      `Trailing window in days (diagnostic retention is ${DIAGNOSTIC_RETENTION_DAYS})`
    )
    .option(OUTPUT_OPTION, OUTPUT_OPTION_DESC)
    .action(async (options: { env?: Environment; days?: number | string; output?: string }) => {
      const { telemetryUpstreamReport } = await import('../telemetry/upstream-report.js');
      await telemetryUpstreamReport({
        env: options.env ?? 'dev',
        days: options.days,
        output: options.output,
      });
    });
}
