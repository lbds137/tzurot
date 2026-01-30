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
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
} from './ConversationalRAGService.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import { formatParticipantsContext } from './prompt/ParticipantFormatter.js';
import { formatMemoriesContext } from './prompt/MemoryFormatter.js';
import { formatPersonalityFields } from './prompt/PersonalityFieldsFormatter.js';
import { formatEnvironmentContext } from './prompt/EnvironmentFormatter.js';
import { extractContentDescriptions } from './RAGUtils.js';
import {
  PLATFORM_CONSTRAINTS,
  OUTPUT_CONSTRAINTS,
  buildIdentityConstraints,
} from './prompt/HardcodedConstraints.js';

const logger = createLogger('PromptBuilder');
const config = getConfig();

/** Options for building a full system prompt */
export interface BuildFullSystemPromptOptions {
  personality: LoadedPersonality;
  participantPersonas: Map<string, ParticipantInfo>;
  relevantMemories: MemoryDocument[];
  context: ConversationContext;
  referencedMessagesFormatted?: string;
  serializedHistory?: string;
  // Note: extendedContextDescriptions removed - image descriptions are now
  // injected inline into serializedHistory entries for better context colocation
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
      const descriptions = extractContentDescriptions(processedAttachments);

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
   *
   * The message includes speaker identification via a <from> tag to help the LLM
   * know who is speaking. This is critical because while the system prompt has
   * a participants section with active="true", and chat_log has from= attributes,
   * the raw HumanMessage content also needs explicit speaker identification.
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
      // Get text descriptions for all attachments (excluding placeholders)
      const descriptions = extractContentDescriptions(processedAttachments);

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

    // Escape content to prevent accidental XML-like patterns from
    // being interpreted as structure, since system prompt uses XML
    const safeContent = escapeXmlContent(messageContent);

    // Add speaker identification at the start of the message
    // This is critical for the LLM to know who is speaking, especially in
    // multi-user conversations. The format matches chat_log entries for consistency.
    // Format: <from>PersonaName</from>\n\ncontent
    let finalContent = safeContent;
    if (activePersonaName !== undefined && activePersonaName.length > 0) {
      const safeSpeaker = escapeXmlContent(activePersonaName);
      finalContent = `<from>${safeSpeaker}</from>\n\n${safeContent}`;
    }

    return {
      message: new HumanMessage(finalContent),
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

    // Build <system_identity> section (simplified - just role and character)
    // Constraints are now separate sections using the Sandwich Method
    const identitySection = `<system_identity>
<role>You are ${personality.name}.</role>
<character>
${escapeXmlContent(persona)}
</character>
</system_identity>`;

    // Identity constraints - prevent identity bleeding
    // Uses imported buildIdentityConstraints from HardcodedConstraints
    const collisionInfo = this.detectNameCollision(
      context.activePersonaName,
      context.discordUsername,
      personality.name,
      personality.id
    );
    const identityConstraintsSection = buildIdentityConstraints(personality.name, collisionInfo);

    // Current date/time and environment context wrapped in <context>
    const datetime = formatFullDateTime(new Date(), context.userTimezone);

    // Format location as XML - formatEnvironmentContext returns a <location> element
    const locationXml =
      context.environment !== undefined && context.environment !== null
        ? formatEnvironmentContext(context.environment)
        : '<location type="dm">Direct Message (private one-on-one chat)</location>';

    // Unique request ID to break API-level prompt caching (OpenRouter/free models)
    // This ensures each request is treated as unique even if context is similar
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const contextSection = `\n\n<context>
<datetime>${datetime}</datetime>
${locationXml}
<request_id>${requestId}</request_id>
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

    // Note: Extended context image descriptions are now embedded inline within
    // serializedHistory entries (via <image_descriptions> tags) for better colocation.
    // This improves AI context awareness when users reference recent images.

    // Conversation history as XML - THIS IS THE KEY CHANGE
    // History is now serialized inside the system prompt, not as separate messages
    const chatLogSection =
      serializedHistory !== undefined && serializedHistory.length > 0
        ? `\n\n<chat_log>
${serializedHistory}
</chat_log>`
        : '';

    // Wrap protocol in XML tags (near END of prompt - recency bias for highest impact)
    // Protocol content is already escaped during JSON->XML conversion in PersonalityFieldsFormatter
    // For legacy XML format, we still escape to prevent prompt injection
    const protocolSection =
      protocol.length > 0 ? `\n\n<protocol>\n${escapeXmlContent(protocol)}\n</protocol>` : '';

    // Output constraints go at the VERY END (recency bias for format compliance)
    // These are hardcoded in code, not user-configurable
    const outputConstraintsSection = `\n\n${OUTPUT_CONSTRAINTS}`;

    // Assemble in correct order using Sandwich Method:
    // 1. System identity (who you are)
    // 2. Identity constraints (prevent identity bleeding)
    // 3. Platform constraints (legal/safety limits)
    // 4. Context (when and where)
    // 5. Participants (who else is involved)
    // 6. Memory archive (middle = less attention = good for archives)
    // 7. Referenced messages (contextual links)
    // 8. Chat log (conversation history)
    // 9. Protocol (user-configurable behavior rules)
    // 10. Output constraints (recency bias for format compliance)
    const fullSystemPrompt = `${identitySection}\n\n${identityConstraintsSection}\n\n${PLATFORM_CONSTRAINTS}${contextSection}${participantsContext}${memoryContext}${referencesContext}${chatLogSection}${protocolSection}${outputConstraintsSection}`;

    // Basic prompt composition logging (always)
    const historyLength = serializedHistory?.length ?? 0;
    logger.info(
      `[PromptBuilder] Prompt composition: identity=${identitySection.length} identityConstraints=${identityConstraintsSection.length} platformConstraints=${PLATFORM_CONSTRAINTS.length} context=${contextSection.length} participants=${participantsContext.length} memories=${memoryContext.length} references=${referencesContext.length} history=${historyLength} protocol=${protocolSection.length} outputConstraints=${outputConstraintsSection.length} total=${fullSystemPrompt.length} chars`
    );

    // Detailed prompt assembly logging (development only)
    this.logDetailedPromptAssembly({
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
    });

    return new SystemMessage(fullSystemPrompt);
  }

  /**
   * Detect name collision between user's persona and personality name.
   *
   * A collision occurs when a user's display name matches the AI character's name,
   * which can cause confusion in conversations. When detected with a valid
   * discordUsername, we return collision info for disambiguation instructions.
   *
   * @param activePersonaName - User's display name in the conversation
   * @param discordUsername - User's Discord username for disambiguation
   * @param personalityName - The AI character's name
   * @param personalityId - For logging purposes
   * @returns Collision info if disambiguation is possible, undefined otherwise
   */
  private detectNameCollision(
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

  /**
   * Log detailed prompt assembly info in development mode.
   * Extracted to reduce buildFullSystemPrompt complexity.
   */
  private logDetailedPromptAssembly(opts: {
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
  }): void {
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
    if (config.NODE_ENV !== 'development') {
      return;
    }

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
    const descriptions = extractContentDescriptions(processedAttachments);
    return countTextTokens(descriptions);
  }
}
