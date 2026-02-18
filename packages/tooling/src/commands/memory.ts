/**
 * Memory-related CLI commands
 *
 * Commands for analyzing and managing pgvector memories.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

const ENV_OPTION = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const ENV_OPTION_DEFAULT = { default: 'dev' } as const;

export function registerMemoryCommands(cli: CAC): void {
  // Analyze duplicate memories
  cli
    .command('memory:analyze', 'Analyze duplicate memories in the database')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--verbose', 'Show detailed breakdown of duplicate groups')
    .action(async (options: { env?: Environment; verbose?: boolean }) => {
      const { analyzeDuplicateMemories } = await import('../memory/cleanup-duplicates.js');
      await analyzeDuplicateMemories({
        env: options.env ?? 'dev',
        verbose: options.verbose,
      });
    });

  // Backfill long-term memories from conversation history
  cli
    .command('memory:backfill', 'Backfill LTM from conversation_history for a date range')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--from <date>', 'Start date (YYYY-MM-DD, inclusive)')
    .option('--to <date>', 'End date (YYYY-MM-DD, exclusive)')
    .option('--dry-run', 'Show what would be backfilled without inserting')
    .option('--personality-id <id>', 'Filter to a specific personality UUID')
    .option('--force', 'Skip production confirmation prompt')
    .action(
      async (options: {
        env?: Environment;
        from?: string;
        to?: string;
        dryRun?: boolean;
        personalityId?: string;
        force?: boolean;
      }) => {
        if (!options.from || !options.to) {
          console.error('Error: --from and --to are required');
          process.exit(1);
        }
        const { backfillLongTermMemories } = await import('../memory/backfill-ltm.js');
        await backfillLongTermMemories({
          env: options.env ?? 'dev',
          from: options.from,
          to: options.to,
          dryRun: options.dryRun,
          personalityId: options.personalityId,
          force: options.force,
        });
      }
    );

  // Cleanup duplicate memories
  cli
    .command('memory:cleanup', 'Remove duplicate memories (interactive)')
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--dry-run', 'Show what would be deleted without making changes')
    .option('--force', 'Skip confirmation prompts (required for prod with --force)')
    .option('--verbose', 'Show detailed breakdown of duplicate groups')
    .action(
      async (options: {
        env?: Environment;
        dryRun?: boolean;
        force?: boolean;
        verbose?: boolean;
      }) => {
        const { cleanupDuplicateMemories } = await import('../memory/cleanup-duplicates.js');
        await cleanupDuplicateMemories({
          env: options.env ?? 'dev',
          dryRun: options.dryRun,
          force: options.force,
          verbose: options.verbose,
        });
      }
    );
}
