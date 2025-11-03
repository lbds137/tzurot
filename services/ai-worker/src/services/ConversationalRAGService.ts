/**
 * Conversational RAG Service - Uses LangChain for memory-augmented conversations
 *
 * This implements the architecture from the Gemini conversation:
 * - Uses vector store for long-term memory retrieval
 * - Manages conversation history
 * - Builds prompts with system message, memory, and history
 */

import {
  BaseMessage,
  HumanMessage,
  SystemMessage
} from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { PgvectorMemoryAdapter, MemoryQueryOptions } from '../memory/PgvectorMemoryAdapter.js';
import {
  MessageContent,
  createLogger,
  type LoadedPersonality,
  type AttachmentMetadata,
  type ReferencedMessage,
  AI_DEFAULTS,
  TEXT_LIMITS,
  TIMEOUTS,
  RETRY_CONFIG,
  getPrismaClient,
  formatFullDateTime,
  formatMemoryTimestamp,
  getConfig,
} from '@tzurot/common-types';
import { createChatModel, getModelCacheKey, type ChatModelResult } from './ModelFactory.js';
import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';
import { processAttachments, type ProcessedAttachment, transcribeAudio } from './MultimodalProcessor.js';
import { stripPersonalityPrefix } from '../utils/responseCleanup.js';
import { logAndThrow, logAndReturnFallback } from '../utils/errorHandling.js';

const logger = createLogger('ConversationalRAGService');
const config = getConfig();

/**
 * Memory document structure from vector search
 */
export interface MemoryDocument {
  pageContent: string;
  metadata?: {
    id?: string;
    createdAt?: string | number;
  };
}

export interface ParticipantPersona {
  personaId: string;
  personaName: string;
  isActive: boolean;
}

export interface DiscordEnvironment {
  type: 'dm' | 'guild';
  guild?: {
    id: string;
    name: string;
  };
  category?: {
    id: string;
    name: string;
  };
  channel: {
    id: string;
    name: string;
    type: string;
  };
  thread?: {
    id: string;
    name: string;
    parentChannel: {
      id: string;
      name: string;
      type: string;
    };
  };
}

export interface ConversationContext {
  userId: string;
  channelId?: string;
  serverId?: string;
  sessionId?: string;
  userName?: string;
  isProxyMessage?: boolean;
  // Active speaker - the persona making the current request
  activePersonaId?: string;
  activePersonaName?: string;
  conversationHistory?: BaseMessage[];
  oldestHistoryTimestamp?: number; // Unix timestamp of oldest message in conversation history (for LTM deduplication)
  // All conversation participants (extracted from history before BaseMessage conversion)
  participants?: ParticipantPersona[];
  // Multimodal support
  attachments?: AttachmentMetadata[];
  // Discord environment context (DMs vs guild, channel info, etc)
  environment?: DiscordEnvironment;
  // Referenced messages (from replies and message links)
  referencedMessages?: ReferencedMessage[];
}

export interface RAGResponse {
  content: string;
  retrievedMemories?: number;
  tokensUsed?: number;
  attachmentDescriptions?: string;
  referencedMessagesDescriptions?: string;
  modelUsed?: string;
}

export class ConversationalRAGService {
  private memoryManager?: PgvectorMemoryAdapter;
  private models = new Map<string, ChatModelResult>();

  constructor(memoryManager?: PgvectorMemoryAdapter) {
    this.memoryManager = memoryManager;
  }

  /**
   * Get or create a chat model for a specific configuration
   * This supports BYOK (Bring Your Own Key) - different users can use different keys
   * Returns both the model and the validated model name
   */
  private getModel(
    modelName?: string,
    apiKey?: string,
    temperature?: number
  ): ChatModelResult {
    const cacheKey = getModelCacheKey({ modelName, apiKey, temperature });

    if (!this.models.has(cacheKey)) {
      this.models.set(cacheKey, createChatModel({
        modelName,
        apiKey,
        temperature: temperature ?? 0.7,
      }));
    }

    return this.models.get(cacheKey)!;
  }

