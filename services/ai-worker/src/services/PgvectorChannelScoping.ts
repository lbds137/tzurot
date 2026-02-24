/**
 * Pgvector Channel Scoping
 * Waterfall query strategy for channel-scoped memory retrieval
 */

import { AI_DEFAULTS, filterValidDiscordIds, createLogger } from '@tzurot/common-types';
import type { MemoryQueryOptions, MemoryDocument } from './PgvectorTypes.js';

const logger = createLogger('PgvectorChannelScoping');

/** Callback type for the underlying memory query function */
export type QueryMemoriesFn = (
  query: string,
  options: MemoryQueryOptions
) => Promise<MemoryDocument[]>;

/**
 * Query memories with channel scoping using the "waterfall" method
 *
 * When channelIds are provided, this method:
 * 1. First queries memories from the specified channels (up to channelBudgetRatio of limit)
 * 2. Then backfills with global semantic search (excluding already-found IDs)
 * 3. Returns combined results with channel-scoped memories first
 *
 * This ensures users get relevant channel-specific context when they reference
 * channels (e.g., "remember what we talked about in #gaming") while still
 * including semantically relevant memories from other contexts.
 *
 * @param queryFn - The underlying query function to delegate to
 * @param query - The search query text
 * @param options - Query options including channelIds for scoping
 * @returns Combined memories from channel-scoped and global searches
 */
export async function waterfallMemoryQuery(
  queryFn: QueryMemoriesFn,
  query: string,
  options: MemoryQueryOptions
): Promise<MemoryDocument[]> {
  const totalLimit = options.limit ?? 10;
  // Clamp channelBudgetRatio to valid 0-1 range to prevent invalid budget calculations
  const rawRatio = options.channelBudgetRatio ?? AI_DEFAULTS.CHANNEL_MEMORY_BUDGET_RATIO;
  const channelBudgetRatio = Math.max(0, Math.min(1, rawRatio));

  // If no channels specified, just do a normal query
  if (!options.channelIds || options.channelIds.length === 0) {
    return queryFn(query, options);
  }

  // Validate channel IDs to prevent SQL injection (Discord snowflakes are 17-19 digit strings)
  const validChannelIds = filterValidDiscordIds(options.channelIds);
  if (validChannelIds.length === 0) {
    logger.warn(
      { originalChannelIds: options.channelIds },
      '[PgvectorChannelScoping] No valid Discord channel IDs provided, falling back to global query'
    );
    return queryFn(query, { ...options, channelIds: undefined });
  }

  if (validChannelIds.length < options.channelIds.length) {
    logger.warn(
      {
        original: options.channelIds.length,
        valid: validChannelIds.length,
        filtered: options.channelIds.filter(id => !validChannelIds.includes(id)),
      },
      '[PgvectorChannelScoping] Some channel IDs filtered out as invalid'
    );
  }

  // Ensure at least 1 channel-scoped memory when channels are specified
  // (prevents edge case where totalLimit=1, ratio=0.5 → channelBudget=0)
  const channelBudget = Math.max(1, Math.floor(totalLimit * channelBudgetRatio));

  logger.debug(
    {
      channelIds: validChannelIds,
      totalLimit,
      channelBudget,
      channelBudgetRatio,
    },
    '[PgvectorChannelScoping] Starting waterfall query with channel scoping'
  );

  // Step 1: Query channel-scoped memories first
  let channelResults: MemoryDocument[] = [];
  try {
    channelResults = await queryFn(query, {
      ...options,
      channelIds: validChannelIds,
      limit: channelBudget,
    });

    logger.debug(
      { channelResultCount: channelResults.length, channelBudget },
      '[PgvectorChannelScoping] Channel-scoped query complete'
    );
  } catch (error) {
    logger.error(
      { err: error, channelIds: validChannelIds },
      '[PgvectorChannelScoping] Channel-scoped query failed, continuing with global only'
    );
    // Continue to global query - better to return some results than none
  }

  // Step 2: Calculate remaining budget and get IDs to exclude
  const remainingBudget = totalLimit - channelResults.length;
  const excludeIds = channelResults
    .map(r => r.metadata?.id as string | null | undefined)
    .filter((id): id is string => id !== undefined && id !== null);

  // Step 3: Global semantic query with exclusion (no channel filter)
  let globalResults: MemoryDocument[] = [];
  if (remainingBudget > 0) {
    try {
      globalResults = await queryFn(query, {
        ...options,
        channelIds: undefined, // Remove channel filter for global search
        limit: remainingBudget,
        excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
      });

      logger.debug(
        { globalResultCount: globalResults.length, remainingBudget },
        '[PgvectorChannelScoping] Global backfill query complete'
      );
    } catch (error) {
      logger.error({ err: error }, '[PgvectorChannelScoping] Global backfill query failed');
      // Return channel results only if global fails
    }
  }

  // Step 4: Combine results (channel-scoped first for prominence)
  const combinedResults = [...channelResults, ...globalResults];

  logger.info(
    {
      totalResults: combinedResults.length,
      channelScoped: channelResults.length,
      globalBackfill: globalResults.length,
      channelIds: validChannelIds,
    },
    '[PgvectorChannelScoping] Waterfall query complete'
  );

  return combinedResults;
}
