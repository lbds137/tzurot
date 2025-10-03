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
import { Personality, MessageContent, createLogger } from '@tzurot/common-types';
import { createChatModel, getModelCacheKey } from './ModelFactory.js';

const logger = createLogger('ConversationalRAGService');

export interface ConversationContext {
  userId: string;
  channelId?: string;
  serverId?: string;
  sessionId?: string;
  userName?: string;
  isProxyMessage?: boolean;
  conversationHistory?: BaseMessage[];
}

export interface RAGResponse {
  content: string;
  retrievedMemories?: number;
  tokensUsed?: number;
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
    personality: Personality,
    message: MessageContent,
    context: ConversationContext,
    userApiKey?: string
  ): Promise<RAGResponse> {
    try {
      // 1. Format the user's message
      const userMessage = this.formatUserMessage(message, context);

      // 2. Query vector store for relevant memories
      const memoryQueryOptions: MemoryQueryOptions = {
        personalityId: personality.name,
        userId: context.userId,
        sessionId: context.sessionId,
        limit: 10,
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
      } else {
        logger.debug(`[RAG] No memory retrieval (${this.memoryManager !== undefined ? 'no memories found' : 'memory disabled'})`);
      }

      // 3. Build the prompt with memory context
      const memoryContext = relevantMemories.length > 0
        ? '\n\nRelevant memories and past interactions:\n' +
          relevantMemories.map((doc: { pageContent: string }) => `- ${doc.pageContent}`).join('\n')
        : '';

      // 4. Build conversation history
      const messages: BaseMessage[] = [];

      // System message with personality and memory
      messages.push(new SystemMessage(
        `${personality.systemPrompt}${memoryContext}`
      ));

      // Add conversation history if available
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const historyLimit = personality.contextWindow || 10;
        const recentHistory = context.conversationHistory.slice(-historyLimit);
        messages.push(...recentHistory);
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

      return {
        content,
        retrievedMemories: relevantMemories.length,
        tokensUsed: response.response_metadata?.tokenUsage?.totalTokens
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
    personality: Personality,
    message: MessageContent,
    context: ConversationContext,
    userApiKey?: string
  ): AsyncGenerator<string, void, unknown> {
    try {
      // Similar setup to generateResponse
      const userMessage = this.formatUserMessage(message, context);

      const memoryQueryOptions: MemoryQueryOptions = {
        personalityId: personality.name,
        userId: context.userId,
        sessionId: context.sessionId,
        limit: 10,
        includeGlobal: true,
        includePersonal: true,
        includeSession: !!context.sessionId
      };

      const relevantMemories = this.memoryManager !== undefined
        ? await this.memoryManager.queryMemories(userMessage, memoryQueryOptions)
        : [];

      const memoryContext = relevantMemories.length > 0
        ? '\n\nRelevant memories and past interactions:\n' +
          relevantMemories.map((doc: { pageContent: string }) => `- ${doc.pageContent}`).join('\n')
        : '';

      const messages: BaseMessage[] = [];

      messages.push(new SystemMessage(
        `${personality.systemPrompt}${memoryContext}`
      ));

      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const historyLimit = personality.contextWindow || 10;
        const recentHistory = context.conversationHistory.slice(-historyLimit);
        messages.push(...recentHistory);
      }

      messages.push(new HumanMessage(userMessage));

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
      logger.error(`[RAG] Stream error for ${personality.name}:`, error);
      throw error;
    }
  }

  /**
   * Store an interaction in the vector database for future retrieval
   */
  private async storeInteraction(
    personality: Personality,
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
            personalityId: personality.name,
            userId: context.userId,
            sessionId: context.sessionId,
          canonScope,
          timestamp: Date.now(),
          contextType: context.channelId ? 'channel' : 'dm',
          channelId: context.channelId,
          serverId: context.serverId
        }
        });

        logger.debug(`[RAG] Stored interaction in ${canonScope} canon for ${personality.name}`);
      } else {
        logger.debug(`[RAG] Memory storage disabled - interaction not stored`);
      }

    } catch (error) {
      logger.error('[RAG] Failed to store interaction:', error);
      // Don't throw - this is a non-critical error
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
