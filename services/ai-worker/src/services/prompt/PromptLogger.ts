/**
 * Prompt Logger
 *
 * Detailed prompt assembly logging for development mode.
 * Extracted from PromptBuilder to reduce file size.
 */

import { createLogger, formatMemoryTimestamp, TEXT_LIMITS, getConfig } from '@tzurot/common-types';
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
} from '../ConversationalRAGTypes.js';

const logger = createLogger('PromptBuilder');
const config = getConfig();

/** Options for detailed prompt assembly logging */
export interface PromptAssemblyLogOptions {
  personality: { id: string; name: string };
  persona: string;
  protocol: string;
  participantPersonas: Map<string, ParticipantInfo>;
  participantsContext: string;
  context: ConversationContext;
  relevantMemories: MemoryDocument[];
  memoryContext: string;
  historyLength: number;
  fullSystemPrompt: string;
}

/**
 * Log detailed prompt assembly info in development mode.
 */
export function logDetailedPromptAssembly(opts: PromptAssemblyLogOptions): void {
  if (config.NODE_ENV !== 'development') {
    return;
  }

  const {
    personality,
    persona,
    protocol,
    participantPersonas,
    participantsContext,
    context,
    relevantMemories,
    memoryContext,
    historyLength,
    fullSystemPrompt,
  } = opts;

  logger.debug(
    {
      personalityId: personality.id,
      personalityName: personality.name,
      personaLength: persona.length,
      protocolLength: protocol.length,
      participantCount: participantPersonas.size,
      participantsContextLength: participantsContext.length,
      activePersonaName: context.activePersonaName,
      memoryCount: relevantMemories.length,
      memoryIds: relevantMemories.map(m =>
        m.metadata?.id !== undefined && typeof m.metadata.id === 'string'
          ? m.metadata.id
          : 'unknown'
      ),
      memoryTimestamps: relevantMemories.map(m =>
        m.metadata?.createdAt !== undefined && m.metadata.createdAt !== null
          ? formatMemoryTimestamp(m.metadata.createdAt)
          : 'unknown'
      ),
      totalMemoryChars: memoryContext.length,
      historyLength,
      totalSystemPromptLength: fullSystemPrompt.length,
      stmCount: context.conversationHistory?.length ?? 0,
      stmOldestTimestamp:
        context.oldestHistoryTimestamp !== undefined &&
        context.oldestHistoryTimestamp !== null &&
        context.oldestHistoryTimestamp > 0
          ? formatMemoryTimestamp(context.oldestHistoryTimestamp)
          : null,
    },
    '[PromptBuilder] Detailed prompt assembly:'
  );

  // Show full prompt in debug mode (truncated to avoid massive logs)
  const maxPreviewLength = TEXT_LIMITS.LOG_FULL_PROMPT;
  if (fullSystemPrompt.length <= maxPreviewLength) {
    logger.debug('[PromptBuilder] Full system prompt:\n' + fullSystemPrompt);
  } else {
    logger.debug(
      `[PromptBuilder] Full system prompt (showing first ${maxPreviewLength} chars):\n` +
        fullSystemPrompt.substring(0, maxPreviewLength) +
        `\n\n... [truncated ${fullSystemPrompt.length - maxPreviewLength} more chars]`
    );
  }
}

/**
 * Detect name collision between user's persona and personality name.
 *
 * A collision occurs when a user's display name matches the AI character's name,
 * which can cause confusion in conversations. When detected with a valid
 * discordUsername, we return collision info for disambiguation instructions.
 */
export function detectNameCollision(
  activePersonaName: string | undefined,
  discordUsername: string | undefined,
  personalityName: string,
  personalityId: string
): { userName: string; discordUsername: string } | undefined {
  const name = activePersonaName ?? '';
  const username = discordUsername ?? '';

  const namesMatch = name.length > 0 && name.toLowerCase() === personalityName.toLowerCase();

  if (!namesMatch) {
    return undefined;
  }

  // Collision detected but can't disambiguate without discordUsername
  if (username.length === 0) {
    logger.error(
      { personalityId, activePersonaName },
      '[PromptBuilder] Name collision detected but cannot add disambiguation instruction (discordUsername missing from context - check bot-client MessageContextBuilder)'
    );
    return undefined;
  }

  return { userName: name, discordUsername: username };
}
