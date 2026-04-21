/**
 * Context Step
 *
 * Prepares conversation context: history conversion, participant extraction,
 * and oldest timestamp calculation for LTM deduplication.
 */

import { createLogger } from '@tzurot/common-types';
import {
  extractParticipants,
  convertConversationHistory,
} from '../../../utils/conversationUtils.js';
import type { IPipelineStep, GenerationContext, Participant, PreparedContext } from '../types.js';

const logger = createLogger('ContextStep');

/**
 * Extract timestamp from various formats (ISO string, Date object, or undefined)
 * Handles data from both DB history (string after JSON serialization) and
 * any unexpected Date objects that might bypass serialization.
 *
 * @param timestamp - ISO string, Date object, or undefined
 * @returns Unix timestamp in milliseconds, or null if invalid/missing
 */
function extractTimestamp(timestamp: string | Date | undefined | null): number | null {
  if (timestamp === undefined || timestamp === null) {
    return null;
  }

  // Handle Date objects directly (defensive - should be strings after BullMQ serialization)
  if (timestamp instanceof Date) {
    const time = timestamp.getTime();
    return Number.isNaN(time) ? null : time;
  }

  // Handle string timestamps (expected case - ISO format from toISOString())
  if (typeof timestamp === 'string' && timestamp.length > 0) {
    const time = new Date(timestamp).getTime();
    return Number.isNaN(time) ? null : time;
  }

  return null;
}

export class ContextStep implements IPipelineStep {
  readonly name = 'ContextPreparation';

  process(context: GenerationContext): GenerationContext {
    const { job, config } = context;
    const { personality, context: jobContext } = job.data;

    if (!config) {
      throw new Error('[ContextStep] ConfigStep must run before ContextStep');
    }

    // Calculate oldest timestamp from conversation history AND referenced messages
    // (for LTM deduplication - prevents verbatim repetition when replying to AI messages)
    let oldestHistoryTimestamp: number | undefined;
    const allTimestamps: number[] = [];

    // Timestamps from conversation history
    // Note: createdAt may be ISO string (after BullMQ serialization) or Date object
    if (jobContext.conversationHistory && jobContext.conversationHistory.length > 0) {
      const historyTimestamps = jobContext.conversationHistory
        .map(msg => extractTimestamp(msg.createdAt as string | Date | undefined))
        .filter((t): t is number => t !== null);
      allTimestamps.push(...historyTimestamps);

      // Log diagnostic if we found fewer timestamps than messages
      if (historyTimestamps.length < jobContext.conversationHistory.length) {
        logger.warn(
          {
            jobId: job.id,
            historyLength: jobContext.conversationHistory.length,
            validTimestamps: historyTimestamps.length,
            missingTimestamps: jobContext.conversationHistory.length - historyTimestamps.length,
          },
          'Some conversation history messages missing valid createdAt timestamps'
        );
      }
    }

    // Timestamps from referenced messages (replies, message links)
    // These should also be excluded from LTM to prevent the AI from echoing
    // the content of messages being replied to
    if (jobContext.referencedMessages && jobContext.referencedMessages.length > 0) {
      const refTimestamps = jobContext.referencedMessages
        .map(ref => extractTimestamp(ref.timestamp as string | Date | undefined))
        .filter((t): t is number => t !== null);
      allTimestamps.push(...refTimestamps);
    }

    // Timestamps from cross-channel history (also excluded from LTM deduplication)
    if (jobContext.crossChannelHistory && jobContext.crossChannelHistory.length > 0) {
      for (const group of jobContext.crossChannelHistory) {
        const crossTimestamps = group.messages
          .map(msg => extractTimestamp(msg.createdAt))
          .filter((t): t is number => t !== null);
        allTimestamps.push(...crossTimestamps);
      }
    }

    if (allTimestamps.length > 0) {
      // Use reduce() instead of spread to avoid potential stack overflow with large arrays
      oldestHistoryTimestamp = allTimestamps.reduce((min, ts) => Math.min(min, ts), Infinity);
      logger.debug(
        { jobId: job.id, oldestTimestamp: new Date(oldestHistoryTimestamp).toISOString() },
        'Oldest timestamp (includes referenced and cross-channel messages)'
      );
    }

    // Extract unique participants BEFORE converting to BaseMessage
    const participants = extractParticipants(
      jobContext.conversationHistory ?? [],
      jobContext.activePersonaId,
      jobContext.activePersonaName
    );

    // Add mentioned personas to participants (if not already present)
    const allParticipants = this.mergeParticipants(participants, jobContext.mentionedPersonas);

    // Convert conversation history to BaseMessage format
    const conversationHistory = convertConversationHistory(
      jobContext.conversationHistory ?? [],
      personality.name
    );

    // Pass cross-channel history through to pipeline (structurally compatible)
    const crossChannelHistory = jobContext.crossChannelHistory;

    const preparedContext: PreparedContext = {
      conversationHistory,
      rawConversationHistory: jobContext.conversationHistory ?? [],
      oldestHistoryTimestamp,
      participants: allParticipants,
      crossChannelHistory,
    };

    // Race-window telemetry: if the bot-client queried DB for history BEFORE
    // the previous assistant response finished persisting, the cross-turn
    // duplicate detector will compare against stale history and miss genuine
    // duplicates. Log the delta between job-creation time and the newest
    // assistant message's persisted timestamp. Negative/small deltas are the
    // signal we'd expect to see when a rapid user follow-up races the write.
    this.logRaceWindowTelemetry(job, jobContext.conversationHistory ?? []);

    logger.debug(
      {
        jobId: job.id,
        historyLength: conversationHistory.length,
        participantCount: allParticipants.length,
      },
      'Context prepared'
    );

    return {
      ...context,
      preparedContext,
    };
  }

