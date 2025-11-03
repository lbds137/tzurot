/**
 * AI Job Processor - Handles BullMQ jobs for AI generation
 *
 * This is the entry point for processing AI requests.
 * It receives jobs from the queue, uses the RAG service to generate responses,
 * and returns results back to the api-gateway.
 */

import { Job } from 'bullmq';
import { ConversationalRAGService, type RAGResponse } from '../services/ConversationalRAGService.js';
import { PgvectorMemoryAdapter } from '../memory/PgvectorMemoryAdapter.js';
import {
  MessageContent,
  createLogger,
  type LoadedPersonality,
  type ReferencedMessage,
  formatRelativeTime,
} from '@tzurot/common-types';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { stripPersonalityPrefix } from '../utils/responseCleanup.js';

const logger = createLogger('AIJobProcessor');

/**
 * Structure of data passed in the BullMQ job
 */
export interface AIJobData {
  // Request identification
  requestId: string;
  jobType: 'generate' | 'transcribe';

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
    // Active speaker - the persona making the current request
    activePersonaId?: string;
    activePersonaName?: string;
    conversationHistory?: {
      id?: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt?: string;
      personaId?: string;
      personaName?: string;
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
    // Discord environment context
    environment?: {
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
    };
    // Referenced messages (from replies and message links)
    referencedMessages?: ReferencedMessage[];
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
    modelUsed?: string;
  };
}

export class AIJobProcessor {
  private ragService: ConversationalRAGService;

  constructor(memoryManager?: PgvectorMemoryAdapter) {
    this.ragService = new ConversationalRAGService(memoryManager);
  }

  /**
   * Process a single AI generation job
   */
  async processJob(job: Job<AIJobData>): Promise<AIJobResult> {
    const { jobType } = job.data;

    // Route to appropriate handler based on job type
    if (jobType === 'transcribe') {
      return this.processTranscribeJob(job);
    }

    // Default: generate job
    return this.processGenerateJob(job);
  }

