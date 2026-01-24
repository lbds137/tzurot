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
}
