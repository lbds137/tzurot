/**
 * AI Job Processor - Handles BullMQ jobs for AI generation
 *
 * This is the entry point for processing AI requests.
 * It receives jobs from the queue, uses the RAG service to generate responses,
 * and returns results back to the api-gateway.
 */

import { Job } from 'bullmq';
import { ConversationalRAGService } from '../services/ConversationalRAGService.js';
import { VectorMemoryManager } from '../memory/VectorMemoryManager.js';
import { Personality, MessageContent, createLogger } from '@tzurot/common-types';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

const logger = createLogger('AIJobProcessor');

/**
 * Structure of data passed in the BullMQ job
 */
export interface AIJobData {
  // Request identification
  requestId: string;
  jobType: 'generate' | 'stream';

  // Personality
  personality: Personality;

  // User message
  message: string | object;

  // Context
  context: {
    userId: string;
    userName?: string;
    channelId?: string;
    serverId?: string;
    sessionId?: string;
    isProxyMessage?: boolean;
    conversationHistory?: {
      role: 'user' | 'assistant' | 'system';
      content: string;
    }[];
  };

  // User's API key (for BYOK)
  userApiKey?: string;

  // Response destination (where to send the result)
  responseDestination: {
    type: 'discord' | 'webhook' | 'api';
    channelId?: string;
    webhookUrl?: string;
    callbackUrl?: string;
  };
}

/**
 * Structure of the job result
 */
export interface AIJobResult {
  requestId: string;
  success: boolean;
  content?: string;
  error?: string;
  metadata?: {
    retrievedMemories?: number;
    tokensUsed?: number;
    processingTimeMs?: number;
  };
}

export class AIJobProcessor {
  private ragService: ConversationalRAGService;

  constructor(memoryManager: VectorMemoryManager) {
    // Type assertion needed due to LangChain's complex internal types
    this.ragService = new ConversationalRAGService(memoryManager) as ConversationalRAGService;
  }

  /**
   * Process a single AI generation job
   */
  async processJob(job: Job<AIJobData>): Promise<AIJobResult> {
    const startTime = Date.now();
    const { requestId, personality, message, context, userApiKey } = job.data;

    logger.info(`[AIJobProcessor] Processing job ${job.id} (${requestId}) for ${personality.name}`);

    try {
      // Convert conversation history to BaseMessage format
      const conversationHistory = this.convertConversationHistory(
        context.conversationHistory ?? []
      );

      // Generate response using RAG
      // Type assertion needed due to LangChain's complex return types
      const response = (await this.ragService.generateResponse(
        personality,
        message as MessageContent,
        {
          userId: context.userId,
          userName: context.userName,
          channelId: context.channelId,
          serverId: context.serverId,
          sessionId: context.sessionId,
          isProxyMessage: context.isProxyMessage,
          conversationHistory
        },
        userApiKey
      )) as { content: string; retrievedMemories?: number; tokensUsed?: number };

      const processingTimeMs = Date.now() - startTime;

      logger.info(`[AIJobProcessor] Job ${job.id} completed in ${processingTimeMs}ms`);

      return {
        requestId,
        success: true,
        content: response.content,
        metadata: {
          retrievedMemories: response.retrievedMemories,
          tokensUsed: response.tokensUsed,
          processingTimeMs
        }
      };

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      // Pino requires error objects to be passed with the 'err' key for proper serialization
      logger.error({ err: error }, `[AIJobProcessor] Job ${job.id} failed`);

      return {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          processingTimeMs
        }
      };
    }
  }

  /**
   * Process a streaming job
   * Note: BullMQ doesn't natively support streaming, so we'll need to handle this differently
   * For now, we'll just generate the full response and return it
   *
   * TODO: Implement actual streaming via WebSockets or Server-Sent Events
   */
  async processStreamJob(job: Job<AIJobData>): Promise<AIJobResult> {
    // For now, just use regular generation
    // In the future, we could:
    // 1. Open a WebSocket connection to the api-gateway
    // 2. Stream chunks as they're generated
    // 3. Close connection when done

    logger.warn(`[AIJobProcessor] Stream job ${job.id} - falling back to regular generation`);
    return this.processJob(job);
  }

  /**
   * Convert simple conversation history to LangChain BaseMessage format
   */
  private convertConversationHistory(
    history: { role: 'user' | 'assistant' | 'system'; content: string }[]
  ): BaseMessage[] {
    return history.map(msg => {
      if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else if (msg.role === 'assistant') {
        return new AIMessage(msg.content);
      } else {
        // System messages are handled separately in the prompt
        return new HumanMessage(msg.content);
      }
    });
  }

  /**
   * Health check - verify RAG service is working
   */
  healthCheck(): boolean {
    // TODO: Add actual health check
    return true;
  }
}
