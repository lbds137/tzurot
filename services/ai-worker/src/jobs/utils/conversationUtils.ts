/**
 * Conversation Utilities
 *
 * Helper functions for processing conversation history and participants
 */

import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { MessageRole, formatRelativeTime, createLogger } from '@tzurot/common-types';

const logger = createLogger('conversationUtils');

/**
 * Participant information extracted from conversation history
 */
export interface Participant {
  personaId: string;
  personaName: string;
  isActive: boolean;
}

/**
 * Extract unique participants from conversation history
 * Returns list of all personas involved in the conversation
 */
export function extractParticipants(
  history: {
    role: MessageRole;
    content: string;
    personaId?: string;
    personaName?: string;
  }[],
  activePersonaId?: string,
  activePersonaName?: string
): Participant[] {
  const uniquePersonas = new Map<string, string>(); // personaId -> personaName

  const userMessagesWithPersona = history.filter(
    m =>
      m.role === MessageRole.User &&
      m.personaId !== undefined &&
      m.personaId.length > 0 &&
      m.personaName !== undefined &&
      m.personaName.length > 0
  ).length;
  logger.debug(
    `[conversationUtils] Extracting participants: activePersonaId=${activePersonaId ?? 'undefined'}, activePersonaName=${activePersonaName ?? 'undefined'}, historyLength=${history.length}, userMessagesWithPersona=${userMessagesWithPersona}`
  );

  // Extract from history
  for (const msg of history) {
    if (
      msg.role === MessageRole.User &&
      msg.personaId !== undefined &&
      msg.personaId.length > 0 &&
      msg.personaName !== undefined &&
      msg.personaName.length > 0
    ) {
      uniquePersonas.set(msg.personaId, msg.personaName);
    }
  }

  // Ensure active persona is included (even if not in history yet)
  if (
    activePersonaId !== undefined &&
    activePersonaId.length > 0 &&
    activePersonaName !== undefined &&
    activePersonaName.length > 0
  ) {
    uniquePersonas.set(activePersonaId, activePersonaName);
  }

  // Single summary log instead of per-iteration logging
  if (uniquePersonas.size > 0) {
    const participantNames = Array.from(uniquePersonas.values()).join(', ');
    logger.debug(
      `[conversationUtils] Found ${uniquePersonas.size} participant(s): ${participantNames}`
    );
  }

  // Convert to array with isActive flag
  return Array.from(uniquePersonas.entries()).map(([personaId, personaName]) => ({
    personaId,
    personaName,
    isActive: personaId === activePersonaId,
  }));
}

/**
 * Convert simple conversation history to LangChain BaseMessage format
 * Includes persona names to help the AI understand who is speaking
 */
export function convertConversationHistory(
  history: {
    role: MessageRole;
    content: string;
    createdAt?: string;
    personaId?: string;
    personaName?: string;
  }[],
  personalityName: string
): BaseMessage[] {
  return history.map(msg => {
    // Format message with speaker name and timestamp
    let content = msg.content;

    // For user messages, include persona name and timestamp
    if (msg.role === MessageRole.User) {
      const parts: string[] = [];

      if (msg.personaName !== undefined && msg.personaName.length > 0) {
        parts.push(`${msg.personaName}:`);
      }

      if (msg.createdAt !== undefined && msg.createdAt.length > 0) {
        parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
      }

      if (parts.length > 0) {
        content = `${parts.join(' ')} ${msg.content}`;
      }
    }

    // For assistant messages, include personality name and timestamp
    if (msg.role === MessageRole.Assistant) {
      const parts: string[] = [];

      // Use the personality name (e.g., "Lilith")
      parts.push(`${personalityName}:`);

      if (msg.createdAt !== undefined && msg.createdAt.length > 0) {
        parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
      }

      content = `${parts.join(' ')} ${msg.content}`;
    }

    if (msg.role === MessageRole.User) {
      return new HumanMessage(content);
    } else if (msg.role === MessageRole.Assistant) {
      return new AIMessage(content);
    } else {
      // System messages are handled separately in the prompt
      return new HumanMessage(content);
    }
  });
}
