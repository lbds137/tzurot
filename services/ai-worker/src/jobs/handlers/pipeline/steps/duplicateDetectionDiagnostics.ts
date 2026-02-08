/**
 * Diagnostic logging for duplicate detection setup.
 *
 * Extracted from GenerationStep to reduce file size.
 * Logs anomalies when conversation history exists but no assistant messages are found.
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('GenerationStep');

interface DuplicateDetectionSetupOptions {
  jobId: string | undefined;
  rawConversationHistory?: { role: string }[];
  recentAssistantMessages: string[];
}

/**
 * Log diagnostic info for duplicate detection setup.
 * Warns when non-empty history contains zero assistant messages (anomaly).
 */
export function logDuplicateDetectionSetup(opts: DuplicateDetectionSetupOptions): void {
  const { jobId, rawConversationHistory, recentAssistantMessages } = opts;
  const historyLength = rawConversationHistory?.length ?? 0;

  if (historyLength > 0 && recentAssistantMessages.length === 0) {
    // Anomaly: history present but no assistant messages found
    const roleDistribution = (rawConversationHistory ?? []).reduce(
      (acc, msg) => {
        const role = String(msg.role);
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    logger.warn(
      {
        jobId,
        historyLength,
        recentAssistantMessages: recentAssistantMessages.length,
        roleDistribution,
        sampleRoles: rawConversationHistory?.slice(-3).map(m => ({
          role: m.role,
          roleType: typeof m.role,
        })),
      },
      '[GenerationStep] ANOMALY: No assistant messages extracted from non-empty history. ' +
        'Duplicate detection may fail!'
    );
  } else {
    logger.debug(
      {
        jobId,
        historyLength,
        recentAssistantMessages: recentAssistantMessages.length,
        recentMessagesPreview: recentAssistantMessages.slice(0, 2).map(m => m.substring(0, 50)),
      },
      '[GenerationStep] Duplicate detection ready'
    );
  }
}
