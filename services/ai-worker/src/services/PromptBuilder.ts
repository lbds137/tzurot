/**
 * Prompt Builder - Builds system prompts with personality info, memories, and context.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  createLogger,
  formatFullDateTime,
  formatMemoryTimestamp,
  TEXT_LIMITS,
  getConfig,
  type LoadedPersonality,
  type MessageContent,
  countTextTokens,
  escapeXmlContent,
} from '@tzurot/common-types';
import type { MemoryDocument, ConversationContext } from './ConversationalRAGService.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import { formatParticipantsContext } from './prompt/ParticipantFormatter.js';
import { formatMemoriesContext } from './prompt/MemoryFormatter.js';
import { formatPersonalityFields } from './prompt/PersonalityFieldsFormatter.js';

const logger = createLogger('PromptBuilder');
const config = getConfig();

/** Options for building a full system prompt */
export interface BuildFullSystemPromptOptions {
  personality: LoadedPersonality;
  participantPersonas: Map<string, { content: string; isActive: boolean }>;
  relevantMemories: MemoryDocument[];
  context: ConversationContext;
  referencedMessagesFormatted?: string;
  /** Descriptions of images from extended context (recent channel messages) */
  extendedContextDescriptions?: string;
  serializedHistory?: string;
}

export class PromptBuilder {
  /**
   * Build search query for memory retrieval
   *
   * Uses actual transcription/description for voice messages and images,
   * includes referenced message content for better memory recall,
   * and optionally includes recent conversation history for context-aware LTM search.
   *
   * The recentHistoryWindow solves the "pronoun problem" where users say things like
   * "what do you think about that?" - without context, LTM search can't find relevant memories.
   */
  buildSearchQuery(
    userMessage: string,
    processedAttachments: ProcessedAttachment[],
    referencedMessagesText?: string,
    recentHistoryWindow?: string
  ): string {
    const parts: string[] = [];

    // Add recent conversation history FIRST (provides context for ambiguous queries)
    // This helps resolve pronouns like "that", "it", "he" by embedding the recent topic
    if (recentHistoryWindow !== undefined && recentHistoryWindow.length > 0) {
      parts.push(recentHistoryWindow);
      logger.info(
        `[PromptBuilder] Including ${recentHistoryWindow.length} chars of recent history in memory search`
      );
    }

    // Add user message (if not just the "Hello" fallback)
    if (userMessage.trim().length > 0 && userMessage.trim() !== 'Hello') {
      parts.push(userMessage);
    }

    // Add attachment descriptions (voice transcriptions, image descriptions)
    if (processedAttachments.length > 0) {
      const descriptions = processedAttachments
        .map(a => a.description)
        .filter(d => d.length > 0 && !d.startsWith('['))
        .join('\n\n');

      if (descriptions.length > 0) {
        parts.push(descriptions);

        // Log when using voice transcription instead of "Hello"
        if (userMessage.trim() === 'Hello') {
          logger.info(
            '[PromptBuilder] Using voice transcription for memory search instead of "Hello" fallback'
          );
        }
      }
    }

    // Add referenced message content for semantic search
    if (referencedMessagesText !== undefined && referencedMessagesText.length > 0) {
      parts.push(referencedMessagesText);
      logger.info('[PromptBuilder] Including referenced message content in memory search query');
    }

    // If we have nothing, fall back to "Hello"
    if (parts.length === 0) {
      return userMessage.trim().length > 0 ? userMessage : 'Hello';
    }

    return parts.join('\n\n');
  }

