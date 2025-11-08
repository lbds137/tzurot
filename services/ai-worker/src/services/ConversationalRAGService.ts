/**
 * Conversational RAG Service - Orchestrates memory-augmented conversations
 *
 * Refactored architecture (2025-11-07):
 * - Modular components for better testability and maintainability
 * - LLMInvoker: Model management and invocation
 * - MemoryRetriever: LTM queries and persona lookups
 * - PromptBuilder: System prompt construction
 * - LongTermMemoryService: pgvector storage
 * - MultimodalProcessor: Attachment processing (vision/transcription)
 * - ReferencedMessageFormatter: Reference formatting with vision/transcription
 *
 * This service is now a lightweight orchestrator that coordinates these components.
 */

import { BaseMessage } from '@langchain/core/messages';
import { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import {
  MessageContent,
  createLogger,
  AI_DEFAULTS,
  TEXT_LIMITS,
  AttachmentType,
  type LoadedPersonality,
  type AttachmentMetadata,
  type ReferencedMessage,
} from '@tzurot/common-types';
import { processAttachments } from './MultimodalProcessor.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import { stripPersonalityPrefix } from '../utils/responseCleanup.js';
import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';
import { logAndThrow } from '../utils/errorHandling.js';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import { LLMInvoker } from './LLMInvoker.js';
import { MemoryRetriever } from './MemoryRetriever.js';
import { PromptBuilder } from './PromptBuilder.js';
import { LongTermMemoryService } from './LongTermMemoryService.js';

const logger = createLogger('ConversationalRAGService');

/**
 * Memory document structure from vector search
 */
export interface MemoryDocument {
  pageContent: string;
  metadata?: {
    id?: string;
    createdAt?: string | number;
    score?: number;
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
  // Raw conversation history (for accessing tokenCount before BaseMessage conversion)
  rawConversationHistory?: {
    role: string;
    content: string;
    tokenCount?: number;
  }[];
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
  // For bot-client to store both conversation_history and LTM after Discord send
  userMessageContent?: string; // The actual user message content that was sent to the AI (for LTM storage)
}

export class ConversationalRAGService {
  private llmInvoker: LLMInvoker;
  private memoryRetriever: MemoryRetriever;
  private promptBuilder: PromptBuilder;
  private longTermMemory: LongTermMemoryService;
  private referencedMessageFormatter: ReferencedMessageFormatter;

  constructor(memoryManager?: PgvectorMemoryAdapter) {
    this.llmInvoker = new LLMInvoker();
    this.memoryRetriever = new MemoryRetriever(memoryManager);
    this.promptBuilder = new PromptBuilder();
    this.longTermMemory = new LongTermMemoryService(memoryManager);
    this.referencedMessageFormatter = new ReferencedMessageFormatter();
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
      // ARCHITECTURAL DECISION: Process attachments BEFORE AI generation
      //
      // Why attachments are in the critical path:
      // 1. AI must see attachment content before composing its reply
      //    - Voice transcripts change the meaning of the entire message
      //    - Image descriptions provide crucial context for understanding
      // 2. Processing async would make AI blind to visual/audio context
      // 3. Memory retrieval needs transcript text for semantic search
      // 4. Cannot duplicate processing (expensive: OpenAI vision/Whisper APIs)
      //
      // Trade-off: Adds 5-15s per image, 5-20s per voice message
      // Benefit: AI generates informed responses instead of guessing about attachments
      //
      // Note: This is why we can't do "atomic user message storage" (save before AI call)
      // without two-phase processing - attachment descriptions come from AI worker.

      let processedAttachments: ProcessedAttachment[] = [];
      if (context.attachments && context.attachments.length > 0) {
        processedAttachments = await processAttachments(context.attachments, personality);
        logger.info(
          { count: processedAttachments.length },
          'Processed attachments to text descriptions'
        );
      }

      // Format the user's message (now with transcriptions available)
      const userMessage = this.promptBuilder.formatUserMessage(message, context);

      // Build the actual message text for memory search
      // For voice messages, use transcription instead of "Hello" fallback
      const searchQuery = this.promptBuilder.buildSearchQuery(userMessage, processedAttachments);

      // Fetch ALL participant personas from conversation history
      const participantPersonas = await this.memoryRetriever.getAllParticipantPersonas(context);
      if (participantPersonas.size > 0) {
        logger.info(
          `[RAG] Loaded ${participantPersonas.size} participant persona(s): ${Array.from(participantPersonas.keys()).join(', ')}`
        );
      } else {
        logger.debug(`[RAG] No participant personas found in conversation history`);
      }

      // Query vector store for relevant memories using actual content
      logger.info(
        `[RAG] Memory search query: "${searchQuery.substring(0, TEXT_LIMITS.LOG_PREVIEW)}${searchQuery.length > TEXT_LIMITS.LOG_PREVIEW ? '...' : ''}"`
      );
      const relevantMemories = await this.memoryRetriever.retrieveRelevantMemories(
        personality,
        searchQuery,
        context
      );

      // Format referenced messages (with vision/transcription) for both prompt AND database
      // Now using extracted ReferencedMessageFormatter for parallel attachment processing
      const referencedMessagesDescriptions =
        context.referencedMessages && context.referencedMessages.length > 0
          ? await this.referencedMessageFormatter.formatReferencedMessages(
              context.referencedMessages,
              personality
            )
          : undefined;

      // TOKEN-BASED CONTEXT WINDOW MANAGEMENT
      // Build system prompt first (without history) to count tokens
      const fullSystemMessage = await this.promptBuilder.buildFullSystemPrompt(
        personality,
        participantPersonas,
        relevantMemories,
        context,
        referencedMessagesDescriptions
      );
      const systemPromptTokens = this.promptBuilder.countTokens(fullSystemMessage.content as string);

      // Build current user message to count tokens
      const { message: humanMessage, contentForStorage } =
        await this.promptBuilder.buildHumanMessage(
          userMessage,
          processedAttachments,
          context.activePersonaName,
          referencedMessagesDescriptions
        );
      const currentMessageTokens = this.promptBuilder.countTokens(humanMessage.content as string);

      // Count memory tokens
      const memoryTokens = this.promptBuilder.countMemoryTokens(relevantMemories);

      // Calculate history token budget
      const contextWindowTokens = personality.contextWindowTokens || AI_DEFAULTS.CONTEXT_WINDOW_TOKENS;
      const historyBudget = Math.max(
        0,
        contextWindowTokens - systemPromptTokens - currentMessageTokens - memoryTokens
      );

      logger.info(
        `[RAG] Token budget: total=${contextWindowTokens}, system=${systemPromptTokens}, current=${currentMessageTokens}, memories=${memoryTokens}, historyBudget=${historyBudget}`
      );

      // Build conversation history
      const messages: BaseMessage[] = [];
      messages.push(fullSystemMessage);

      // Add conversation history within token budget
      if (context.conversationHistory && context.conversationHistory.length > 0 && historyBudget > 0) {
        // Work backwards from newest message, counting tokens until budget exhausted
        let historyTokensUsed = 0;
        const historyToInclude: BaseMessage[] = [];
        const rawHistory = context.rawConversationHistory ?? [];

        for (let i = context.conversationHistory.length - 1; i >= 0; i--) {
          const msg = context.conversationHistory[i];
          const rawMsg = rawHistory[i];

          // Use cached token count if available, otherwise compute it
          // (Web Claude optimization: avoid recomputing tokens on every request)
          const msgTokens = rawMsg?.tokenCount ?? this.promptBuilder.countTokens(msg.content as string);

          // Stop if adding this message would exceed budget
          if (historyTokensUsed + msgTokens > historyBudget) {
            logger.debug(
              `[RAG] Stopping history inclusion: would exceed budget (${historyTokensUsed + msgTokens} > ${historyBudget})`
            );
            break;
          }

          historyToInclude.unshift(msg); // Add to front to maintain chronological order
          historyTokensUsed += msgTokens;
        }

        messages.push(...historyToInclude);
        logger.info(
          `[RAG] Including ${historyToInclude.length} history messages (${historyTokensUsed} tokens, budget: ${historyBudget})`
        );
      } else if (historyBudget <= 0) {
        logger.warn(
          `[RAG] No history budget available! System prompt and current message consumed entire context window.`
        );
      }

      // Add current user message last
      messages.push(humanMessage);

      // Get the appropriate model (provider determined by AI_PROVIDER env var)
      const { model, modelName } = this.llmInvoker.getModel(
        personality.model,
        userApiKey,
        personality.temperature
      );

      // Calculate attachment counts for dynamic timeout calculation
      const imageCount =
        context.attachments?.filter(
          att =>
            att.contentType.startsWith('image/') &&
            !att.isVoiceMessage
        ).length ?? 0;
      const audioCount =
        context.attachments?.filter(
          att =>
            att.contentType.startsWith('audio/') ||
            att.isVoiceMessage
        ).length ?? 0;

      // Invoke the model with timeout and retry logic
      const response = await this.llmInvoker.invokeWithRetry(
        model,
        messages,
        modelName,
        imageCount,
        audioCount
      );

      const rawContent = response.content as string;

      // Strip personality prefix if model ignored prompt instructions
      // This ensures both Discord display AND storage are clean
      let content = stripPersonalityPrefix(rawContent, personality.name);

      // Replace placeholders in LLM output before sending to user
      // This handles cases where the LLM includes placeholders in its response
      const userName = context.userName || context.activePersonaName || 'User';
      content = replacePromptPlaceholders(content, userName, personality.name);

      logger.debug(
        {
          rawContentPreview: rawContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
          cleanedContentPreview: content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
          wasStripped: rawContent !== content,
        },
        `[RAG] Content stripping check for ${personality.name}`
      );

      logger.info(
        `[RAG] Generated ${content.length} chars for ${personality.name} using model: ${modelName}`
      );

      // Store to LTM (conversation_history will be created by bot-client after Discord send)
      // Resolve personaId for LTM storage
      const personaId = await this.memoryRetriever.getUserPersonaForPersonality(
        context.userId,
        personality.id
      );

      if (personaId) {
        await this.longTermMemory.storeInteraction(
          personality,
          contentForStorage,
          content,
          context,
          personaId
        );
      } else {
        logger.warn(
          `[RAG] No persona found for user ${context.userId}, skipping LTM storage`
        );
      }

      // Extract attachment descriptions for history storage with context
      const attachmentDescriptions =
        processedAttachments.length > 0
          ? processedAttachments
              .map(a => {
                // Add filename/type context before each description
                let header = '';
                if (a.type === AttachmentType.Image) {
                  header = `[Image: ${a.metadata.name || 'attachment'}]`;
                } else if (a.type === AttachmentType.Audio) {
                  if (a.metadata.isVoiceMessage && a.metadata.duration) {
                    header = `[Voice message: ${a.metadata.duration.toFixed(1)}s]`;
                  } else {
                    header = `[Audio: ${a.metadata.name || 'attachment'}]`;
                  }
                }
                return `${header}\n${a.description}`;
              })
              .join('\n\n')
          : undefined;

      return {
        content,
        retrievedMemories: relevantMemories.length,
        tokensUsed: (response as any).usage_metadata?.total_tokens,
        attachmentDescriptions,
        referencedMessagesDescriptions,
        modelUsed: modelName,
        userMessageContent: contentForStorage, // For bot-client to store in conversation_history and LTM
      };
    } catch (error) {
      logAndThrow(logger, `[RAG] Error generating response for ${personality.name}`, error);
    }
  }
}