  /**
   * Invoke LLM with timeout and retry logic for transient errors
   *
   * Features:
   * - Retries on transient network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND)
   * - Exponential backoff between retries
   * - Global timeout to prevent exceeding gateway JOB_WAIT limit
   * - Per-attempt timeout reduction based on remaining time
   */
  private async invokeModelWithRetry(
    model: BaseChatModel,
    messages: BaseMessage[],
    modelName: string
  ): Promise<BaseMessage> {
    const startTime = Date.now();
    const maxRetries = RETRY_CONFIG.LLM_MAX_RETRIES;
    const globalTimeoutMs = RETRY_CONFIG.LLM_GLOBAL_TIMEOUT;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check if we've exceeded global timeout before attempting
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= globalTimeoutMs) {
        logger.error({
          modelName,
          elapsedMs,
          globalTimeoutMs,
          attempt: attempt + 1
        }, `[RAG] Global timeout exceeded after ${elapsedMs}ms (limit: ${globalTimeoutMs}ms)`);
        throw new Error(`LLM invocation global timeout exceeded after ${elapsedMs}ms`);
      }

      // Calculate remaining time for this attempt
      const remainingMs = globalTimeoutMs - elapsedMs;
      const attemptTimeoutMs = Math.min(TIMEOUTS.LLM_API, remainingMs);

      try {
        logger.info({
          modelName,
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          attemptTimeoutMs,
          remainingMs
        }, `[RAG] Invoking LLM (attempt ${attempt + 1}/${maxRetries + 1}, timeout: ${attemptTimeoutMs}ms)`);

        // Invoke with calculated timeout (respects global timeout)
        const response = await model.invoke(messages, { timeout: attemptTimeoutMs });

        if (attempt > 0) {
          logger.info({ modelName, attempt: attempt + 1 }, '[RAG] LLM invocation succeeded after retry');
        }

        return response;

      } catch (error) {
        // Check if this is a transient network error worth retrying
        // Check both error.code (Node.js native errors) and error.message (wrapped errors)
        const errorCode = (error as any).code;
        const errorMessage = error instanceof Error ? error.message : '';
        const isTransientError =
          errorCode === 'ECONNRESET' ||
          errorCode === 'ETIMEDOUT' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ECONNREFUSED' ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT') ||
          errorMessage.includes('ENOTFOUND');

