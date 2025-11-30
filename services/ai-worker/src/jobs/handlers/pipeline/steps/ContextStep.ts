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

export class ContextStep implements IPipelineStep {
  readonly name = 'ContextPreparation';

  process(context: GenerationContext): GenerationContext {
    const { job, config } = context;
    const { personality, context: jobContext } = job.data;

    if (!config) {
      throw new Error('[ContextStep] ConfigStep must run before ContextStep');
    }

    // Calculate oldest timestamp from conversation history (for LTM deduplication)
    let oldestHistoryTimestamp: number | undefined;
    if (jobContext.conversationHistory && jobContext.conversationHistory.length > 0) {
      const timestamps = jobContext.conversationHistory
        .map(msg =>
          msg.createdAt !== undefined && msg.createdAt.length > 0
            ? new Date(msg.createdAt).getTime()
            : null
        )
        .filter((t): t is number => t !== null);

      if (timestamps.length > 0) {
        oldestHistoryTimestamp = Math.min(...timestamps);
        logger.debug(
          { jobId: job.id, oldestTimestamp: new Date(oldestHistoryTimestamp).toISOString() },
          '[ContextStep] Oldest conversation message timestamp'
        );
      }
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

    const preparedContext: PreparedContext = {
      conversationHistory,
      rawConversationHistory: jobContext.conversationHistory ?? [],
      oldestHistoryTimestamp,
      participants: allParticipants,
    };

    logger.debug(
      {
        jobId: job.id,
        historyLength: conversationHistory.length,
        participantCount: allParticipants.length,
      },
      '[ContextStep] Context prepared'
    );

    return {
      ...context,
      preparedContext,
    };
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
