/**
 * Prompt Builder
 *
 * Builds system prompts with personality info, memories, environment context, and references.
 * Extracted from ConversationalRAGService for better modularity and testability.
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
import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';
import type { MemoryDocument, ConversationContext } from './ConversationalRAGService.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import { formatEnvironmentContext } from './prompt/EnvironmentFormatter.js';
import { formatParticipantsContext } from './prompt/ParticipantFormatter.js';
import { formatMemoriesContext } from './prompt/MemoryFormatter.js';

const logger = createLogger('PromptBuilder');
const config = getConfig();

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

    // Append referenced messages (with vision/transcription already processed)
    if (referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0) {
      messageContent =
        messageContent.length > 0
          ? `${messageContent}\n\n${referencedMessagesDescriptions}`
          : referencedMessagesDescriptions;

      logger.info(
        {
          referencesLength: referencedMessagesDescriptions.length,
        },
        'Appended referenced messages to current message'
      );
    }

    // Capture content BEFORE adding prompt engineering header
    // This is what should be stored in conversation history/memory
    const contentForStorage = messageContent;

    // Add "Current Message" section to clarify who is speaking
    // This leverages recency bias - the LLM processes this RIGHT BEFORE the message
    // NOTE: This header is ONLY for the LLM prompt, NOT for storage
    if (
      activePersonaName !== undefined &&
      activePersonaName.length > 0 &&
      messageContent.trim().length > 0
    ) {
      const currentMessageHeader = `---\n## Current Message\nYou are now responding to: **${activePersonaName}**\n\n`;
      messageContent = currentMessageHeader + messageContent;
    }

    return {
      message: new HumanMessage(messageContent),
      contentForStorage,
    };
  }

  /**
   * Build full system prompt with personas, memories, and date context
   *
   * Section ordering leverages U-shaped attention (LLMs pay most attention to beginning and end):
   * 1. <persona> - Identity & personality (who am I) - START for primacy
   * 2. Date/time context - When is now
   * 3. <current_situation> - Environment context (where)
   * 4. <participants> - Who is involved
   * 5. <memory_archive> - Historical memories (middle = less attention = good for archives)
   * 6. <contextual_references> - Referenced messages from replies/links
   * 7. <protocol> - Behavior rules - END for recency bias (highest impact)
   */
  buildFullSystemPrompt(
    personality: LoadedPersonality,
    participantPersonas: Map<string, { content: string; isActive: boolean }>,
    relevantMemories: MemoryDocument[],
    context: ConversationContext,
    referencedMessagesFormatted?: string
  ): SystemMessage {
    const { persona, protocol } = this.buildSystemPrompt(
      personality,
      context.activePersonaName !== undefined && context.activePersonaName.length > 0
        ? context.activePersonaName
        : 'User',
      personality.name
    );
    logger.debug(
      `[PromptBuilder] Persona length: ${persona.length} chars, Protocol length: ${protocol.length} chars`
    );

    // Wrap persona in XML tags (START of prompt - primacy)
    // Escape user-generated content to prevent prompt injection via XML tag breaking
    const personaSection = `<persona>\n${escapeXmlContent(persona)}\n</persona>`;

    // Current date/time context
    // Use user's preferred timezone if available
    const dateContext = `\n\n## Current Context\nCurrent date and time: ${formatFullDateTime(new Date(), context.userTimezone)}`;

    // Discord environment context (where conversation is happening)
    // Already wrapped in <current_situation> by formatEnvironmentContext
    const environmentContext =
      context.environment !== undefined && context.environment !== null
        ? `\n\n${formatEnvironmentContext(context.environment)}`
        : '';

    // Conversation participants - ALL people involved
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

    // Wrap protocol in XML tags (END of prompt - recency bias for highest impact)
    // Escape user-generated content to prevent prompt injection via XML tag breaking
    const protocolSection =
      protocol.length > 0 ? `\n\n<protocol>\n${escapeXmlContent(protocol)}\n</protocol>` : '';

    // Assemble in correct order for U-shaped attention optimization
    const fullSystemPrompt = `${personaSection}${dateContext}${environmentContext}${participantsContext}${memoryContext}${referencesContext}${protocolSection}`;

    // Basic prompt composition logging (always)
    logger.info(
      `[PromptBuilder] Prompt composition: persona=${persona.length} protocol=${protocol.length} dateContext=${dateContext.length} environment=${environmentContext.length} references=${referencesContext.length} participants=${participantsContext.length} memories=${memoryContext.length} total=${fullSystemPrompt.length} chars`
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
          dateContextLength: dateContext.length,
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
   * Build comprehensive system prompt from personality character fields
   *
   * Returns separate persona and protocol sections:
   * - persona: Identity, character info, traits, etc. (who you are)
   * - protocol: Behavior rules from systemPrompt (how to respond)
   *
   * This separation enables U-shaped attention optimization:
   * persona goes at the START, protocol goes at the END of the full prompt.
   */
  private buildSystemPrompt(
    personality: LoadedPersonality,
    userName: string,
    assistantName: string
  ): { persona: string; protocol: string } {
    const personaSections: string[] = [];

    // Add explicit identity statement
    personaSections.push(
      `## Your Identity\nYou are ${personality.displayName !== undefined && personality.displayName.length > 0 ? personality.displayName : personality.name}.`
    );

    // Add character info (who they are, their history)
    if (personality.characterInfo !== undefined && personality.characterInfo.length > 0) {
      personaSections.push(`\n## Character Information\n${personality.characterInfo}`);
    }

    // Add personality traits
    if (personality.personalityTraits !== undefined && personality.personalityTraits.length > 0) {
      personaSections.push(`\n## Personality Traits\n${personality.personalityTraits}`);
    }

    // Add tone/style
    if (personality.personalityTone !== undefined && personality.personalityTone.length > 0) {
      personaSections.push(`\n## Conversational Tone\n${personality.personalityTone}`);
    }

    // Add age
    if (personality.personalityAge !== undefined && personality.personalityAge.length > 0) {
      personaSections.push(`\n## Age\n${personality.personalityAge}`);
    }

    // Add appearance
    if (
      personality.personalityAppearance !== undefined &&
      personality.personalityAppearance.length > 0
    ) {
      personaSections.push(`\n## Physical Appearance\n${personality.personalityAppearance}`);
    }

    // Add likes
    if (personality.personalityLikes !== undefined && personality.personalityLikes.length > 0) {
      personaSections.push(`\n## What I Like\n${personality.personalityLikes}`);
    }

    // Add dislikes
    if (
      personality.personalityDislikes !== undefined &&
      personality.personalityDislikes.length > 0
    ) {
      personaSections.push(`\n## What I Dislike\n${personality.personalityDislikes}`);
    }

    // Add conversational goals
    if (
      personality.conversationalGoals !== undefined &&
      personality.conversationalGoals.length > 0
    ) {
      personaSections.push(`\n## Conversational Goals\n${personality.conversationalGoals}`);
    }

    // Add conversational examples
    if (
      personality.conversationalExamples !== undefined &&
      personality.conversationalExamples.length > 0
    ) {
      personaSections.push(`\n## Conversational Examples\n${personality.conversationalExamples}`);
    }

    // Protocol is the systemPrompt (behavior rules/jailbreak)
    // Replace {user} and {assistant} placeholders with actual names
    let protocol = '';
    if (personality.systemPrompt !== undefined && personality.systemPrompt.length > 0) {
      protocol = replacePromptPlaceholders(personality.systemPrompt, userName, assistantName);
    }

    return {
      persona: personaSections.join('\n'),
      protocol,
    };
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
