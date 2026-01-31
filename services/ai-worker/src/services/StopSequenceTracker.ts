/**
 * Stop Sequence Tracker
 *
 * Tracks stop sequence activations in memory for diagnostics.
 * Helps validate which stop sequences are actually useful vs unnecessary.
 *
 * Features:
 * - In-memory scoreboard (counts since last restart)
 * - Structured logging for Railway log search
 * - Stats endpoint for admin commands
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('StopSequenceTracker');

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
}
