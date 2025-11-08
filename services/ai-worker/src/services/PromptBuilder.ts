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
} from '@tzurot/common-types';
import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';
import type {
  MemoryDocument,
  DiscordEnvironment,
  ConversationContext,
} from './ConversationalRAGService.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

const logger = createLogger('PromptBuilder');
const config = getConfig();

export class PromptBuilder {
  /**
   * Build search query for memory retrieval
   *
   * Uses actual transcription/description for voice messages and images,
   * not the "Hello" fallback.
   */
  buildSearchQuery(userMessage: string, processedAttachments: ProcessedAttachment[]): string {
    if (processedAttachments.length === 0) {
      return userMessage;
    }

    // Get text descriptions for all attachments
    const descriptions = processedAttachments
      .map(a => a.description)
      .filter(d => d && !d.startsWith('['))
      .join('\n\n');

    // For voice-only messages (no text), use transcription as search query
    // For images or mixed content, combine with user message
    if (userMessage.trim() === 'Hello' && descriptions) {
      logger.info('[PromptBuilder] Using voice transcription for memory search instead of "Hello" fallback');
      return descriptions; // Voice message - use transcription
    }

    return userMessage.trim()
      ? `${userMessage}\n\n${descriptions}` // Text + attachments
      : descriptions; // Attachments only
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
  async buildHumanMessage(
    userMessage: string,
    processedAttachments: ProcessedAttachment[],
    activePersonaName?: string,
    referencedMessagesDescriptions?: string
  ): Promise<{ message: HumanMessage; contentForStorage: string }> {
    // Build the message content
    let messageContent = userMessage;

    if (processedAttachments.length > 0) {
      // Get text descriptions for all attachments
      const descriptions = processedAttachments
        .map(a => a.description)
        .filter(d => d && !d.startsWith('['))
        .join('\n\n');

      // For voice-only messages (no text), use transcription as primary message
      // For images or mixed content, combine with user message
      messageContent =
        userMessage.trim() === 'Hello' && descriptions
          ? descriptions // Voice message with no text content
          : userMessage.trim()
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
    if (referencedMessagesDescriptions) {
      messageContent = messageContent
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
    if (activePersonaName && messageContent.trim()) {
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
   */
  async buildFullSystemPrompt(
    personality: LoadedPersonality,
    participantPersonas: Map<string, { content: string; isActive: boolean }>,
    relevantMemories: MemoryDocument[],
    context: ConversationContext,
    referencedMessagesFormatted?: string
  ): Promise<SystemMessage> {
    const systemPrompt = this.buildSystemPrompt(
      personality,
      context.activePersonaName || 'User',
      personality.name
    );
    logger.debug(`[PromptBuilder] System prompt length: ${systemPrompt.length} chars`);

    // Current date/time context (place early for better awareness)
    const dateContext = `\n\n## Current Context\nCurrent date and time: ${formatFullDateTime(new Date())}`;

    // Discord environment context (where conversation is happening)
    const environmentContext = context.environment
      ? `\n\n${this.formatEnvironmentContext(context.environment)}`
      : '';

    // Referenced messages (from replies and message links)
    // Use pre-formatted text to avoid duplicate vision/transcription API calls
    const referencesContext = referencedMessagesFormatted
      ? `\n\n${referencedMessagesFormatted}`
      : '';

    if (referencesContext) {
      logger.info(`[PromptBuilder] referencesContext length after formatting: ${referencesContext.length}`);
    }

    // Conversation participants - ALL people involved
    let participantsContext = '';
    if (participantPersonas.size > 0) {
      const participantsList: string[] = [];

      for (const [personaName, { content }] of participantPersonas.entries()) {
        // No "current speaker" marker here - we'll clarify that right before the current message
        participantsList.push(`### ${personaName}\n${content}`);
      }

      const pluralNote =
        participantPersonas.size > 1
          ? `\n\nNote: This is a group conversation. Messages are prefixed with persona names (e.g., "${context.activePersonaName || 'Alice'}: message") to show who said what.`
          : '';

      participantsContext = `\n\n## Conversation Participants\nThe following ${participantPersonas.size === 1 ? 'person is' : 'people are'} involved in this conversation:\n\n${participantsList.join('\n\n')}${pluralNote}`;
    }

    // Relevant memories from past interactions
    const memoryContext =
      relevantMemories.length > 0
        ? '\n\n## Relevant Memories\n' +
          relevantMemories
            .map(doc => {
              const timestamp = doc.metadata?.createdAt
                ? formatMemoryTimestamp(doc.metadata.createdAt)
                : null;
              return `- ${timestamp ? `[${timestamp}] ` : ''}${doc.pageContent}`;
            })
            .join('\n')
        : '';

    const fullSystemPrompt = `${systemPrompt}${dateContext}${environmentContext}${referencesContext}${participantsContext}${memoryContext}`;

    // Basic prompt composition logging (always)
    logger.info(
      `[PromptBuilder] Prompt composition: system=${systemPrompt.length} dateContext=${dateContext.length} environment=${environmentContext.length} references=${referencesContext.length} participants=${participantsContext.length} memories=${memoryContext.length} total=${fullSystemPrompt.length} chars`
    );

    // Detailed prompt assembly logging (development only)
    if (config.NODE_ENV === 'development') {
      logger.debug(
        {
          personalityId: personality.id,
          personalityName: personality.name,
          systemPromptLength: systemPrompt.length,
          participantCount: participantPersonas.size,
          participantsContextLength: participantsContext.length,
          activePersonaName: context.activePersonaName,
          memoryCount: relevantMemories.length,
          memoryIds: relevantMemories.map(m => m.metadata?.id || 'unknown'),
          memoryTimestamps: relevantMemories.map(m =>
            m.metadata?.createdAt ? formatMemoryTimestamp(m.metadata.createdAt) : 'unknown'
          ),
          totalMemoryChars: memoryContext.length,
          dateContextLength: dateContext.length,
          totalSystemPromptLength: fullSystemPrompt.length,
          // Include STM info for duplication detection
          stmCount: context.conversationHistory?.length || 0,
          stmOldestTimestamp: context.oldestHistoryTimestamp
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
   * Format Discord environment context for inclusion in system prompt
   */
  private formatEnvironmentContext(environment: DiscordEnvironment): string {
    logger.debug({ environment }, '[PromptBuilder] Formatting environment context');

    if (environment.type === 'dm') {
      logger.info('[PromptBuilder] Environment type: DM');
      return '## Conversation Location\nThis conversation is taking place in a **Direct Message** (private one-on-one chat).';
    }

    logger.info(
      {
        guildName: environment.guild?.name,
        channelName: environment.channel.name,
        channelType: environment.channel.type,
      },
      '[PromptBuilder] Environment type: Guild'
    );

    const parts: string[] = [];
    parts.push('## Conversation Location');
    parts.push('This conversation is taking place in a Discord server:\n');

    // Guild name
    parts.push(`**Server**: ${environment.guild!.name}`);

    // Category (if exists)
    if (environment.category) {
      parts.push(`**Category**: ${environment.category.name}`);
    }

    // Channel
    parts.push(`**Channel**: #${environment.channel.name} (${environment.channel.type})`);

    // Thread (if exists)
    if (environment.thread) {
      parts.push(`**Thread**: ${environment.thread.name}`);
    }

    return parts.join('\n');
  }

  /**
   * Build comprehensive system prompt from personality character fields
   */
  private buildSystemPrompt(
    personality: LoadedPersonality,
    userName: string,
    assistantName: string
  ): string {
    const sections: string[] = [];

    // Start with system prompt (jailbreak/behavior rules)
    // Replace {user} and {assistant} placeholders with actual names
    if (personality.systemPrompt) {
      const promptWithNames = replacePromptPlaceholders(
        personality.systemPrompt,
        userName,
        assistantName
      );
      sections.push(promptWithNames);
    }

    // Add explicit identity statement
    sections.push(`\n## Your Identity\nYou are ${personality.displayName || personality.name}.`);

    // Add character info (who they are, their history)
    if (personality.characterInfo) {
      sections.push(`\n## Character Information\n${personality.characterInfo}`);
    }

    // Add personality traits
    if (personality.personalityTraits) {
      sections.push(`\n## Personality Traits\n${personality.personalityTraits}`);
    }

    // Add tone/style
    if (personality.personalityTone) {
      sections.push(`\n## Conversational Tone\n${personality.personalityTone}`);
    }

    // Add age
    if (personality.personalityAge) {
      sections.push(`\n## Age\n${personality.personalityAge}`);
    }

    // Add appearance
    if (personality.personalityAppearance) {
      sections.push(`\n## Physical Appearance\n${personality.personalityAppearance}`);
    }

    // Add likes
    if (personality.personalityLikes) {
      sections.push(`\n## What I Like\n${personality.personalityLikes}`);
    }

    // Add dislikes
    if (personality.personalityDislikes) {
      sections.push(`\n## What I Dislike\n${personality.personalityDislikes}`);
    }

    // Add conversational goals
    if (personality.conversationalGoals) {
      sections.push(`\n## Conversational Goals\n${personality.conversationalGoals}`);
    }

    // Add conversational examples
    if (personality.conversationalExamples) {
      sections.push(`\n## Conversational Examples\n${personality.conversationalExamples}`);
    }

    return sections.join('\n');
  }

  /**
   * Format user message with context metadata
   */
  formatUserMessage(message: MessageContent, context: ConversationContext): string {
    let formatted = '';

    // Add context if this is a proxy message
    if (context.isProxyMessage && context.userName) {
      formatted += `[Message from ${context.userName}]\n`;
    }

    // Handle different message types
    if (typeof message === 'string') {
      formatted += message;
    } else if (typeof message === 'object' && message !== null) {
      // Handle complex message objects
      if ('content' in message) {
        formatted += message.content;
      }

      // Add reference context if available
      if ('referencedMessage' in message && message.referencedMessage) {
        const ref = message.referencedMessage;
        const author = ref.author || 'someone';
        formatted = `[Replying to ${author}: "${ref.content}"]\n${formatted}`;
      }

      // Note attachments if present
      if ('attachments' in message && Array.isArray(message.attachments)) {
        for (const attachment of message.attachments) {
          formatted += `\n[Attachment: ${attachment.name || 'file'}]`;
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
      const timestamp = doc.metadata?.createdAt
        ? formatMemoryTimestamp(doc.metadata.createdAt)
        : null;
      const memoryText = `- ${timestamp ? `[${timestamp}] ` : ''}${doc.pageContent}`;
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
      .filter(d => d && !d.startsWith('['))
      .join('\n\n');

    return countTextTokens(descriptions);
  }
}
