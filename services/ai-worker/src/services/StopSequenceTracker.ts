/**
 * Stop Sequence Tracker
 *
 * Tracks stop sequence activations in memory and Redis for diagnostics.
 * Helps validate which stop sequences are actually useful vs unnecessary.
 *
 * Features:
 * - In-memory scoreboard (counts since last restart)
 * - Redis persistence (survives restarts, readable by gateway)
 * - Structured logging for Railway log search
 * - Stats endpoint for admin commands
 */

import { createLogger, isNaturalStop } from '@tzurot/common-types';
import type { Redis } from 'ioredis';

const logger = createLogger('StopSequenceTracker');

/** Redis key prefix for stop sequence stats */
const REDIS_KEYS = {
  TOTAL: 'stop_seq:total',
  BY_SEQUENCE: 'stop_seq:by_sequence',
  BY_MODEL: 'stop_seq:by_model',
  STARTED_AT: 'stop_seq:started_at',
} as const;

interface StopSequenceStats {
  /** Total activations since restart */
  totalActivations: number;
  /** Activations per sequence */
  bySequence: Map<string, number>;
  /** Activations per model */
  byModel: Map<string, number>;
  /** When tracking started (last restart) */
  startedAt: Date;
}

// In-memory stats - reset on restart
const stats: StopSequenceStats = {
  totalActivations: 0,
  bySequence: new Map(),
  byModel: new Map(),
  startedAt: new Date(),
};

// Optional Redis client for cross-service persistence
let redisClient: Redis | undefined;

/**
 * Initialize Redis persistence for stop sequence stats.
 * Call once at startup with the cache Redis client.
 */
export function initStopSequenceRedis(client: Redis): void {
  redisClient = client;
  // Set started_at only if not already set (preserves across restarts)
  client.setnx(REDIS_KEYS.STARTED_AT, new Date().toISOString()).catch(err => {
    logger.warn({ err }, '[StopSequenceTracker] Failed to set started_at in Redis');
  });
}

/**
 * Record a stop sequence activation.
 * Call this when a stop sequence triggers during LLM generation.
 *
 * @param sequence - The stop sequence that triggered (e.g., "\nUser:")
 * @param modelName - The model that was running (e.g., "deepseek/deepseek-r1")
 * @param requestId - Optional request ID for correlation
 */
export function recordStopSequenceActivation(
  sequence: string,
  modelName: string,
  requestId?: string
): void {
  // Update in-memory stats
  stats.totalActivations++;
  stats.bySequence.set(sequence, (stats.bySequence.get(sequence) ?? 0) + 1);
  stats.byModel.set(modelName, (stats.byModel.get(modelName) ?? 0) + 1);

  // Persist to Redis (fire-and-forget)
  if (redisClient !== undefined) {
    const pipeline = redisClient.pipeline();
    pipeline.incr(REDIS_KEYS.TOTAL);
    pipeline.hincrby(REDIS_KEYS.BY_SEQUENCE, sequence, 1);
    pipeline.hincrby(REDIS_KEYS.BY_MODEL, modelName, 1);
    pipeline.exec().catch(err => {
      logger.warn({ err }, '[StopSequenceTracker] Failed to persist stats to Redis');
    });
  }

  // Log with structured JSON for Railway log search
  // Search with: json.event="stop_sequence_triggered"
  logger.info(
    {
      event: 'stop_sequence_triggered',
      sequence,
      modelName,
      requestId,
      totalActivations: stats.totalActivations,
    },
    '[StopSequenceTracker] Stop sequence activated'
  );
}

/**
 * Get current stop sequence activation stats.
 * Used by admin commands to display the scoreboard.
 */
export function getStopSequenceStats(): {
  totalActivations: number;
  bySequence: Record<string, number>;
  byModel: Record<string, number>;
  uptimeMs: number;
  startedAt: string;
} {
  return {
    totalActivations: stats.totalActivations,
    bySequence: Object.fromEntries(stats.bySequence),
    byModel: Object.fromEntries(stats.byModel),
    uptimeMs: Date.now() - stats.startedAt.getTime(),
    startedAt: stats.startedAt.toISOString(),
  };
}

/**
 * Reset stats (mainly for testing).
 * @internal
 */
export function resetStopSequenceStats(): void {
  stats.totalActivations = 0;
  stats.bySequence.clear();
  stats.byModel.clear();
  stats.startedAt = new Date();

  // Also clear Redis keys if available
  if (redisClient !== undefined) {
    redisClient
      .del(REDIS_KEYS.TOTAL, REDIS_KEYS.BY_SEQUENCE, REDIS_KEYS.BY_MODEL, REDIS_KEYS.STARTED_AT)
      .catch(err => {
        logger.warn({ err }, '[StopSequenceTracker] Failed to clear Redis stats');
      });
  }
}

/**
 * Heuristic: infer whether a stop sequence likely fired based on content shape.
 * Returns true when the provider reported "stop" but the content doesn't end
 * with `</message>`, suggesting an earlier stop sequence truncated the response.
 * This is diagnostic-only — it never affects retries or filtering.
 *
 * Known false positive: a model that naturally finishes (finish_reason: "stop")
 * without emitting `</message>` will be flagged. Since this is diagnostic-only,
 * false positives are acceptable.
 */
export function inferNonXmlStop(
  content: string,
  finishReason: string,
  stopSequences: string[] | undefined
): boolean {
  return (
    isNaturalStop(finishReason) &&
    stopSequences !== undefined &&
    stopSequences.length > 0 &&
    !content.trimEnd().endsWith('</message>')
  );
}

/** Exported for testing */
export { REDIS_KEYS as STOP_SEQUENCE_REDIS_KEYS };
