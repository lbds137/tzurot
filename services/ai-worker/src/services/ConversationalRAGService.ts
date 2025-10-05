/**
 * Conversational RAG Service - Uses LangChain for memory-augmented conversations
 *
 * This implements the architecture from the Gemini conversation:
 * - Uses vector store for long-term memory retrieval
 * - Manages conversation history
 * - Builds prompts with system message, memory, and history
 * - Supports streaming responses
 */

import {
  BaseMessage,
  HumanMessage,
  SystemMessage
} from '@langchain/core/messages';
import { QdrantMemoryAdapter, MemoryQueryOptions } from '../memory/QdrantMemoryAdapter.js';
import { MessageContent, createLogger, type LoadedPersonality, AI_DEFAULTS, APP_SETTINGS } from '@tzurot/common-types';
import { createChatModel, getModelCacheKey, type ChatModelResult } from './ModelFactory.js';
import { processAttachments, type ProcessedAttachment } from './MultimodalProcessor.js';

const logger = createLogger('ConversationalRAGService');

export interface AttachmentMetadata {
  url: string;
  contentType: string;
  name?: string;
  size?: number;
  isVoiceMessage?: boolean;
  duration?: number;
  waveform?: string;
}

export interface ConversationContext {
  userId: string;
  channelId?: string;
  serverId?: string;
  sessionId?: string;
  userName?: string;
  isProxyMessage?: boolean;
  conversationHistory?: BaseMessage[];
  oldestHistoryTimestamp?: number; // Unix timestamp of oldest message in conversation history (for LTM deduplication)
  // Multimodal support
  attachments?: AttachmentMetadata[];
}

export interface RAGResponse {
  content: string;
  retrievedMemories?: number;
  tokensUsed?: number;
  attachmentDescriptions?: string;
  modelUsed?: string;
}

export class ConversationalRAGService {
  private memoryManager?: QdrantMemoryAdapter;
  private models = new Map<string, ChatModelResult>();

  constructor(memoryManager?: QdrantMemoryAdapter) {
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

      // 4. Fetch user's persona if available
      const userPersona = await this.getUserPersona(context.userId);
      if (userPersona) {
        logger.info(`[RAG] Loaded user persona for ${context.userId}: ${userPersona.substring(0, 100)}...`);
      } else {
        logger.warn(`[RAG] No user persona found for ${context.userId}`);
      }

      // 5. Query vector store for relevant memories using actual content
      logger.info(`[RAG] Memory search query: "${searchQuery.substring(0, 150)}${searchQuery.length > 150 ? '...' : ''}"`);
      const relevantMemories = await this.retrieveRelevantMemories(personality, searchQuery, context);

      // 4. Build the prompt with user persona and memory context
      const fullSystemPrompt = this.buildFullSystemPrompt(personality, userPersona, relevantMemories, context);

      // 5. Build conversation history
      const messages: BaseMessage[] = [];
      messages.push(new SystemMessage(fullSystemPrompt));

      // Add conversation history if available
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const historyLimit = personality.contextWindow || 10;
        const recentHistory = context.conversationHistory.slice(-historyLimit);
        messages.push(...recentHistory);
        logger.info(`[RAG] Including ${recentHistory.length} conversation history messages (limit: ${historyLimit})`);
      }

      // Build human message with attachment descriptions (already processed earlier)
      const humanMessage = await this.buildHumanMessage(userMessage, processedAttachments);
      messages.push(humanMessage);

      // 5. Get the appropriate model (provider determined by AI_PROVIDER env var)
      const { model, modelName } = this.getModel(
        personality.model,
        userApiKey,
        personality.temperature
      );

      // 6. Invoke the model
      const response = await model.invoke(messages);

      const content = response.content as string;

      logger.info(`[RAG] Generated ${content.length} chars for ${personality.name} using model: ${modelName}`);

      // 7. Store this interaction in memory (for future retrieval)
      await this.storeInteraction(personality, userMessage, content, context);

      // Extract attachment descriptions for history storage
      const attachmentDescriptions = processedAttachments.length > 0
        ? processedAttachments.map(a => a.description).join('\n\n')
        : undefined;

