/**
 * Conversational RAG Service - Uses LangChain for memory-augmented conversations
 *
 * This implements the architecture from the Gemini conversation:
 * - Uses vector store for long-term memory retrieval
 * - Manages conversation history
 * - Builds prompts with system message, memory, and history
 * - Supports streaming responses
 */

import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage
} from '@langchain/core/messages';
import { VectorMemoryManager, MemoryQueryOptions } from '../memory/VectorMemoryManager';
import { Personality, MessageContent } from '@tzurot/common-types';
import { pino } from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

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
  private memoryManager: VectorMemoryManager;
  private models = new Map<string, ChatOpenAI>();

  constructor(memoryManager: VectorMemoryManager) {
    this.memoryManager = memoryManager;
  }

  /**
   * Get or create a ChatOpenAI model for a specific API key
   * This supports BYOK (Bring Your Own Key) - different users can use different keys
   */
  private getModel(
    modelName: string,
    apiKey: string,
    baseURL?: string,
    temperature?: number
  ): ChatOpenAI {
    const cacheKey = `${modelName}-${apiKey.substring(0, 10)}`;

    if (!this.models.has(cacheKey)) {
      this.models.set(cacheKey, new ChatOpenAI({
        modelName,
        openAIApiKey: apiKey,
        temperature: temperature ?? 0.7,
        configuration: baseURL ? { baseURL } : undefined,
        streaming: true // Enable streaming by default
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

      const relevantMemories = await this.memoryManager.queryMemories(
        userMessage,
        memoryQueryOptions
      );

      logger.info(`[RAG] Retrieved ${relevantMemories.length} relevant memories for ${personality.name}`);

      // 3. Build the prompt with memory context
      const memoryContext = relevantMemories.length > 0
        ? '\n\nRelevant memories and past interactions:\n' +
          relevantMemories.map(doc => `- ${doc.pageContent}`).join('\n')
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

      // 5. Get the appropriate model
      const apiKey = userApiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('No API key available - user must provide one or set OPENROUTER_API_KEY');
      }

      const model = this.getModel(
        personality.model || 'gpt-3.5-turbo',
        apiKey,
        process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
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
      logger.error(`[RAG] Error generating response for ${personality.name}:`, error);
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

      const relevantMemories = await this.memoryManager.queryMemories(
        userMessage,
        memoryQueryOptions
      );

      const memoryContext = relevantMemories.length > 0
        ? '\n\nRelevant memories and past interactions:\n' +
          relevantMemories.map(doc => `- ${doc.pageContent}`).join('\n')
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

      const apiKey = userApiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('No API key available');
      }

      const model = this.getModel(
        personality.model || 'gpt-3.5-turbo',
        apiKey,
        process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
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
