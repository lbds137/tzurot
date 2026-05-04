/**
 * Inspect Commands
 *
 * Commands for inspecting runtime state (queues, caches, etc.)
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

const ENV_OPTION = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const ENV_OPTION_DEFAULT = { default: 'dev' };

export function registerInspectCommands(cli: CAC): void {
  cli
    .command('inspect:queue', 'Inspect BullMQ queue state')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--queue <name>', 'Queue name', { default: 'ai-requests' })
    .option('--failed-limit <n>', 'Number of failed jobs to show', { default: 5 })
    .option('--verbose', 'Show detailed job data')
    .example('pnpm ops inspect:queue')
    .example('pnpm ops inspect:queue --env prod')
    .example('pnpm ops inspect:queue --verbose --failed-limit 10')
    .action(
      async (options: {
        env?: Environment;
        queue?: string;
        failedLimit?: number;
        verbose?: boolean;
      }) => {
        const { inspectQueue } = await import('../inspect/queue.js');
        await inspectQueue({
          env: options.env ?? 'dev',
          queue: options.queue,
          failedLimit: options.failedLimit,
          verbose: options.verbose,
        });
      }
    );

  cli
    .command('inspect:tts-configs', 'List all tts_configs rows for the current env')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .example('pnpm ops inspect:tts-configs')
    .example('pnpm ops inspect:tts-configs --env prod')
    .action(async (options: { env?: Environment }) => {
      const { inspectTtsConfigs } = await import('../inspect/tts-configs.js');
      await inspectTtsConfigs({ env: options.env ?? 'dev' });
    });

  cli
    .command('inspect:dlq', 'View failed jobs in BullMQ dead letter queue')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--queue <name>', 'Queue name', { default: 'ai-requests' })
    .option('--limit <n>', 'Number of failed jobs to show', { default: 10 })
    .option('--json', 'Output as JSON for scripting')
    .example('pnpm ops inspect:dlq')
    .example('pnpm ops inspect:dlq --env prod')
    .example('pnpm ops inspect:dlq --limit 20 --json')
    .action(
      async (options: { env?: Environment; queue?: string; limit?: number; json?: boolean }) => {
        const { viewDlq } = await import('../inspect/dlq.js');
        await viewDlq({
          env: options.env ?? 'dev',
          queue: options.queue,
          limit: options.limit,
          json: options.json,
        });
      }
    );
}
