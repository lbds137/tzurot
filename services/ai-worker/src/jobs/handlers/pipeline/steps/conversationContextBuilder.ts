/**
 * Conversation Context Builder
 *
 * Builds the ConversationContext from job data and prepared pipeline state.
 * Extracted from GenerationStep to keep file under max-lines limit.
 */

import type { LLMGenerationJobData } from '@tzurot/common-types';
import type { ConversationContext } from '../../../../services/ConversationalRAGTypes.js';
import type { PreparedContext, PreprocessingResults } from '../types.js';

/** Build the conversation context for RAG service */
export function buildConversationContext(
  jobContext: LLMGenerationJobData['context'],
  preparedContext: PreparedContext,
  preprocessing: PreprocessingResults | undefined
): ConversationContext {
  return {
    userId: jobContext.userId,
    userName: jobContext.userName,
    userTimezone: jobContext.userTimezone,
    channelId: jobContext.channelId,
    serverId: jobContext.serverId,
    sessionId: jobContext.sessionId,
    isProxyMessage: jobContext.isProxyMessage,
    isWeighIn: jobContext.isWeighIn,
    activePersonaId: jobContext.activePersonaId,
    activePersonaName: jobContext.activePersonaName,
    // Guild-specific info for participants (roles, color, join date)
    activePersonaGuildInfo: jobContext.activePersonaGuildInfo,
    participantGuildInfo: jobContext.participantGuildInfo,
    conversationHistory: preparedContext.conversationHistory,
    rawConversationHistory: preparedContext.rawConversationHistory,
    oldestHistoryTimestamp: preparedContext.oldestHistoryTimestamp,
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