  /**
   * Emit telemetry on the delta between job creation time and the newest
   * prior assistant response's persisted `createdAt` in the history snapshot.
   *
   * Two distinct scenarios we want to diagnose post-hoc:
   *
   * 1. **Barely-post-persistence**: `deltaMs < 500ms`. Job created just
   *    after persistence completed. Timing-suspicious; logged at `warn`
   *    so it's grep-able.
   *
   * 2. **Pre-persistence race (primary failure mode)**: the bot's prior
   *    response was NOT persisted before the history query ran, so it's
   *    absent from `history` entirely. `newestAssistantTimestamp` here
   *    reflects an OLDER message — typically minutes ago — and `deltaMs`
   *    is LARGE, not small. The `warn` threshold won't fire for this
   *    case. But the logged `newestAssistantTimestamp` itself is the
   *    signal: if a user reports a duplicate and we see the "most recent"
   *    assistant message in history is from many minutes ago even though
   *    the bot just responded, the race happened.
   *
   * For that reason this emits at `info` level in the non-race case too
   * — we want the data available for post-hoc correlation, not stuck
   * behind debug-level filtering.
   */
  private logRaceWindowTelemetry(
    job: { id?: string | number; timestamp?: number },
    history: { role: string; createdAt?: string | Date }[]
  ): void {
    if (history.length === 0) {
      return;
    }

    let newestAssistantTimestamp: number | null = null;
    for (const msg of history) {
      if (msg.role.toLowerCase() !== 'assistant') {
        continue;
      }
      const ts = extractTimestamp(msg.createdAt);
      if (ts !== null && (newestAssistantTimestamp === null || ts > newestAssistantTimestamp)) {
        newestAssistantTimestamp = ts;
      }
    }

    if (newestAssistantTimestamp === null) {
      return;
    }

    const jobTimestamp = job.timestamp;
    if (jobTimestamp === undefined) {
      return;
    }

    const deltaMs = jobTimestamp - newestAssistantTimestamp;
    // Distinguish three cases:
    //   deltaMs < 0    → clock skew (job timestamp before persisted timestamp);
    //                    shouldn't happen in practice (BullMQ + Postgres
    //                    colocated on Railway) but triage needs it labeled
    //                    separately if it ever does.
    //   0 ≤ deltaMs < 500 → race-suspect (job created shortly after persistence).
    //   deltaMs ≥ 500     → normal; emitted at info for post-hoc correlation
    //                        on the pre-persistence race (where the "newest"
    //                        assistant message would reflect a much older turn).
    const suggestsClockSkew = deltaMs < 0;
    const suggestsRace = !suggestsClockSkew && deltaMs < 500;

    if (suggestsClockSkew) {
      logger.warn(
        {
          jobId: job.id,
          jobTimestamp: new Date(jobTimestamp).toISOString(),
          newestAssistantTimestamp: new Date(newestAssistantTimestamp).toISOString(),
          deltaMs,
          suggestsClockSkew,
        },
        `Clock-skew signal: job timestamp is ${Math.abs(deltaMs)}ms BEFORE the ` +
          `newest assistant message's persisted timestamp. Not a race condition — a clock or ` +
          `data-source mismatch worth investigating.`
      );
    } else if (suggestsRace) {
      logger.warn(
        {
          jobId: job.id,
          jobTimestamp: new Date(jobTimestamp).toISOString(),
          newestAssistantTimestamp: new Date(newestAssistantTimestamp).toISOString(),
          deltaMs,
          suggestsRace,
        },
        `Race-window signal: job created ${deltaMs}ms after newest assistant message persisted. ` +
          `Cross-turn duplicate detector may miss prior response.`
      );
    } else {
      logger.info(
        {
          jobId: job.id,
          jobTimestamp: new Date(jobTimestamp).toISOString(),
          newestAssistantTimestamp: new Date(newestAssistantTimestamp).toISOString(),
          deltaMs,
          suggestsRace,
        },
        'Race-window telemetry'
      );
    }
  }

  /**
   * Merge mentioned personas into participant list
   */
  private mergeParticipants(
    participants: Participant[],
    mentionedPersonas?: { personaId: string; personaName: string }[]
  ): Participant[] {
    if (!mentionedPersonas || mentionedPersonas.length === 0) {
      return participants;
    }

    const existingIds = new Set(participants.map(p => p.personaId));
    const mentionedParticipants = mentionedPersonas
      .filter(mentioned => !existingIds.has(mentioned.personaId))
      .map(mentioned => ({
        personaId: mentioned.personaId,
        personaName: mentioned.personaName,
        isActive: false,
      }));

    if (mentionedParticipants.length > 0) {
      return [...participants, ...mentionedParticipants];
    }

    return participants;
  }
}
