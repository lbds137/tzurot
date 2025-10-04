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
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { VectorMemoryManager, MemoryQueryOptions } from '../memory/VectorMemoryManager.js';
import { MessageContent, createLogger, type LoadedPersonality } from '@tzurot/common-types';
import { createChatModel, getModelCacheKey } from './ModelFactory.js';
import { formatAttachments } from './MultimodalFormatter.js';
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
}

export class ConversationalRAGService {
  private memoryManager?: VectorMemoryManager;
  private models = new Map<string, BaseChatModel>();

  constructor(memoryManager?: VectorMemoryManager) {
    this.memoryManager = memoryManager;
  }

  /**
   * Get or create a chat model for a specific configuration
   * This supports BYOK (Bring Your Own Key) - different users can use different keys
   */
  private getModel(
    modelName?: string,
    apiKey?: string,
    temperature?: number
  ): BaseChatModel {
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
      // 1. Format the user's message
      const userMessage = this.formatUserMessage(message, context);

      // Process attachments early (needed for history storage later)
      let processedAttachments: ProcessedAttachment[] = [];

      // 2. Fetch user's persona if available
      const userPersona = await this.getUserPersona(context.userId);
      if (userPersona) {
        logger.info(`[RAG] Loaded user persona for ${context.userId}: ${userPersona.substring(0, 100)}...`);
      } else {
        logger.warn(`[RAG] No user persona found for ${context.userId}`);
      }

      // 3. Query vector store for relevant memories
      // Use oldestHistoryTimestamp to avoid retrieving memories that overlap with conversation history
      if (context.oldestHistoryTimestamp) {
        logger.debug(`[RAG] Excluding memories newer than ${new Date(context.oldestHistoryTimestamp).toISOString()} to avoid duplicate context`);
      }

      const memoryQueryOptions: MemoryQueryOptions = {
        personalityId: personality.id, // Use personality UUID
        userId: context.userId,
        sessionId: context.sessionId,
        limit: personality.memoryLimit || 15, // Use personality config or default to 15
        scoreThreshold: personality.memoryScoreThreshold || 0.15, // Use personality config or default to 0.15
        excludeNewerThan: context.oldestHistoryTimestamp, // Filter out memories that overlap with conversation history
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
          const score = doc.metadata?.score || 0;
          const timestamp = this.formatMemoryTimestamp(doc.metadata?.createdAt);
          const content = doc.pageContent.substring(0, 120);
          const truncated = doc.pageContent.length > 120 ? '...' : '';

          logger.info(`[RAG] Memory ${idx + 1}: id=${id} score=${score.toFixed(3)} date=${timestamp || 'unknown'} content="${content}${truncated}"`);
        });
      } else {
        logger.debug(`[RAG] No memory retrieval (${this.memoryManager !== undefined ? 'no memories found' : 'memory disabled'})`);
      }

      // 4. Build the prompt with user persona and memory context
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

      // 5. Build conversation history
      const messages: BaseMessage[] = [];

      // Add current date/time context for relative timestamps
      const now = new Date();
      const dateContext = `\n\n## Current Context\nCurrent date and time: ${now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/New_York',
        timeZoneName: 'short'
      })}`;

      // System message with jailbreak/behavior rules, personality, user persona, and memory
      const fullSystemPrompt = `${systemPrompt}${personaContext}${memoryContext}${dateContext}`;

      // Log prompt size breakdown
      logger.info(`[RAG] Prompt composition: system=${systemPrompt.length} persona=${personaContext.length} memories=${memoryContext.length} dateContext=${dateContext.length} total=${fullSystemPrompt.length} chars`);
      logger.debug(`[RAG] Full system prompt:\n${fullSystemPrompt.substring(0, 1000)}...\n[truncated, total length: ${fullSystemPrompt.length}]`);

      messages.push(new SystemMessage(fullSystemPrompt));

      // Add conversation history if available
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const historyLimit = personality.contextWindow || 10;
        const recentHistory = context.conversationHistory.slice(-historyLimit);
        messages.push(...recentHistory);
        logger.info(`[RAG] Including ${recentHistory.length} conversation history messages (limit: ${historyLimit})`);
      }

      // Add current user message
      messages.push(new HumanMessage(userMessage));

      // 5. Get the appropriate model (provider determined by AI_PROVIDER env var)
      const model = this.getModel(
        personality.model,
        userApiKey,
        personality.temperature
      );

      // 6. Invoke the model
      const response = await model.invoke(messages);

      const content = response.content as string;

      logger.info(`[RAG] Generated ${content.length} chars for ${personality.name}`);

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
        attachmentDescriptions
      };

    } catch (error) {
      // Pino requires error objects to be passed with the 'err' key for proper serialization
      logger.error({ err: error }, `[RAG] Error generating response for ${personality.name}`);
      throw error;
    }
  }

  /**
   * Stream a response using conversational RAG
   */
  async *streamResponse(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    userApiKey?: string
  ): AsyncGenerator<string, void, unknown> {
    try {
      // Similar setup to generateResponse
      const userMessage = this.formatUserMessage(message, context);

      const memoryQueryOptions: MemoryQueryOptions = {
        personalityId: personality.id, // Use personality UUID
        userId: context.userId,
        sessionId: context.sessionId,
        limit: personality.memoryLimit || 15, // Use personality config or default to 15
        scoreThreshold: personality.memoryScoreThreshold || 0.15, // Use personality config or default to 0.15
        excludeNewerThan: context.oldestHistoryTimestamp, // Filter out memories that overlap with conversation history
        includeGlobal: true,
        includePersonal: true,
        includeSession: !!context.sessionId
      };

      const relevantMemories = this.memoryManager !== undefined
        ? await this.memoryManager.queryMemories(userMessage, memoryQueryOptions)
        : [];

      const memoryContext = relevantMemories.length > 0
        ? '\n\nRelevant memories and past interactions:\n' +
          relevantMemories.map((doc: { pageContent: string; metadata?: { createdAt?: string | number } }) => {
            const timestamp = this.formatMemoryTimestamp(doc.metadata?.createdAt);
            return `- ${timestamp ? `[${timestamp}] ` : ''}${doc.pageContent}`;
          }).join('\n')
        : '';

      const messages: BaseMessage[] = [];

      const systemPrompt = this.buildSystemPrompt(personality);

      // Fetch user's persona
      const userPersona = await this.getUserPersona(context.userId);
      const personaContext = userPersona
        ? `\n\n## About the User You're Speaking With (${context.userName})\nThe following describes the user you are conversing with. This is NOT about you - this is about the person messaging you:\n\n${userPersona}`
        : '';

      // Add current date/time context
      const now = new Date();
      const dateContext = `\n\n## Current Context\nCurrent date and time: ${now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/New_York',
        timeZoneName: 'short'
      })}`;


      messages.push(new SystemMessage(
        `${systemPrompt}${personaContext}${memoryContext}${dateContext}`
      ));

      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const historyLimit = personality.contextWindow || 10;
        const recentHistory = context.conversationHistory.slice(-historyLimit);
        messages.push(...recentHistory);
      }

      // Process attachments to get text descriptions (for history/LTM)
      let processedAttachments: ProcessedAttachment[] = [];
      if (context.attachments && context.attachments.length > 0) {
        processedAttachments = await processAttachments(context.attachments, personality);
        logger.info(
          { count: processedAttachments.length },
          'Processed attachments to text descriptions'
        );
      }

      // Build human message with multimodal support
      if (processedAttachments.length > 0) {
        // Multimodal message: send both raw media (current turn) + text description
        const provider = process.env.AI_PROVIDER || 'openrouter';
        const mediaContent = await formatAttachments(context.attachments!, provider);

        if (mediaContent && mediaContent.length > 0) {
          // Build content array: text first (if present), then media
          const content: Array<{ type: string; text?: string; data?: string; mime_type?: string }> = [];

          // Combine user message with attachment descriptions for context
          let fullText = userMessage.trim();
          const descriptions = processedAttachments
            .map(a => a.description)
            .filter(d => d && !d.startsWith('['))
            .join('\n\n');

          if (descriptions) {
            fullText = fullText
              ? `${fullText}\n\n[Attached media descriptions for context:\n${descriptions}]`
              : `[Attached media:\n${descriptions}]`;
          }

          if (fullText.length > 0) {
            content.push({ type: 'text', text: fullText });
          }

          // Add formatted media content (raw images/audio for this turn)
          content.push(...mediaContent as any[]);

          messages.push(new HumanMessage({ content }));

          logger.info(
            { attachmentCount: context.attachments!.length, hasText: userMessage.trim().length > 0, provider },
            'Created multimodal message with descriptions'
          );
        } else {
          // Fallback: use descriptions only if media formatting failed
          const descriptions = processedAttachments
            .map(a => a.description)
            .join('\n\n');
          const fullText = userMessage.trim()
            ? `${userMessage}\n\n${descriptions}`
            : descriptions;
          messages.push(new HumanMessage(fullText));
        }
      } else {
        // Text-only message
        messages.push(new HumanMessage(userMessage));
      }

      const model = this.getModel(
        personality.model,
        userApiKey,
        personality.temperature
      );

      // Stream the response
      let fullResponse = '';
      const stream = await model.stream(messages);

      for await (const chunk of stream) {
        const content = chunk.content as string;
        fullResponse += content;
        yield content;
      }

      // Store the full interaction after streaming completes
      await this.storeInteraction(personality, userMessage, fullResponse, context);

    } catch (error) {
      logger.error({ err: error }, `[RAG] Stream error for ${personality.name}`);
      throw error;
    }
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
        timeZone: 'America/New_York'
      }).split('/');
      return `${parts[2]}-${parts[0]}-${parts[1]}`; // YYYY-MM-DD
    } catch {
      return null;
    }
  }
}