      return {
        content,
        retrievedMemories: relevantMemories.length,
        tokensUsed: response.response_metadata?.tokenUsage?.totalTokens,
        attachmentDescriptions,
        modelUsed: modelName
      };

    } catch (error) {
      // Pino requires error objects to be passed with the 'err' key for proper serialization
      logger.error({ err: error }, `[RAG] Error generating response for ${personality.name}`);
      throw error;
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
    processedAttachments: ProcessedAttachment[]
  ): Promise<HumanMessage> {
    if (processedAttachments.length === 0) {
      return new HumanMessage(userMessage);
    }

    // Get text descriptions for all attachments
    const descriptions = processedAttachments
      .map(a => a.description)
      .filter(d => d && !d.startsWith('['))
      .join('\n\n');

    // For voice-only messages (no text), use transcription as primary message
    // For images or mixed content, combine with user message
    const fullText = userMessage.trim() === 'Hello' && descriptions
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

    return new HumanMessage(fullText);
  }

  /**
   * Build full system prompt with persona, memories, and date context
   */
  private buildFullSystemPrompt(
    personality: LoadedPersonality,
    userPersona: string | null,
    relevantMemories: any[],
    context: ConversationContext
  ): string {
    const systemPrompt = this.buildSystemPrompt(personality);
    logger.debug(`[RAG] System prompt length: ${systemPrompt.length} chars`);

    const personaContext = userPersona
      ? `\n\n## About the User You're Speaking With (${context.userName})\nThe following describes the user you are conversing with. This is NOT about you - this is about the person messaging you:\n\n${userPersona}`
      : '';

    const memoryContext = relevantMemories.length > 0
      ? '\n\nRelevant memories and past interactions:\n' +
        relevantMemories.map((doc: { pageContent: string; metadata?: { createdAt?: string | number } }) => {
          const timestamp = this.formatMemoryTimestamp(doc.metadata?.createdAt);
          return `- ${timestamp ? `[${timestamp}] ` : ''}${doc.pageContent}`;
        }).join('\n')
      : '';

    const now = new Date();
    const dateContext = `\n\n## Current Context\nCurrent date and time: ${now.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: APP_SETTINGS.TIMEZONE,
      timeZoneName: 'short'
    })}`;

    const fullSystemPrompt = `${systemPrompt}${personaContext}${memoryContext}${dateContext}`;

    logger.info(`[RAG] Prompt composition: system=${systemPrompt.length} persona=${personaContext.length} memories=${memoryContext.length} dateContext=${dateContext.length} total=${fullSystemPrompt.length} chars`);
    logger.debug(`[RAG] Full system prompt:\n${fullSystemPrompt.substring(0, 1000)}...\n[truncated, total length: ${fullSystemPrompt.length}]`);

    return fullSystemPrompt;
  }

  /**
   * Retrieve and log relevant memories from vector store
   */
  private async retrieveRelevantMemories(
    personality: LoadedPersonality,
    userMessage: string,
    context: ConversationContext
  ): Promise<any[]> {
    // Use oldestHistoryTimestamp to avoid retrieving memories that overlap with conversation history
    if (context.oldestHistoryTimestamp) {
      logger.debug(`[RAG] Excluding memories newer than ${new Date(context.oldestHistoryTimestamp).toISOString()} to avoid duplicate context`);
    }

    const memoryQueryOptions: MemoryQueryOptions = {
      personalityId: personality.id,
      userId: context.userId,
      sessionId: context.sessionId,
      limit: personality.memoryLimit || 15,
      scoreThreshold: personality.memoryScoreThreshold || AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
      excludeNewerThan: context.oldestHistoryTimestamp,
      includeGlobal: true,
      includePersonal: true,
      includeSession: !!context.sessionId
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
        const timestamp = this.formatMemoryTimestamp(createdAt);
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
   * Store an interaction in the vector database for future retrieval
   */
  private async storeInteraction(
    personality: LoadedPersonality,
    userMessage: string,
    aiResponse: string,
    context: ConversationContext
  ): Promise<void> {
    try {
      // Determine canon scope
      const canonScope = context.sessionId ? 'session' : 'personal';

      // Store as a conversational exchange
      const interactionText = `User (${context.userName || context.userId}): ${userMessage}\n${personality.name}: ${aiResponse}`;

      if (this.memoryManager !== undefined) {
        await this.memoryManager.addMemory({
          text: interactionText,
          metadata: {
            personalityId: personality.id, // Use UUID, not name
            personalityName: personality.name,
            userId: context.userId,
            sessionId: context.sessionId,
            canonScope,
            timestamp: Date.now(),
            summaryType: 'conversation',
            contextType: context.channelId ? 'channel' : 'dm',
            channelId: context.channelId,
            guildId: context.serverId,
            serverId: context.serverId
          }
        });

        logger.info(`[RAG] Stored interaction in ${canonScope} canon for ${personality.name}`);
      } else {
        logger.debug(`[RAG] Memory storage disabled - interaction not stored`);
      }

    } catch (error) {
      logger.error({ err: error }, '[RAG] Failed to store interaction');
      // Don't throw - this is a non-critical error
    }
  }

  /**
   * Build comprehensive system prompt from personality character fields
   */
  private buildSystemPrompt(personality: LoadedPersonality): string {
    const sections: string[] = [];

    // Start with system prompt (jailbreak/behavior rules)
    if (personality.systemPrompt) {
      sections.push(personality.systemPrompt);
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
   * Get user's persona from database
   */
  private async getUserPersona(userId: string): Promise<string | null> {
    try {
      const { getPrismaClient } = await import('@tzurot/common-types');
      const prisma = getPrismaClient();

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          globalPersona: {
            select: {
              preferredName: true,
              pronouns: true,
              content: true
            }
          }
        }
      });

      const persona = user?.globalPersona;
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
      logger.error({ err: error }, '[RAG] Failed to fetch user persona');
      return null;
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

  /**
   * Format a memory timestamp into a human-readable date (Eastern timezone)
   */
  private formatMemoryTimestamp(createdAt?: string | number): string | null {
    if (!createdAt) return null;

    try {
      // Handle both Unix timestamps (numbers in milliseconds) and ISO strings
      const date = typeof createdAt === 'number'
        ? new Date(createdAt) // Unix timestamp in milliseconds
        : new Date(createdAt);

      if (isNaN(date.getTime())) return null;

      // Format as YYYY-MM-DD in Eastern timezone
      // toLocaleDateString('en-US') returns MM/DD/YYYY, so rearrange to YYYY-MM-DD
      const parts = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: APP_SETTINGS.TIMEZONE
      }).split('/');
      return `${parts[2]}-${parts[0]}-${parts[1]}`; // YYYY-MM-DD
    } catch {
      return null;
    }
  }
}
