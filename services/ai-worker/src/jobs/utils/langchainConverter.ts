/**
 * LangChain Converter Utilities
 *
 * Functions for converting conversation history to LangChain BaseMessage format.
 * Extracted from conversationUtils.ts for better modularity.
 */

import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { MessageRole, formatRelativeTime } from '@tzurot/common-types';
import { isRoleMatch } from './participantUtils.js';

/** Format user message with persona name and timestamp */
function formatUserMessageContent(
  content: string,
  personaName: string | undefined,
  createdAt: string | undefined
): string {
  const parts: string[] = [];
  if (personaName !== undefined && personaName.length > 0) {
    parts.push(`${personaName}:`);
  }
  if (createdAt !== undefined && createdAt.length > 0) {
    parts.push(`[${formatRelativeTime(createdAt)}]`);
  }
  return parts.length > 0 ? `${parts.join(' ')} ${content}` : content;
}

/** Format assistant message with personality name and timestamp */
function formatAssistantMessageContent(
  content: string,
  personalityName: string,
  createdAt: string | undefined
): string {
  const parts: string[] = [`${personalityName}:`];
  if (createdAt !== undefined && createdAt.length > 0) {
    parts.push(`[${formatRelativeTime(createdAt)}]`);
  }
  return `${parts.join(' ')} ${content}`;
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
    if (isRoleMatch(msg.role, MessageRole.User)) {
      const content = formatUserMessageContent(msg.content, msg.personaName, msg.createdAt);
      return new HumanMessage(content);
    }
    if (isRoleMatch(msg.role, MessageRole.Assistant)) {
      const content = formatAssistantMessageContent(msg.content, personalityName, msg.createdAt);
      return new AIMessage(content);
    }
    // System messages are handled separately in the prompt
    return new HumanMessage(msg.content);
  });
}
