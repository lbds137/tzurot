/**
 * Memory-related CLI commands
 *
 * Commands for analyzing and managing pgvector memories.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';

export function registerMemoryCommands(cli: CAC): void {
  // Analyze duplicate memories
  cli
    .command('memory:analyze', 'Analyze duplicate memories in the database')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'dev' })
    .option('--verbose', 'Show detailed breakdown of duplicate groups')
    .action(async (options: { env?: Environment; verbose?: boolean }) => {
      const { analyzeDuplicateMemories } = await import('../memory/cleanup-duplicates.js');
      await analyzeDuplicateMemories({
        env: options.env ?? 'dev',
        verbose: options.verbose,
      });
    });

  // Cleanup duplicate memories
  cli
    .command('memory:cleanup', 'Remove duplicate memories (interactive)')
    .option('--env <env>', 'Environment: local, dev, or prod', { default: 'dev' })
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
