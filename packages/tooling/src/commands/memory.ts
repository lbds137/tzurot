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

/** Backfill fact extraction over historical memories (memory Phase 2). */
function registerBackfillFactsCommand(cli: CAC): void {
  cli
    .command(
      'memory:backfill-facts',
      'Enqueue fact-extraction jobs for memories that predate the live trigger'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--dry-run', 'Report scope (groups/windows) without enqueueing')
    .option('--limit <n>', 'Cap enqueued windows (canary runs)')
    .option('--personality-id <id>', 'Filter to a specific personality UUID')
    .option('--window-size <n>', 'Episodes per extraction window (default 6, the live threshold)')
    .option('--include-covered', 'Also re-enqueue memories already cited by existing facts')
    .option('--force', 'Skip production confirmation prompt')
    .action(
      async (options: {
        env?: Environment;
        dryRun?: boolean;
        limit?: string;
        personalityId?: string;
        windowSize?: string;
        includeCovered?: boolean;
        force?: boolean;
      }) => {
        const { backfillFacts } = await import('../memory/backfill-facts.js');
        await backfillFacts({
          env: options.env ?? 'dev',
          dryRun: options.dryRun,
          limit: options.limit === undefined ? undefined : Number(options.limit),
          personalityId: options.personalityId,
          windowSize: options.windowSize === undefined ? undefined : Number(options.windowSize),
          includeCovered: options.includeCovered,
          force: options.force,
        });
      }
    );
}

/** Goldens mining + anonymization — builds the retrieval-eval corpus from real persona data. */
function registerGoldensCommands(cli: CAC): void {
  cli
    .command(
      'memory:mine-goldens',
      "Mine a stratified sample of a persona's memories for retrieval-eval goldens"
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--persona-id <uuid>', 'Persona UUID to mine (required)')
    .option('--personality-ids <csv>', 'Personality UUIDs to include (default: top 2 by count)')
    .option('--sample <n>', 'Target sample size (default 800)')
    .option('--out <dir>', 'Output dir (default reports/goldens-mining — gitignored)')
    .action(
      async (options: {
        env?: Environment;
        personaId?: string;
        personalityIds?: string;
        sample?: string;
        out?: string;
      }) => {
        if (options.personaId === undefined) {
          console.error('--persona-id is required');
          process.exitCode = 1;
          return;
        }
        // Fail loudly on a garbage --sample: NaN comparisons are all false, so
        // it would otherwise degrade into nonsense quota math silently.
        const sampleSize = options.sample === undefined ? undefined : Number(options.sample);
        if (sampleSize !== undefined && (!Number.isInteger(sampleSize) || sampleSize < 1)) {
          console.error(`--sample must be a positive integer (got '${options.sample}')`);
          process.exitCode = 1;
          return;
        }
        const { mineGoldens } = await import('../memory/mine-goldens.js');
        await mineGoldens({
          env: options.env ?? 'dev',
          personaId: options.personaId,
          personalityIds: options.personalityIds
            ?.split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0),
          sampleSize,
          outDir: options.out,
        });
      }
    );

  cli
    .command(
      'memory:anonymize-goldens',
      'Apply an owner-reviewed swap map to the mined corpus (emits the LOCAL, gitignored eval corpus)'
    )
    .option('--in <dir>', 'Working dir with corpus-raw.json (default reports/goldens-mining)')
    .option(
      '--swap-map <file>',
      'Reviewed swap-map filename in the working dir (default swap-map.json)'
    )
    .option('--out <file>', 'Output file (default reports/goldens-mining/retrieval-corpus.json)')
    .action(async (options: { in?: string; swapMap?: string; out?: string }) => {
      const { anonymizeGoldens } = await import('../memory/goldens-anonymize.js');
      await anonymizeGoldens({
        inDir: options.in,
        swapMapFile: options.swapMap,
        outFile: options.out,
      });
    });
}

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
    .option('--to <date>', 'End date (YYYY-MM-DD, exclusive — use day after last desired date)')
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

  registerBackfillFactsCommand(cli);
  registerGoldensCommands(cli);

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
