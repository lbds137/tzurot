/**
 * Memory-related CLI commands
 *
 * Commands for analyzing and managing pgvector memories.
 */

import type { CAC } from 'cac';
import type { Environment } from '../utils/env-runner.js';
import { parseIntFlag } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';

const ENV_OPTION = '--env <env>';
const ENV_OPTION_DESC = 'Environment: local, dev, or prod';
const ENV_OPTION_DEFAULT = { default: 'dev' } as const;
const FORCE_OPTION_DESC = 'Skip production confirmation prompt';

// Shared by the three goldens miners (sonarjs/no-duplicate-string at 3 uses).
const PERSONA_OPTION = '--persona-id <uuid>';
const PERSONA_OPTION_DESC = 'Persona UUID to mine (required)';
const SAMPLE_OPTION = '--sample <n>';
const HISTORY_WINDOW_OPTION = '--history-window <n>';
const HISTORY_WINDOW_OPTION_DESC = 'Prior turns to capture per golden (default 50)';
const OUT_OPTION = '--out <dir>';
const OUT_OPTION_DESC = 'Output dir (default reports/goldens-mining — gitignored)';

/**
 * Parse an optional positive-integer CLI flag. Returns the number, or
 * `undefined` when the flag is absent so the caller's default still applies;
 * throws a `UsageError` when the flag is present but not a positive integer.
 *
 * Exists to name the `{ min: 1 }` range every numeric flag in this file
 * shares, over the shared `parseIntFlag`.
 */
function parsePositiveIntOption(
  raw: string | number | undefined,
  flag: string
): number | undefined {
  return parseIntFlag(raw, flag, { min: 1 });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a required `--persona-id` UUID, throwing a `UsageError` when it is
 * absent or malformed. Catches a bad id before it hits a raw `::uuid` cast,
 * which would otherwise surface as a raw Postgres error instead of a clean
 * CLI message.
 */
function requirePersonaId(raw: string | undefined): string {
  if (raw === undefined) {
    throw new UsageError('--persona-id is required');
  }
  if (!UUID_RE.test(raw)) {
    throw new UsageError(`--persona-id must be a UUID (got '${raw}')`);
  }
  return raw;
}

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
    .option('--force', FORCE_OPTION_DESC)
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
        // A typo'd --limit must not fall through as NaN: this command's cap
        // exists to keep canary runs bounded, and `enqueued >= NaN` is always
        // false — the run would proceed uncapped over the whole backlog.
        const limit = parsePositiveIntOption(options.limit, '--limit');
        const windowSize = parsePositiveIntOption(options.windowSize, '--window-size');

        const { backfillFacts } = await import('../memory/backfill-facts.js');
        await backfillFacts({
          env: options.env ?? 'dev',
          dryRun: options.dryRun,
          limit,
          personalityId: options.personalityId,
          windowSize,
          includeCovered: options.includeCovered,
          force: options.force,
        });
      }
    );
}