  /**
   * Build human message with attachments and references
   *
   * For both images and voice messages, we use text descriptions instead of
   * raw media data. This matches how we handle conversation history and:
   * - Simplifies the code (no multimodal complexity)
   * - Reduces API costs (vision/audio APIs are expensive)
   * - Provides consistent behavior between current turn and history
   */
  buildHumanMessage(
    userMessage: string,
    processedAttachments: ProcessedAttachment[],
    activePersonaName?: string,
    referencedMessagesDescriptions?: string
  ): { message: HumanMessage; contentForStorage: string } {
    // Build the message content
    let messageContent = userMessage;

    if (processedAttachments.length > 0) {
      // Get text descriptions for all attachments
      const descriptions = processedAttachments
        .map(a => a.description)
        .filter(d => d.length > 0 && !d.startsWith('['))
        .join('\n\n');

      // For voice-only messages (no text), use transcription as primary message
      // For images or mixed content, combine with user message
      messageContent =
        userMessage.trim() === 'Hello' && descriptions.length > 0
          ? descriptions // Voice message with no text content
          : userMessage.trim().length > 0
            ? `${userMessage}\n\n${descriptions}` // Text + attachments
            : descriptions; // Attachments only

      logger.info(
        {
          attachmentCount: processedAttachments.length,
          hasUserText: userMessage.trim().length > 0 && userMessage !== 'Hello',
          attachmentTypes: processedAttachments.map(a => a.type),
        },
        'Built message with attachment descriptions'
      );
    }

    // Capture content BEFORE adding referenced messages
    // Storage should contain only semantic content (user message + attachment descriptions)
    // Referenced messages are stored structurally as ReferencedMessage[] and formatted at prompt time
    const contentForStorage = messageContent;

    // Append referenced messages (with vision/transcription already processed)
    // This is ONLY for the LLM prompt, NOT for storage
    if (referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0) {
      messageContent =
        messageContent.length > 0
          ? `${messageContent}\n\n${referencedMessagesDescriptions}`
          : referencedMessagesDescriptions;

      logger.info(
        {
          referencesLength: referencedMessagesDescriptions.length,
        },
        'Appended referenced messages to prompt (not storage)'
      );
    }

    // Wrap in <current_turn> XML for clear semantic structure
    // This is the "trigger" that tells the AI to respond
    // NOTE: This wrapper is ONLY for the LLM prompt, NOT for storage
    const senderName =
      activePersonaName !== undefined && activePersonaName.length > 0 ? activePersonaName : 'User';

    // Escape the message content to prevent XML injection
    const safeContent = escapeXmlContent(messageContent);

    const wrappedMessage = `<current_turn>
<incoming_message sender="${senderName}">
${safeContent}
</incoming_message>
<instruction>
Respond to ${senderName} now. Do not simulate other users. Stop after your response.
</instruction>
</current_turn>`;

    return {
      message: new HumanMessage(wrappedMessage),
      contentForStorage,
    };
  }

