/**
 * Conversation Context Builder
 *
 * Builds the ConversationContext from job data and prepared pipeline state.
 * Extracted from GenerationStep to keep file under max-lines limit.
 */

import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { resolveSummonAnonymity } from '@tzurot/common-types/types/summon-anonymity';
import type { ConversationContext } from '../../../../services/ConversationalRAGTypes.js';
import type { PreparedContext, PreprocessingResults } from '../types.js';

/** Build the conversation context for RAG service */
export function buildConversationContext(
  jobContext: LLMGenerationJobData['context'],
  preparedContext: PreparedContext,
  preprocessing: PreprocessingResults | undefined
): ConversationContext {
  // Resolve the personal-vs-incognito union once here so the memory consumers
  // (LTM read/write skip) switch on `summonAnonymity.kind` instead of each
  // re-deriving `incognito ?? isWeighIn`. A personal summon always carries its
  // persona (the worker assembler resolved it); if the wire id is somehow absent,
  // the resolver fail-safes to incognito rather than building a persona-less
  // personal arm.
  //
  // This agrees with the assembler's own resolveSummonAnonymity call by
  // construction: ContextStep.applyAssembledContext writes the assembler's
  // resolved activePersonaId onto jobContext BEFORE this step runs, so both see
  // the same id and resolve the same `kind`. The fail-safe therefore never fires
  // for a real personal summon — it can't diverge from the assembler. (If that
  // writeback is ever removed, the two calls could disagree on kind — keep them
  // in sync.)
  const summonAnonymity = resolveSummonAnonymity(jobContext, {
    activePersonaId: jobContext.activePersonaId,
    activePersonaName: jobContext.activePersonaName ?? null,
  });
  return {
    userId: jobContext.userId,
    userName: jobContext.userName,
    userTimezone: jobContext.userTimezone,
    channelId: jobContext.channelId,
    serverId: jobContext.serverId,
    sessionId: jobContext.sessionId,
    isProxyMessage: jobContext.isProxyMessage,
    triggerMessageId: jobContext.triggerMessageId,
    isWeighIn: jobContext.isWeighIn,
    summonAnonymity,
    activePersonaId: jobContext.activePersonaId,
    activePersonaName: jobContext.activePersonaName,
    // Guild-specific info for participants (roles, color, join date)
    activePersonaGuildInfo: jobContext.activePersonaGuildInfo,
    participantGuildInfo: jobContext.participantGuildInfo,
    conversationHistory: preparedContext.conversationHistory,
    rawConversationHistory: preparedContext.rawConversationHistory,
    oldestHistoryTimestamp: preparedContext.oldestHistoryTimestamp,
    nonHistoryOldestTimestamp: preparedContext.nonHistoryOldestTimestamp,
    participants: preparedContext.participants,
    attachments: jobContext.attachments,
    preprocessedAttachments:
      preprocessing && preprocessing.processedAttachments.length > 0
        ? preprocessing.processedAttachments
        : undefined,
    preprocessedReferenceAttachments:
      preprocessing && Object.keys(preprocessing.referenceAttachments).length > 0
        ? preprocessing.referenceAttachments
        : undefined,
    extendedContextAttachments: jobContext.extendedContextAttachments,
    preprocessedExtendedContextAttachments: preprocessing?.extendedContextAttachments,
    environment: jobContext.environment,
    referencedMessages: jobContext.referencedMessages,
    referencedChannels: jobContext.referencedChannels,
    crossChannelHistory: preparedContext.crossChannelHistory,
  };
}
