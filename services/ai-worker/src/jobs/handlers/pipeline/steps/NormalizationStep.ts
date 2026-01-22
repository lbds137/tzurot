/**
 * Normalization Step
 *
 * Normalizes job data types after validation passes.
 * Handles legacy data formats and ensures consistent types for downstream steps.
 *
 * This step addresses type contract mismatches across service boundaries:
 * - Roles: Legacy "User"/"Assistant" → lowercase "user"/"assistant"
 * - Timestamps: Date objects (from Discord.js) → ISO strings (after BullMQ serialization)
 *
 * Runs after ValidationStep to ensure the data structure is valid before normalization.
 */

import { createLogger, normalizeRole, normalizeTimestamp, MessageRole } from '@tzurot/common-types';
import type { IPipelineStep, GenerationContext } from '../types.js';

const logger = createLogger('NormalizationStep');

/** Stats returned by normalization helpers */
interface NormalizationStats {
  roleNormalizations: number;
  timestampNormalizations: number;
}

export class NormalizationStep implements IPipelineStep {
  readonly name = 'Normalization';

  process(context: GenerationContext): GenerationContext {
    const { job } = context;
    const { conversationHistory, referencedMessages } = job.data.context;

    // Normalize conversation history and referenced messages
    const historyStats = this.normalizeConversationHistory(conversationHistory, job.id);
    const refStats = this.normalizeReferencedMessages(referencedMessages);

    // Combine stats
    const roleNormalizations = historyStats.roleNormalizations;
    const timestampNormalizations =
      historyStats.timestampNormalizations + refStats.timestampNormalizations;

    // Log if any normalizations occurred (helps track legacy data)
    if (roleNormalizations > 0 || timestampNormalizations > 0) {
      logger.info(
        {
          jobId: job.id,
          roleNormalizations,
          timestampNormalizations,
          historyLength: conversationHistory?.length ?? 0,
        },
        '[NormalizationStep] Normalized legacy data formats'
      );
    } else {
      logger.debug({ jobId: job.id }, '[NormalizationStep] No normalization needed');
    }

    return context;
  }

  /**
   * Normalize conversation history messages in place.
   * Handles role capitalization and timestamp format variations.
   */
  private normalizeConversationHistory(
    conversationHistory: GenerationContext['job']['data']['context']['conversationHistory'],
    jobId: string | undefined
  ): NormalizationStats {
    const stats: NormalizationStats = { roleNormalizations: 0, timestampNormalizations: 0 };

    if (!conversationHistory || conversationHistory.length === 0) {
      return stats;
    }

    for (const msg of conversationHistory) {
      // Normalize role
      const roleResult = this.normalizeMessageRole(msg, jobId);
      stats.roleNormalizations += roleResult;

      // Normalize timestamp
      const timestampResult = this.normalizeMessageTimestamp(msg);
      stats.timestampNormalizations += timestampResult;
    }

    return stats;
  }

  /**
   * Normalize a single message's role, returning 1 if normalized, 0 otherwise.
   */
  private normalizeMessageRole(
    msg: { role: string | MessageRole },
    jobId: string | undefined
  ): number {
    try {
      const originalRole = String(msg.role);
      const normalizedRole = normalizeRole(originalRole);
      // Compare as strings to avoid unsafe enum comparison lint error
      if (originalRole !== String(normalizedRole)) {
        (msg as { role: MessageRole }).role = normalizedRole;
        return 1;
      }
    } catch (error) {
      logger.warn(
        {
          jobId,
          originalRole: msg.role,
          error: error instanceof Error ? error.message : String(error),
        },
        '[NormalizationStep] Failed to normalize role, leaving as-is'
      );
    }
    return 0;
  }

  /**
   * Normalize a single message's timestamp, returning 1 if normalized, 0 otherwise.
   */
  private normalizeMessageTimestamp(msg: { createdAt?: string }): number {
    if (msg.createdAt === undefined) {
      return 0;
    }

    const originalValue = msg.createdAt;
    const normalizedTimestamp = normalizeTimestamp(
      originalValue as unknown as Date | string | undefined
    );

    if (normalizedTimestamp !== undefined && originalValue !== normalizedTimestamp) {
      (msg as { createdAt?: string }).createdAt = normalizedTimestamp;
      return 1;
    }

    return 0;
  }

  /**
   * Normalize referenced message timestamps in place.
   */
  private normalizeReferencedMessages(
    referencedMessages: GenerationContext['job']['data']['context']['referencedMessages']
  ): NormalizationStats {
    const stats: NormalizationStats = { roleNormalizations: 0, timestampNormalizations: 0 };

    if (!referencedMessages || referencedMessages.length === 0) {
      return stats;
    }

    for (const ref of referencedMessages) {
      if (ref.timestamp !== undefined) {
        const normalizedTimestamp = normalizeTimestamp(
          ref.timestamp as unknown as Date | string | undefined
        );
        if (normalizedTimestamp !== undefined && ref.timestamp !== normalizedTimestamp) {
          (ref as { timestamp: string }).timestamp = normalizedTimestamp;
          stats.timestampNormalizations++;
        }
      }
    }

    return stats;
  }
}