  /**
   * Process a transcribe-only job (no LLM, just Whisper transcription)
   */
  private async processTranscribeJob(job: Job<AIJobData>): Promise<AIJobResult> {
    const startTime = Date.now();
    const { requestId, context } = job.data;

    logger.info(`[AIJobProcessor] Processing transcribe job ${job.id} (${requestId})`);

    try {
      // Find voice attachment
      const voiceAttachment = context.attachments?.find(a =>
        a.contentType.startsWith('audio/') || a.isVoiceMessage
      );

      if (!voiceAttachment) {
        throw new Error('No voice attachment found in transcribe job');
      }

      // Import transcribeAudio dynamically to avoid circular dependencies
      const { transcribeAudio } = await import('../services/MultimodalProcessor.js');

      // Transcribe the audio (we don't need a real personality, just pass a minimal one)
      const transcript = await transcribeAudio(voiceAttachment, {} as LoadedPersonality);

      const processingTimeMs = Date.now() - startTime;
      logger.info(`[AIJobProcessor] Transcribe job ${job.id} completed in ${processingTimeMs}ms`);

      return {
        requestId,
        success: true,
        content: transcript,
        metadata: {
          processingTimeMs
        }
      };

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      logger.error({ err: error }, `[AIJobProcessor] Transcribe job ${job.id} failed`);

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
   * Process a standard AI generation job
   */
  private async processGenerateJob(job: Job<AIJobData>): Promise<AIJobResult> {
    const startTime = Date.now();
    const { requestId, personality, message, context, userApiKey } = job.data;

    logger.info(`[AIJobProcessor] Processing generate job ${job.id} (${requestId}) for ${personality.name}`);

    // Debug: Check if referencedMessages exists in job data
    logger.info(
      `[AIJobProcessor] Job data context inspection: ` +
      `hasReferencedMessages=${!!context.referencedMessages}, ` +
      `count=${context.referencedMessages?.length || 0}, ` +
      `type=${typeof context.referencedMessages}, ` +
      `contextKeys=[${Object.keys(context).join(', ')}]`
    );

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

      // Extract unique participants BEFORE converting to BaseMessage
      const participants = this.extractParticipants(
        context.conversationHistory ?? [],
        context.activePersonaId,
        context.activePersonaName
      );

      // Convert conversation history to BaseMessage format
      const conversationHistory = this.convertConversationHistory(
        context.conversationHistory ?? [],
        personality.name
      );

      // Generate response using RAG
      const response: RAGResponse = await this.ragService.generateResponse(
        personality,
        message as MessageContent,
        {
          userId: context.userId,
          userName: context.userName,
          channelId: context.channelId,
          serverId: context.serverId,
          sessionId: context.sessionId,
          isProxyMessage: context.isProxyMessage,
          activePersonaId: context.activePersonaId,
          activePersonaName: context.activePersonaName,
          conversationHistory,
          oldestHistoryTimestamp,
          participants,
          attachments: context.attachments,
          environment: context.environment
        },
        userApiKey
      );

      const processingTimeMs = Date.now() - startTime;

      logger.info(`[AIJobProcessor] Job ${job.id} completed in ${processingTimeMs}ms`);

      // Defensively strip personality prefix if model ignored prompt instructions
      const cleanedContent = stripPersonalityPrefix(response.content, personality.name);

      const jobResult = {
        requestId,
        success: true,
        content: cleanedContent,
        attachmentDescriptions: response.attachmentDescriptions,
        metadata: {
          retrievedMemories: response.retrievedMemories,
          tokensUsed: response.tokensUsed,
          processingTimeMs,
          modelUsed: response.modelUsed
        }
      };

      logger.debug({ jobResult }, '[AIJobProcessor] Returning job result');

      return jobResult;

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
   * Extract unique participants from conversation history
   * Returns list of all personas involved in the conversation
   */
  private extractParticipants(
    history: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      personaId?: string;
      personaName?: string;
    }[],
    activePersonaId?: string,
    activePersonaName?: string
  ): Array<{ personaId: string; personaName: string; isActive: boolean }> {
    const uniquePersonas = new Map<string, string>(); // personaId -> personaName

    const userMessagesWithPersona = history.filter(m => m.role === 'user' && m.personaId && m.personaName).length;
    logger.debug(`[AIJobProcessor] Extracting participants: activePersonaId=${activePersonaId}, activePersonaName=${activePersonaName}, historyLength=${history.length}, userMessagesWithPersona=${userMessagesWithPersona}`);

    // Extract from history
    for (const msg of history) {
      if (msg.role === 'user' && msg.personaId && msg.personaName) {
        logger.debug(`[AIJobProcessor] Found participant in history: ${msg.personaName} (${msg.personaId})`);
        uniquePersonas.set(msg.personaId, msg.personaName);
      }
    }

    // Ensure active persona is included (even if not in history yet)
    if (activePersonaId && activePersonaName) {
      logger.debug(`[AIJobProcessor] Including active persona: ${activePersonaName} (${activePersonaId})`);
      uniquePersonas.set(activePersonaId, activePersonaName);
    } else {
      logger.debug(`[AIJobProcessor] Active persona not included - hasActivePersonaId: ${!!activePersonaId}, hasActivePersonaName: ${!!activePersonaName}, activePersonaId: ${activePersonaId}, activePersonaName: ${activePersonaName}`);
    }

    logger.debug(`[AIJobProcessor] Found ${uniquePersonas.size} unique participant(s)`);

    // Convert to array with isActive flag
    return Array.from(uniquePersonas.entries()).map(([personaId, personaName]) => ({
      personaId,
      personaName,
      isActive: personaId === activePersonaId
    }));
  }

  /**
   * Convert simple conversation history to LangChain BaseMessage format
   * Includes persona names to help the AI understand who is speaking
   */
  private convertConversationHistory(
    history: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt?: string;
      personaId?: string;
      personaName?: string;
    }[],
    personalityName: string
  ): BaseMessage[] {
    return history.map(msg => {
      // Format message with speaker name and timestamp
      let content = msg.content;

      // For user messages, include persona name and timestamp
      if (msg.role === 'user') {
        const parts: string[] = [];

        if (msg.personaName) {
          parts.push(`${msg.personaName}:`);
        }

        if (msg.createdAt) {
          parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
        }

        if (parts.length > 0) {
          content = `${parts.join(' ')} ${msg.content}`;
        }
      }

      // For assistant messages, include personality name and timestamp
      if (msg.role === 'assistant') {
        const parts: string[] = [];

        // Use the personality name (e.g., "Lilith")
        parts.push(`${personalityName}:`);

        if (msg.createdAt) {
          parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
        }

        content = `${parts.join(' ')} ${msg.content}`;
      }

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
   * Health check - verify RAG service is working
   */
  healthCheck(): boolean {
    // TODO: Add actual health check
    return true;
  }
}
