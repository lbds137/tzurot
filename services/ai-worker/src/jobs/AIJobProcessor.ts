/**
 * AI Job Processor - Handles BullMQ jobs for AI generation
 *
 * This is the entry point for processing AI requests.
 * It receives jobs from the queue, uses the RAG service to generate responses,
 * and returns results back to the api-gateway.
 */

import { Job } from 'bullmq';
import { ConversationalRAGService } from '../services/ConversationalRAGService.js';
import { QdrantMemoryAdapter } from '../memory/QdrantMemoryAdapter.js';
import { MessageContent, createLogger, type LoadedPersonality } from '@tzurot/common-types';
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
  personality: LoadedPersonality;

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
      id?: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt?: string;
    }[];
    // Multimodal support
    attachments?: Array<{
      url: string;
      contentType: string;
      name?: string;
      size?: number;
      isVoiceMessage?: boolean;
      duration?: number;
      waveform?: string;
    }>;
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
  attachmentDescriptions?: string;
  error?: string;
  metadata?: {
    retrievedMemories?: number;
    tokensUsed?: number;
    processingTimeMs?: number;
  };
}

export class AIJobProcessor {
  private ragService: ConversationalRAGService;

  constructor(memoryManager?: QdrantMemoryAdapter) {
    // Type assertion needed due to LangChain's complex internal types
    this.ragService = new ConversationalRAGService(memoryManager as any) as ConversationalRAGService;
  }

  /**
   * Process a single AI generation job
   */
  async processJob(job: Job<AIJobData>): Promise<AIJobResult> {
    const startTime = Date.now();
    const { requestId, personality, message, context, userApiKey } = job.data;

    logger.info(`[AIJobProcessor] Processing job ${job.id} (${requestId}) for ${personality.name}`);

    try {
      // Calculate oldest timestamp from conversation history (for LTM deduplication)
      let oldestHistoryTimestamp: number | undefined;
      if (context.conversationHistory && context.conversationHistory.length > 0) {
        const timestamps = context.conversationHistory
          .map(msg => msg.createdAt ? new Date(msg.createdAt).getTime() : null)
          .filter((t): t is number => t !== null);

        if (timestamps.length > 0) {
          oldestHistoryTimestamp = Math.min(...timestamps);
          logger.debug(`[AIJobProcessor] Oldest conversation message: ${new Date(oldestHistoryTimestamp).toISOString()}`);
        }
      }

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
          conversationHistory,
          oldestHistoryTimestamp,
          attachments: context.attachments
        },
        userApiKey
      )) as { content: string; retrievedMemories?: number; tokensUsed?: number; attachmentDescriptions?: string };

      const processingTimeMs = Date.now() - startTime;

      logger.info(`[AIJobProcessor] Job ${job.id} completed in ${processingTimeMs}ms`);

      return {
        requestId,
        success: true,
        content: response.content,
        attachmentDescriptions: response.attachmentDescriptions,
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
    history: { role: 'user' | 'assistant' | 'system'; content: string; createdAt?: string }[]
  ): BaseMessage[] {
    return history.map(msg => {
      // Format content with relative timestamp if available
      const content = msg.createdAt
        ? `[${this.formatRelativeTime(msg.createdAt)}] ${msg.content}`
        : msg.content;

      if (msg.role === 'user') {
        return new HumanMessage(content);
      } else if (msg.role === 'assistant') {
        return new AIMessage(content);
      } else {
        // System messages are handled separately in the prompt
        return new HumanMessage(content);
      }
    });
  }

  /**
   * Format timestamp as relative time (e.g., "5 minutes ago", "2 hours ago")
   * Uses Eastern timezone for absolute dates
   */
  private formatRelativeTime(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;

      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;

      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;

      // For older messages, show absolute date in Eastern timezone (YYYY-MM-DD)
      // toLocaleDateString('en-US') returns MM/DD/YYYY, so rearrange to YYYY-MM-DD
      const parts = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'America/New_York'
      }).split('/');
      return `${parts[2]}-${parts[0]}-${parts[1]}`; // YYYY-MM-DD
    } catch {
      return '';
    }
  }

  /**
   * Health check - verify RAG service is working
   */
  healthCheck(): boolean {
    // TODO: Add actual health check
    return true;
  }
}
