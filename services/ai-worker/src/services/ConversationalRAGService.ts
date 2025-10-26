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
import { QdrantMemoryAdapter, MemoryQueryOptions } from '../memory/QdrantMemoryAdapter.js';
import {
  MessageContent,
  createLogger,
  type LoadedPersonality,
  AI_DEFAULTS,
  TEXT_LIMITS,
  getPrismaClient,
  formatFullDateTime,
  formatMemoryTimestamp,
  getConfig,
} from '@tzurot/common-types';
import { createChatModel, getModelCacheKey, type ChatModelResult } from './ModelFactory.js';
import { processAttachments, type ProcessedAttachment } from './MultimodalProcessor.js';

const logger = createLogger('ConversationalRAGService');
const config = getConfig();

export interface AttachmentMetadata {
  url: string;
  contentType: string;
  name?: string;
  size?: number;
  isVoiceMessage?: boolean;
  duration?: number;
  waveform?: string;
}

/**
 * Memory document structure from Qdrant vector search
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

      // 6. Build the prompt with ALL participant personas and memory context
      const fullSystemPrompt = this.buildFullSystemPrompt(personality, participantPersonas, relevantMemories, context);

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
      const humanMessage = await this.buildHumanMessage(userMessage, processedAttachments);
      messages.push(humanMessage);

      // DEBUG: Log current message to verify it's not duplicating history
      if (config.NODE_ENV === 'development') {
        const currentContent = humanMessage.content.toString();
        logger.debug(`[RAG] Current user message (${currentContent.length} chars): ${currentContent.substring(0, TEXT_LIMITS.LOG_PREVIEW)}${currentContent.length > TEXT_LIMITS.LOG_PREVIEW ? '...' : ''}`);
      }

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
        tokensUsed: response.usage_metadata?.total_tokens,
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
   * Build full system prompt with personas, memories, and date context
   */
  private buildFullSystemPrompt(
    personality: LoadedPersonality,
    participantPersonas: Map<string, { content: string; isActive: boolean }>,
    relevantMemories: MemoryDocument[],
    context: ConversationContext
  ): string {
    const systemPrompt = this.buildSystemPrompt(personality);
    logger.debug(`[RAG] System prompt length: ${systemPrompt.length} chars`);

    // Current date/time context (place early for better awareness)
    const dateContext = `\n\n## Current Context\nCurrent date and time: ${formatFullDateTime(new Date())}`;

    // Discord environment context (where conversation is happening)
    const environmentContext = context.environment
      ? `\n\n${this.formatEnvironmentContext(context.environment)}`
      : '';

    // Conversation participants - ALL people involved
    let participantsContext = '';
    if (participantPersonas.size > 0) {
      const participantsList: string[] = [];

      for (const [personaName, { content, isActive }] of participantPersonas.entries()) {
        const activeIndicator = isActive ? ' **(CURRENT SPEAKER)**' : '';
        participantsList.push(`### ${personaName}${activeIndicator}\n${content}`);
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

    const fullSystemPrompt = `${systemPrompt}${dateContext}${environmentContext}${participantsContext}${memoryContext}`;

    // Basic prompt composition logging (always)
    logger.info(`[RAG] Prompt composition: system=${systemPrompt.length} dateContext=${dateContext.length} environment=${environmentContext.length} participants=${participantsContext.length} memories=${memoryContext.length} total=${fullSystemPrompt.length} chars`);

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
   * Store an interaction in both conversation_history and Qdrant (with pending_memories safety)
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

      // 2. Save assistant response to conversation_history
      const conversationRecord = await prisma.conversationHistory.create({
        data: {
          channelId: context.channelId || 'dm',
          personalityId: personality.id,
          personaId: personaId,
          role: 'assistant',
          content: aiResponse,
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


      // 3. Determine canon scope and prepare memory metadata
      const canonScope: 'global' | 'personal' | 'session' = context.sessionId ? 'session' : 'personal';
      const interactionText = `User (${context.userName || context.userId}): ${userMessage}\n${personality.name}: ${aiResponse}`;

      const memoryMetadata = {
        personaId,
        personalityId: personality.id,
        personalityName: personality.name,
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
        logger.debug(`[RAG] Memory storage disabled - interaction not stored in Qdrant`);
        return;
      }

      // 4. Create pending_memory record (safety net for Qdrant storage)
      const pendingMemory = await prisma.pendingMemory.create({
        data: {
          conversationHistoryId,
          personaId,
          personalityId: personality.id,
          personalityName: personality.name,
          text: interactionText,
          metadata: memoryMetadata as any, // Cast to any for Prisma Json type
          attempts: 0,
        }
      });
      pendingMemoryId = pendingMemory.id;
      logger.debug(`[RAG] Created pending_memory (${pendingMemoryId})`);

      // 5. Try to store to Qdrant
      await this.memoryManager.addMemory({
        text: interactionText,
        metadata: memoryMetadata
      });

      // 6. Success! Delete the pending_memory
      await prisma.pendingMemory.delete({
        where: { id: pendingMemoryId }
      });
      logger.info(`[RAG] Stored interaction in ${canonScope} canon for ${personality.name} (persona: ${personaId})`);

    } catch (error) {
      logger.error({ err: error }, '[RAG] Failed to store interaction to Qdrant');

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
      logger.error({ err: error }, `[RAG] Failed to fetch persona ${personaId}`);
      return null;
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
      logger.error({ err: error }, `[RAG] Failed to resolve persona for user ${userId}`);
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

}