/** Backward-only valid_from repair — facts stamp source-episode time, not extractor run time. */
function registerRepairFactTimestampsCommand(cli: CAC): void {
  cli
    .command(
      'memory:repair-fact-timestamps',
      'Rewrite memory_facts.valid_from to the newest source episode time (backward-only, idempotent)'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option('--dry-run', 'Report the repairable-row skew buckets without updating')
    .option('--force', FORCE_OPTION_DESC)
    .action(async (options: { env?: Environment; dryRun?: boolean; force?: boolean }) => {
      const { repairFactTimestamps } = await import('../memory/repair-fact-timestamps.js');
      await repairFactTimestamps({
        env: options.env ?? 'dev',
        dryRun: options.dryRun,
        force: options.force,
      });
    });
}

/** Goldens mining + anonymization — builds the retrieval-eval corpus from real persona data. */
function registerGoldensCommands(cli: CAC): void {
  cli
    .command(
      'memory:mine-goldens',
      "Mine a stratified sample of a persona's memories for retrieval-eval goldens"
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option(PERSONA_OPTION, PERSONA_OPTION_DESC)
    .option('--personality-ids <csv>', 'Personality UUIDs to include (default: top 2 by count)')
    .option(SAMPLE_OPTION, 'Target sample size (default 800)')
    .option(OUT_OPTION, OUT_OPTION_DESC)
    .action(
      async (options: {
        env?: Environment;
        personaId?: string;
        personalityIds?: string;
        sample?: string;
        out?: string;
      }) => {
        const personaId = requirePersonaId(options.personaId);
        // Fail loudly on a garbage --sample: NaN comparisons are all false, so
        // it would otherwise degrade into nonsense quota math silently.
        const sampleSize = parsePositiveIntOption(options.sample, '--sample');
        const { mineGoldens } = await import('../memory/mine-goldens.js');
        await mineGoldens({
          env: options.env ?? 'dev',
          personaId,
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

/** The attachment-goldens miner — additive to the conversation set (see mine-attachment-goldens.ts). */
function registerAttachmentGoldensCommand(cli: CAC): void {
  cli
    .command(
      'memory:mine-attachment-goldens',
      'Mine attachment-bearing user turns (image descriptions, voice transcripts) for the search-query allocation A/B'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option(PERSONA_OPTION, PERSONA_OPTION_DESC)
    .option(SAMPLE_OPTION, 'Target golden count across kinds (default 24)')
    .option(HISTORY_WINDOW_OPTION, HISTORY_WINDOW_OPTION_DESC)
    .option(OUT_OPTION, OUT_OPTION_DESC)
    .action(
      async (options: {
        env?: Environment;
        personaId?: string;
        sample?: string;
        historyWindow?: string;
        out?: string;
      }) => {
        const personaId = requirePersonaId(options.personaId);
        const sampleSize = parsePositiveIntOption(options.sample, '--sample');
        const historyWindow = parsePositiveIntOption(options.historyWindow, '--history-window');
        const { mineAttachmentGoldens } = await import('../memory/mine-attachment-goldens.js');
        await mineAttachmentGoldens({
          env: options.env ?? 'dev',
          personaId,
          sampleSize,
          historyWindow,
          outDir: options.out,
        });
      }
    );
}

/** The conversation-goldens miner — its own registrar so registerGoldensCommands stays under the line cap. */
function registerConversationGoldensCommand(cli: CAC): void {
  cli
    .command(
      'memory:mine-conversation-goldens',
      'Mine real user turns + their preceding conversation window (the fold input) for the retrieval re-baseline'
    )
    .option(ENV_OPTION, ENV_OPTION_DESC, ENV_OPTION_DEFAULT)
    .option(PERSONA_OPTION, PERSONA_OPTION_DESC)
    .option(SAMPLE_OPTION, 'Target golden count across all styles (default 40)')
    .option(HISTORY_WINDOW_OPTION, HISTORY_WINDOW_OPTION_DESC)
    .option(OUT_OPTION, OUT_OPTION_DESC)
    .action(
      async (options: {
        env?: Environment;
        personaId?: string;
        sample?: string;
        historyWindow?: string;
        out?: string;
      }) => {
        const personaId = requirePersonaId(options.personaId);
        const sampleSize = parsePositiveIntOption(options.sample, '--sample');
        const historyWindow = parsePositiveIntOption(options.historyWindow, '--history-window');
        const { mineConversationGoldens } = await import('../memory/mine-conversation-goldens.js');
        await mineConversationGoldens({
          env: options.env ?? 'dev',
          personaId,
          sampleSize,
          historyWindow,
          outDir: options.out,
        });
      }
    );
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
    .option('--force', FORCE_OPTION_DESC)
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
          throw new UsageError('--from and --to are required');
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
  registerRepairFactTimestampsCommand(cli);
  registerGoldensCommands(cli);
  registerConversationGoldensCommand(cli);
  registerAttachmentGoldensCommand(cli);

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
