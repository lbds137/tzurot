/**
 * Inspect Commands
 *
 * Commands for inspecting runtime state (queues, caches, etc.)
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

export function registerInspectCommands(cli: CAC): void {
  cli
    .command('inspect:queue', 'Inspect BullMQ queue state')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'dev' })
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
    .command('inspect:dlq', 'View failed jobs in BullMQ dead letter queue')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'dev' })
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