  /**
   * Build full system prompt with personas, memories, and date context
   *
   * NEW ARCHITECTURE (2025-12): Full XML structure to prevent identity bleeding
   *
   * Section ordering follows Gemini's "XML Containment & Sandwich Method":
   * 1. <system_identity> - Identity, character, AND constraints (who am I, what I must NOT do)
   * 2. <context> - Date/time and location (when and where)
   * 3. <participants> - Who else is involved (NOT including self)
   * 4. <memory_archive> - Historical memories (middle = less attention = good for archives)
   * 5. <contextual_references> - Referenced messages from replies/links
   * 6. <chat_log> - Serialized conversation history with XML tags per message
   * 7. <protocol> - Behavior rules (END for recency bias)
   *
   * The key change is conversation history is now INSIDE the system prompt as XML,
   * not as separate LangChain messages. This prevents identity bleeding.
   */
  buildFullSystemPrompt(options: BuildFullSystemPromptOptions): SystemMessage {
    const {
      personality,
      participantPersonas,
      relevantMemories,
      context,
      referencedMessagesFormatted,
      extendedContextDescriptions,
      serializedHistory,
    } = options;

    const { persona, protocol } = formatPersonalityFields(
      personality,
      context.activePersonaName !== undefined && context.activePersonaName.length > 0
        ? context.activePersonaName
        : 'User',
      personality.name,
      context.discordUsername
    );
    logger.debug(
      `[PromptBuilder] Persona length: ${persona.length} chars, Protocol length: ${protocol.length} chars`
    );

    // Build <system_identity> section with identity AND constraints
    // This is the START of the prompt - primacy effect
    const identityConstraints = this.buildIdentityConstraints(personality.name);
    const identitySection = `<system_identity>
<role>
You are ${personality.name}.
</role>
<character>
${escapeXmlContent(persona)}
</character>
<constraints>
${identityConstraints}
</constraints>
</system_identity>`;

    // Current date/time and environment context wrapped in <context>
    const datetime = formatFullDateTime(new Date(), context.userTimezone);
    const locationInfo =
      context.environment !== undefined && context.environment !== null
        ? this.formatLocationForContext(context.environment)
        : 'Direct Message (private chat)';

    const contextSection = `\n\n<context>
<datetime>${datetime}</datetime>
<location>${locationInfo}</location>
</context>`;

    // Conversation participants - ALL people involved (excluding self)
    // Already wrapped in <participants> by formatParticipantsContext
    const participantsContext = formatParticipantsContext(
      participantPersonas,
      context.activePersonaName
    );

    // Relevant memories from past interactions
    // Already wrapped in <memory_archive> with instruction by formatMemoriesContext
    // Use user's preferred timezone for memory timestamps
    const memoryContext = formatMemoriesContext(relevantMemories, context.userTimezone);

    // Referenced messages (from replies and message links)
    // Already wrapped in <contextual_references> by ReferencedMessageFormatter
    // Use pre-formatted text to avoid duplicate vision/transcription API calls
    const referencesContext =
      referencedMessagesFormatted !== undefined && referencedMessagesFormatted.length > 0
        ? `\n\n${referencedMessagesFormatted}`
        : '';

    if (referencesContext.length > 0) {
      logger.info(
        `[PromptBuilder] referencesContext length after formatting: ${referencesContext.length}`
      );
    }

    // Extended context image descriptions (from recent channel messages)
    // Added after references but before chat log for context about recent media
    const extendedContextSection =
      extendedContextDescriptions !== undefined && extendedContextDescriptions.length > 0
        ? `\n\n${extendedContextDescriptions}`
        : '';

    // Conversation history as XML - THIS IS THE KEY CHANGE
    // History is now serialized inside the system prompt, not as separate messages
    const chatLogSection =
      serializedHistory !== undefined && serializedHistory.length > 0
        ? `\n\n<chat_log>
${serializedHistory}
</chat_log>`
        : '';

    // Wrap protocol in XML tags (END of prompt - recency bias for highest impact)
    // Escape user-generated content to prevent prompt injection via XML tag breaking
    const protocolSection =
      protocol.length > 0 ? `\n\n<protocol>\n${escapeXmlContent(protocol)}\n</protocol>` : '';

    // Assemble in correct order for U-shaped attention optimization
    const fullSystemPrompt = `${identitySection}${contextSection}${participantsContext}${memoryContext}${referencesContext}${extendedContextSection}${chatLogSection}${protocolSection}`;

    // Basic prompt composition logging (always)
    const historyLength = serializedHistory?.length ?? 0;
    const extendedContextLength = extendedContextSection.length;
    logger.info(
      `[PromptBuilder] Prompt composition: identity=${identitySection.length} context=${contextSection.length} references=${referencesContext.length} extendedMedia=${extendedContextLength} participants=${participantsContext.length} memories=${memoryContext.length} history=${historyLength} protocol=${protocolSection.length} total=${fullSystemPrompt.length} chars`
    );

    // Detailed prompt assembly logging (development only)
    if (
      config.NODE_ENV !== undefined &&
      config.NODE_ENV.length > 0 &&
      config.NODE_ENV === 'development'
    ) {
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
          // Include STM info for duplication detection
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

    return new SystemMessage(fullSystemPrompt);
  }

  /**
   * Build identity constraints for the system_identity section
   *
   * These constraints are critical for preventing identity bleeding
   * where the AI responds as another participant instead of itself.
   */
  private buildIdentityConstraints(personalityName: string): string {
    return `You are ONE participant in this conversation.
You are ${personalityName}. You are NEVER any other participant.
Do not generate dialogue for other users.
If you see messages from others, reply TO them, do not simulate them.
Output ONLY your response text.
NEVER prefix your response with "${personalityName}:" or any name.
NEVER output XML tags in your response.`;
  }

  /**
   * Format Discord environment for the context section
   */
  private formatLocationForContext(environment: ConversationContext['environment']): string {
    if (environment === undefined || environment === null) {
      return 'Direct Message (private chat)';
    }

    if (environment.type === 'dm') {
      return 'Direct Message (private chat)';
    }

    const parts: string[] = [];
    if (environment.guild !== undefined && environment.guild !== null) {
      parts.push(`Server: ${escapeXmlContent(environment.guild.name)}`);
    }
    if (
      environment.category !== undefined &&
      environment.category !== null &&
      environment.category.name.length > 0
    ) {
      parts.push(`Category: ${escapeXmlContent(environment.category.name)}`);
    }
    parts.push(
      `Channel: #${escapeXmlContent(environment.channel.name)} (${environment.channel.type})`
    );
    if (environment.thread !== undefined && environment.thread !== null) {
      parts.push(`Thread: ${escapeXmlContent(environment.thread.name)}`);
    }

    return parts.join(', ');
  }

  /**
   * Format user message with context metadata
   */
  formatUserMessage(message: MessageContent, context: ConversationContext): string {
    let formatted = '';

    // Add context if this is a proxy message
    if (
      context.isProxyMessage === true &&
      context.userName !== undefined &&
      context.userName.length > 0
    ) {
      formatted += `[Message from ${context.userName}]\n`;
    }

    // Handle different message types
    if (typeof message === 'string') {
      formatted += message;
    } else if (typeof message === 'object' && message !== null && message !== undefined) {
      // Handle complex message objects
      if ('content' in message) {
        formatted += message.content;
      }

      // Add reference context if available
      if (
        'referencedMessage' in message &&
        message.referencedMessage !== undefined &&
        message.referencedMessage !== null
      ) {
        const ref = message.referencedMessage;
        const author = ref.author !== undefined && ref.author.length > 0 ? ref.author : 'someone';
        formatted = `[Replying to ${author}: "${ref.content}"]\n${formatted}`;
      }

      // Note attachments if present
      if ('attachments' in message && Array.isArray(message.attachments)) {
        for (const attachment of message.attachments) {
          formatted += `\n[Attachment: ${attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'file'}]`;
        }
      }
    }

    return formatted || 'Hello';
  }

  /**
   * Count tokens for a text string
   */
  countTokens(text: string): number {
    return countTextTokens(text);
  }

  /**
   * Count tokens for memories
   */
  countMemoryTokens(memories: MemoryDocument[]): number {
    let totalTokens = 0;
    for (const doc of memories) {
      const timestamp =
        doc.metadata?.createdAt !== undefined && doc.metadata.createdAt !== null
          ? formatMemoryTimestamp(doc.metadata.createdAt)
          : null;
      const memoryText = `- ${timestamp !== null && timestamp.length > 0 ? `[${timestamp}] ` : ''}${doc.pageContent}`;
      totalTokens += countTextTokens(memoryText);
    }
    return totalTokens;
  }

  /**
   * Count tokens for processed attachments (from descriptions)
   */
  countAttachmentTokens(processedAttachments: ProcessedAttachment[]): number {
    if (processedAttachments.length === 0) {
      return 0;
    }

    const descriptions = processedAttachments
      .map(a => a.description)
      .filter(d => d.length > 0 && !d.startsWith('['))
      .join('\n\n');

    return countTextTokens(descriptions);
  }
}