        if (isTransientError && attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * RETRY_CONFIG.LLM_RETRY_BASE_DELAY;
          logger.warn({
            err: error,
            modelName,
            attempt: attempt + 1,
            nextRetryInMs: delayMs,
            elapsedMs: Date.now() - startTime
          }, `[RAG] LLM invocation failed with transient error, retrying in ${delayMs}ms`);

          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // Non-retryable error or out of retries
        if (attempt === maxRetries) {
          logger.error({
            err: error,
            modelName,
            attempts: maxRetries + 1,
            totalElapsedMs: Date.now() - startTime
          }, `[RAG] LLM invocation failed after ${maxRetries + 1} attempts`);
        }

        throw error;
      }
    }

    // This line is unreachable (loop always returns or throws), but TypeScript doesn't know that
    throw new Error('LLM invocation failed - all retries exhausted');
  }

  /**
   * Generate a response using conversational RAG
   */
  async generateResponse(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    userApiKey?: string
  ): Promise<RAGResponse> {
    try {
      // 1. Process attachments FIRST to get transcriptions for memory search
      let processedAttachments: ProcessedAttachment[] = [];
      if (context.attachments && context.attachments.length > 0) {
        processedAttachments = await processAttachments(context.attachments, personality);
        logger.info(
          { count: processedAttachments.length },
          'Processed attachments to text descriptions'
        );
      }

      // 2. Format the user's message (now with transcriptions available)
      const userMessage = this.formatUserMessage(message, context);

      // 3. Build the actual message text for memory search
      // For voice messages, use transcription instead of "Hello" fallback
      const searchQuery = this.buildSearchQuery(userMessage, processedAttachments);

      // 4. Fetch ALL participant personas from conversation history
      const participantPersonas = await this.getAllParticipantPersonas(context);
      if (participantPersonas.size > 0) {
        logger.info(`[RAG] Loaded ${participantPersonas.size} participant persona(s): ${Array.from(participantPersonas.keys()).join(', ')}`);
      } else {
        logger.debug(`[RAG] No participant personas found in conversation history`);
      }

      // 5. Query vector store for relevant memories using actual content
      logger.info(`[RAG] Memory search query: "${searchQuery.substring(0, TEXT_LIMITS.LOG_PREVIEW)}${searchQuery.length > TEXT_LIMITS.LOG_PREVIEW ? '...' : ''}"`);
      const relevantMemories = await this.retrieveRelevantMemories(personality, searchQuery, context);

      // 6. Format referenced messages (with vision/transcription) for both prompt AND database
      const referencedMessagesDescriptions = context.referencedMessages && context.referencedMessages.length > 0
        ? await this.formatReferencedMessages(context.referencedMessages, personality)
        : undefined;

      // 7. Build the prompt with ALL participant personas and memory context
      const fullSystemPrompt = await this.buildFullSystemPrompt(
        personality,
        participantPersonas,
        relevantMemories,
        context,
        referencedMessagesDescriptions
      );

      // 5. Build conversation history
      const messages: BaseMessage[] = [];
      messages.push(new SystemMessage(fullSystemPrompt));

      // Add conversation history if available
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const historyLimit = personality.contextWindow || 10;
        const recentHistory = context.conversationHistory.slice(-historyLimit);
        messages.push(...recentHistory);
        logger.info(`[RAG] Including ${recentHistory.length} conversation history messages (limit: ${historyLimit})`);

        // DEBUG: Log each history message to detect duplication
        if (config.NODE_ENV === 'development') {
          logger.debug('[RAG] Conversation history contents:');
          recentHistory.forEach((msg, idx) => {
            const role = msg._getType();
            const content = msg.content.toString().substring(0, TEXT_LIMITS.LOG_PREVIEW);
            logger.debug(`  [${idx}] ${role}: ${content}${msg.content.toString().length > TEXT_LIMITS.LOG_PREVIEW ? '...' : ''}`);
          });
        }
      }

      // Build human message with attachment descriptions (already processed earlier)
      const { message: humanMessage, contentForStorage } = await this.buildHumanMessage(
        userMessage,
        processedAttachments,
        context.activePersonaName
      );
      messages.push(humanMessage);

      // DEBUG: Log current message to verify it's not duplicating history
      if (config.NODE_ENV === 'development') {
        const currentContent = humanMessage.content.toString();
        const hasSpeakerHeader = !!context.activePersonaName;
        logger.debug(`[RAG] Current user message (${currentContent.length} chars, speaker header: ${hasSpeakerHeader}): ${currentContent.substring(0, TEXT_LIMITS.LOG_PREVIEW)}${currentContent.length > TEXT_LIMITS.LOG_PREVIEW ? '...' : ''}`);
      }

      // 5. Get the appropriate model (provider determined by AI_PROVIDER env var)
      const { model, modelName } = this.getModel(
        personality.model,
        userApiKey,
        personality.temperature
      );

      // 6. Invoke the model with timeout and retry logic
      const response = await this.invokeModelWithRetry(model, messages, modelName);

      const content = response.content as string;

      logger.info(`[RAG] Generated ${content.length} chars for ${personality.name} using model: ${modelName}`);

      // 7. Store this interaction in memory (for future retrieval)
      // Use the content WITHOUT the prompt engineering header (contentForStorage)
      // NOT the modified content with "Current Message" header (humanMessage.content)
      await this.storeInteraction(personality, contentForStorage, content, context);

      // Extract attachment descriptions for history storage with context
      const attachmentDescriptions = processedAttachments.length > 0
        ? processedAttachments.map(a => {
            // Add filename/type context before each description
            let header = '';
            if (a.type === 'image') {
              header = `[Image: ${a.metadata.name || 'attachment'}]`;
            } else if (a.type === 'audio') {
              if (a.metadata.isVoiceMessage && a.metadata.duration) {
                header = `[Voice message: ${a.metadata.duration.toFixed(1)}s]`;
              } else {
                header = `[Audio: ${a.metadata.name || 'attachment'}]`;
              }
            }
            return `${header}\n${a.description}`;
          }).join('\n\n')
        : undefined;

      return {
        content,
        retrievedMemories: relevantMemories.length,
        tokensUsed: (response as any).usage_metadata?.total_tokens,
        attachmentDescriptions,
        referencedMessagesDescriptions,
        modelUsed: modelName
      };

    } catch (error) {
      logAndThrow(logger, `[RAG] Error generating response for ${personality.name}`, error);
    }
  }

  /**
   * Build search query for memory retrieval
   *
   * Uses actual transcription/description for voice messages and images,
   * not the "Hello" fallback.
   */
  private buildSearchQuery(
    userMessage: string,
    processedAttachments: ProcessedAttachment[]
  ): string {
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
      logger.info('[RAG] Using voice transcription for memory search instead of "Hello" fallback');
      return descriptions; // Voice message - use transcription
    }

    return userMessage.trim()
      ? `${userMessage}\n\n${descriptions}` // Text + attachments
      : descriptions; // Attachments only
  }

  /**
   * Build human message with attachments
   *
   * For both images and voice messages, we use text descriptions instead of
   * raw media data. This matches how we handle conversation history and:
   * - Simplifies the code (no multimodal complexity)
   * - Reduces API costs (vision/audio APIs are expensive)
   * - Provides consistent behavior between current turn and history
   */
  private async buildHumanMessage(
    userMessage: string,
    processedAttachments: ProcessedAttachment[],
    activePersonaName?: string
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
      messageContent = userMessage.trim() === 'Hello' && descriptions
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
  private async buildFullSystemPrompt(
    personality: LoadedPersonality,
    participantPersonas: Map<string, { content: string; isActive: boolean }>,
    relevantMemories: MemoryDocument[],
    context: ConversationContext,
    referencedMessagesFormatted?: string
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(
      personality,
      context.activePersonaName || 'User',
      personality.name
    );
    logger.debug(`[RAG] System prompt length: ${systemPrompt.length} chars`);

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
      logger.info(`[RAG] referencesContext length after formatting: ${referencesContext.length}`);
    }

    // Conversation participants - ALL people involved
    let participantsContext = '';
    if (participantPersonas.size > 0) {
      const participantsList: string[] = [];

      for (const [personaName, { content }] of participantPersonas.entries()) {
        // No "current speaker" marker here - we'll clarify that right before the current message
        participantsList.push(`### ${personaName}\n${content}`);
      }

      const pluralNote = participantPersonas.size > 1
        ? `\n\nNote: This is a group conversation. Messages are prefixed with persona names (e.g., "${context.activePersonaName || 'Alice'}: message") to show who said what.`
        : '';

      participantsContext = `\n\n## Conversation Participants\nThe following ${participantPersonas.size === 1 ? 'person is' : 'people are'} involved in this conversation:\n\n${participantsList.join('\n\n')}${pluralNote}`;
    }

    // Relevant memories from past interactions
    const memoryContext = relevantMemories.length > 0
      ? '\n\n## Relevant Memories\n' +
        relevantMemories.map((doc) => {
          const timestamp = doc.metadata?.createdAt
            ? formatMemoryTimestamp(doc.metadata.createdAt)
            : null;
          return `- ${timestamp ? `[${timestamp}] ` : ''}${doc.pageContent}`;
        }).join('\n')
      : '';

    const fullSystemPrompt = `${systemPrompt}${dateContext}${environmentContext}${referencesContext}${participantsContext}${memoryContext}`;

    // Basic prompt composition logging (always)
    logger.info(`[RAG] Prompt composition: system=${systemPrompt.length} dateContext=${dateContext.length} environment=${environmentContext.length} references=${referencesContext.length} participants=${participantsContext.length} memories=${memoryContext.length} total=${fullSystemPrompt.length} chars`);

    // Detailed prompt assembly logging (development only)
    if (config.NODE_ENV === 'development') {
      logger.debug({
        personalityId: personality.id,
        personalityName: personality.name,
        systemPromptLength: systemPrompt.length,
        participantCount: participantPersonas.size,
        participantsContextLength: participantsContext.length,
        activePersonaName: context.activePersonaName,
        memoryCount: relevantMemories.length,
        memoryIds: relevantMemories.map((m) => m.metadata?.id || 'unknown'),
        memoryTimestamps: relevantMemories.map((m) =>
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
      }, '[RAG] Detailed prompt assembly:');

      // Show full prompt in debug mode (truncated to avoid massive logs)
      const maxPreviewLength = TEXT_LIMITS.LOG_FULL_PROMPT;
      if (fullSystemPrompt.length <= maxPreviewLength) {
        logger.debug('[RAG] Full system prompt:\n' + fullSystemPrompt);
      } else {
        logger.debug(
          `[RAG] Full system prompt (showing first ${maxPreviewLength} chars):\n` +
          fullSystemPrompt.substring(0, maxPreviewLength) +
          `\n\n... [truncated ${fullSystemPrompt.length - maxPreviewLength} more chars]`
        );
      }
    }

    return fullSystemPrompt;
  }

  /**
   * Format Discord environment context for inclusion in system prompt
   */
  private formatEnvironmentContext(environment: DiscordEnvironment): string {
    logger.debug({ environment }, '[RAG] Formatting environment context');

    if (environment.type === 'dm') {
      logger.info('[RAG] Environment type: DM');
      return '## Conversation Location\nThis conversation is taking place in a **Direct Message** (private one-on-one chat).';
    }

    logger.info({
      guildName: environment.guild?.name,
      channelName: environment.channel.name,
      channelType: environment.channel.type
    }, '[RAG] Environment type: Guild');

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
   * Format referenced messages for inclusion in system prompt
   */
  private async formatReferencedMessages(
    references: ReferencedMessage[],
    personality: LoadedPersonality
  ): Promise<string> {
    const lines: string[] = [];
    lines.push('## Referenced Messages\n');
    lines.push('The user is referencing the following messages:\n');

    for (const ref of references) {
      lines.push(`[Reference ${ref.referenceNumber}]`);
      lines.push(`From: ${ref.authorDisplayName} (@${ref.authorUsername})`);
      lines.push(`Location: ${ref.guildName} > ${ref.channelName}`);
      lines.push(`Time: ${ref.timestamp}`);

      if (ref.content) {
        lines.push(`\nMessage Text:\n${ref.content}`);
      }

      if (ref.embeds) {
        lines.push(`\nMessage Embeds (structured data from Discord):\n${ref.embeds}`);
      }

      // Process attachments (images, voice messages, etc.)
      if (ref.attachments && ref.attachments.length > 0) {
        lines.push('\nAttachments:');

        for (const attachment of ref.attachments) {
          // Handle voice messages - transcribe them for AI context
          if (attachment.isVoiceMessage) {
            try {
              logger.info({
                referenceNumber: ref.referenceNumber,
                url: attachment.url,
                duration: attachment.duration
              }, 'Transcribing voice message in referenced message');

              const transcription = await transcribeAudio(attachment, personality);

              lines.push(`- Voice Message (${attachment.duration}s): "${transcription}"`);
            } catch (error) {
              logger.error({
                err: error,
                referenceNumber: ref.referenceNumber,
                url: attachment.url
              }, 'Failed to transcribe voice message in referenced message');

              lines.push(`- Voice Message (${attachment.duration}s) [transcription failed]`);
            }
          } else if (attachment.contentType?.startsWith('image/')) {
            // Process images through vision model
            try {
              logger.info({
                referenceNumber: ref.referenceNumber,
                url: attachment.url,
                name: attachment.name
              }, 'Processing image in referenced message through vision model');

              const { describeImage } = await import('./MultimodalProcessor.js');
              const imageDescription = await describeImage(attachment, personality);

              lines.push(`- Image (${attachment.name}): ${imageDescription}`);
            } catch (error) {
              logger.error({
                err: error,
                referenceNumber: ref.referenceNumber,
                url: attachment.url
              }, 'Failed to process image in referenced message');

              lines.push(`- Image (${attachment.name}) [vision processing failed]`);
            }
          } else {
            // For other attachments, just note them
            lines.push(`- File: ${attachment.name} (${attachment.contentType})`);
          }
        }
      }

      lines.push(''); // Empty line between references
    }

    const formattedText = lines.join('\n');

    logger.info(`[RAG] Formatted ${references.length} referenced message(s) for prompt`);

    // Log first 500 chars of formatted references for debugging
    if (formattedText.length > 0) {
      logger.info({
        preview: formattedText.substring(0, 500) + (formattedText.length > 500 ? '...' : ''),
        totalLength: formattedText.length
      }, '[RAG] Reference formatting preview');
    }

    return formattedText;
  }

  /**
   * Retrieve and log relevant memories from vector store
   */
  private async retrieveRelevantMemories(
    personality: LoadedPersonality,
    userMessage: string,
    context: ConversationContext
  ): Promise<any[]> {
    // Calculate cutoff timestamp with buffer to prevent STM/LTM overlap
    // If conversation history exists, exclude memories within buffer window of oldest message
    let excludeNewerThan: number | undefined = context.oldestHistoryTimestamp;

    if (excludeNewerThan !== undefined) {
      // Apply time buffer to ensure no overlap
      // If oldest STM message is at timestamp T, exclude LTM memories after (T - buffer)
      excludeNewerThan = excludeNewerThan - AI_DEFAULTS.STM_LTM_BUFFER_MS;

      logger.debug(
        `[RAG] STM/LTM deduplication: excluding memories newer than ${formatMemoryTimestamp(excludeNewerThan)} ` +
        `(${AI_DEFAULTS.STM_LTM_BUFFER_MS}ms buffer applied)`
      );
    }

    // Resolve user's personaId for this personality
    const personaId = await this.getUserPersonaForPersonality(
      context.userId,
      personality.id
    );

    if (!personaId) {
      logger.warn(`[RAG] No persona found for user ${context.userId} with personality ${personality.name}, skipping memory retrieval`);
      return [];
    }

    const memoryQueryOptions: MemoryQueryOptions = {
      personaId, // Required: which persona's memories to search
      personalityId: personality.id, // Optional: filter to this personality's memories
      sessionId: context.sessionId,
      limit: personality.memoryLimit || 15,
      scoreThreshold: personality.memoryScoreThreshold || AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
      excludeNewerThan,
    };

    // Query memories only if memory manager is available
    const relevantMemories = this.memoryManager !== undefined
      ? await this.memoryManager.queryMemories(userMessage, memoryQueryOptions)
      : [];

    if (relevantMemories.length > 0) {
      logger.info(`[RAG] Retrieved ${relevantMemories.length} relevant memories for ${personality.name}`);

      // Log each memory with ID, score, timestamp, and truncated content
      relevantMemories.forEach((doc, idx) => {
        const id = doc.metadata?.id || 'unknown';
        const score = typeof doc.metadata?.score === 'number' ? doc.metadata.score : 0;
        const createdAt = doc.metadata?.createdAt as string | number | undefined;
        const timestamp = createdAt ? formatMemoryTimestamp(createdAt) : null;
        const content = doc.pageContent.substring(0, 120);
        const truncated = doc.pageContent.length > 120 ? '...' : '';

        logger.info(`[RAG] Memory ${idx + 1}: id=${id} score=${score.toFixed(3)} date=${timestamp || 'unknown'} content="${content}${truncated}"`);
      });
    } else {
      logger.debug(`[RAG] No memory retrieval (${this.memoryManager !== undefined ? 'no memories found' : 'memory disabled'})`);
    }

    return relevantMemories;
  }

  /**
   * Store an interaction in conversation_history and pgvector (with pending_memories safety)
   */
  private async storeInteraction(
    personality: LoadedPersonality,
    userMessage: string,
    aiResponse: string,
    context: ConversationContext
  ): Promise<void> {
    const prisma = getPrismaClient();
    let conversationHistoryId: string | null = null;
    let pendingMemoryId: string | null = null;

    try {
      // 1. Resolve user's personaId for this personality FIRST
      const personaId = await this.getUserPersonaForPersonality(
        context.userId,
        personality.id
      );

      if (!personaId) {
        logger.warn(`[RAG] No persona found for user ${context.userId}, skipping conversation history and memory storage`);
        return;
      }

      // 2. Strip personality prefix if model ignored prompt instructions
      // This ensures clean storage in both conversation_history and vector memory
      const cleanedResponse = stripPersonalityPrefix(aiResponse, personality.name);

      // 3. Save assistant response to conversation_history
      const conversationRecord = await prisma.conversationHistory.create({
        data: {
          channelId: context.channelId || 'dm',
          guildId: context.serverId || null,
          personalityId: personality.id,
          personaId: personaId,
          role: 'assistant',
          content: cleanedResponse,
        },
        select: {
          id: true,
          createdAt: true
        }
      });
      conversationHistoryId = conversationRecord.id;
      // Use the actual timestamp from PostgreSQL for perfect sync
      const conversationTimestamp = conversationRecord.createdAt.getTime();
      logger.debug(`[RAG] Saved assistant response to conversation_history (${conversationHistoryId}, persona: ${personaId.substring(0, 8)}...)`);


      // 4. Determine canon scope and prepare memory metadata
      const canonScope: 'global' | 'personal' | 'session' = context.sessionId ? 'session' : 'personal';
      // Use {user} and {assistant} tokens - actual names injected at retrieval time
      const interactionText = `{user}: ${userMessage}\n{assistant}: ${cleanedResponse}`;

      const memoryMetadata = {
        personaId,
        personalityId: personality.id,
        sessionId: context.sessionId,
        canonScope,
        timestamp: conversationTimestamp, // Use PostgreSQL timestamp for perfect sync
        summaryType: 'conversation',
        contextType: context.channelId ? 'channel' : 'dm',
        channelId: context.channelId,
        guildId: context.serverId,
        serverId: context.serverId
      };

      if (this.memoryManager === undefined) {
        logger.debug(`[RAG] Memory storage disabled - interaction not stored in vector database`);
        return;
      }

      // 5. Create pending_memory record (safety net for vector storage)
      const pendingMemory = await prisma.pendingMemory.create({
        data: {
          conversationHistoryId,
          personaId,
          personalityId: personality.id,
          text: interactionText,
          metadata: memoryMetadata as any, // Cast to any for Prisma Json type
          attempts: 0,
        }
      });
      pendingMemoryId = pendingMemory.id;
      logger.debug(`[RAG] Created pending_memory (${pendingMemoryId})`);

      // 6. Try to store to vector database
      await this.memoryManager.addMemory({
        text: interactionText,
        metadata: memoryMetadata
      });

      // 7. Success! Delete the pending_memory
      await prisma.pendingMemory.delete({
        where: { id: pendingMemoryId }
      });
      logger.info(`[RAG] Stored interaction in ${canonScope} canon for ${personality.name} (persona: ${personaId})`);

    } catch (error) {
      logger.error({ err: error }, '[RAG] Failed to store interaction to vector database');

      // Update pending_memory with error details (for retry later)
      if (pendingMemoryId) {
        try {
          await prisma.pendingMemory.update({
            where: { id: pendingMemoryId },
            data: {
              attempts: { increment: 1 },
              lastAttemptAt: new Date(),
              error: error instanceof Error ? error.message : String(error)
            }
          });
          logger.info(`[RAG] Updated pending_memory (${pendingMemoryId}) with error - will retry later`);
        } catch (updateError) {
          logger.error({ err: updateError }, `[RAG] Failed to update pending_memory`);
        }
      }

      // Don't throw - this is a non-critical error
    }
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
   * Get ALL participant personas from conversation
   * Returns a Map of personaName -> persona content for all users in the conversation
   */
  private async getAllParticipantPersonas(
    context: ConversationContext
  ): Promise<Map<string, { content: string; isActive: boolean }>> {
    const personaMap = new Map<string, { content: string; isActive: boolean }>();

    if (!context.participants || context.participants.length === 0) {
      logger.debug(`[RAG] No participants provided in context`);
      return personaMap;
    }

    logger.debug(`[RAG] Fetching content for ${context.participants.length} participant(s)`);

    // Fetch content for each participant
    for (const participant of context.participants) {
      const content = await this.getPersonaContent(participant.personaId);
      if (content) {
        personaMap.set(participant.personaName, {
          content,
          isActive: participant.isActive
        });

        logger.debug(`[RAG] Loaded persona ${participant.personaName} (${participant.personaId.substring(0, 8)}...): ${content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW)}...`);
      } else {
        logger.warn(`[RAG] No content found for participant ${participant.personaName} (${participant.personaId})`);
      }
    }

    return personaMap;
  }

  /**
   * Get persona content by personaId
   * This fetches the ACTIVE persona (which might be a personality-specific override)
   */
  private async getPersonaContent(personaId: string): Promise<string | null> {
    try {
      const { getPrismaClient } = await import('@tzurot/common-types');
      const prisma = getPrismaClient();

      const persona = await prisma.persona.findUnique({
        where: { id: personaId },
        select: {
          preferredName: true,
          pronouns: true,
          content: true
        }
      });

      if (!persona) return null;

      // Build persona context with structured fields
      const parts: string[] = [];

      if (persona.preferredName) {
        parts.push(`Name: ${persona.preferredName}`);
      }

      if (persona.pronouns) {
        parts.push(`Pronouns: ${persona.pronouns}`);
      }

      if (persona.content) {
        parts.push(persona.content);
      }

      return parts.length > 0 ? parts.join('\n') : null;
    } catch (error) {
      return logAndReturnFallback(logger, `[RAG] Failed to fetch persona ${personaId}`, error, null);
    }
  }

  /**
   * Get user's persona ID for a specific personality
   * Checks for personality-specific override first, then falls back to default persona
   */
  private async getUserPersonaForPersonality(
    userId: string,
    personalityId: string
  ): Promise<string | null> {
    try {
      const { getPrismaClient } = await import('@tzurot/common-types');
      const prisma = getPrismaClient();

      // First check if user has a personality-specific persona override
      const userPersonalityConfig = await prisma.userPersonalityConfig.findFirst({
        where: {
          userId,
          personalityId,
          personaId: { not: null } // Has a persona override
        },
        select: { personaId: true }
      });

      if (userPersonalityConfig?.personaId) {
        logger.debug(`[RAG] Using personality-specific persona override for user ${userId}, personality ${personalityId}`);
        return userPersonalityConfig.personaId;
      }

      // Fall back to user's default persona
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          defaultPersonaLink: {
            select: { personaId: true }
          }
        }
      });

      const personaId = user?.defaultPersonaLink?.personaId || null;
      if (personaId) {
        logger.debug(`[RAG] Using default persona for user ${userId}`);
      } else {
        logger.warn(`[RAG] No persona found for user ${userId}`);
      }

      return personaId;
    } catch (error) {
      return logAndReturnFallback(logger, `[RAG] Failed to resolve persona for user ${userId}`, error, null);
    }
  }

  /**
   * Format user message with context metadata
   */
  private formatUserMessage(
    message: MessageContent,
    context: ConversationContext
  ): string {
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

}
