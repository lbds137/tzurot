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
import { ContextWindowManager } from './context/ContextWindowManager.js';

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
  /** User's preferred timezone (IANA format, e.g., 'America/New_York') */
  userTimezone?: string;
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
  // Pre-processed attachments from dependency jobs (avoids duplicate vision API calls)
  preprocessedAttachments?: ProcessedAttachment[];
  // Discord environment context (DMs vs guild, channel info, etc)
  environment?: DiscordEnvironment;
  // Referenced messages (from replies and message links)
  referencedMessages?: ReferencedMessage[];
  // Referenced channels (from #channel mentions - used for LTM scoping)
  referencedChannels?: { channelId: string; channelName: string }[];
}

export interface RAGResponse {
  content: string;
  retrievedMemories?: number;
  /** Input/prompt tokens consumed */
  tokensIn?: number;
  /** Output/completion tokens consumed */
  tokensOut?: number;
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
  private contextWindowManager: ContextWindowManager;

  constructor(memoryManager?: PgvectorMemoryAdapter) {
    this.llmInvoker = new LLMInvoker();
    this.memoryRetriever = new MemoryRetriever(memoryManager);
    this.promptBuilder = new PromptBuilder();
    this.longTermMemory = new LongTermMemoryService(memoryManager);
    this.referencedMessageFormatter = new ReferencedMessageFormatter();
    this.contextWindowManager = new ContextWindowManager();
  }

  /**
   * Generate a response using conversational RAG
   *
   * @param personality - Personality configuration
   * @param message - User's message content
   * @param context - Conversation context (history, environment, etc.)
   * @param userApiKey - Optional BYOK API key
   * @param isGuestMode - Whether the user is in guest mode (no BYOK API key)
   */
  async generateResponse(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    userApiKey?: string,
    isGuestMode = false
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

      // Use pre-processed attachments from dependency jobs if available
      // This avoids duplicate vision API calls (preprocessing already ran in ImageDescriptionJob)
      let processedAttachments: ProcessedAttachment[] = [];
      if (context.preprocessedAttachments && context.preprocessedAttachments.length > 0) {
        processedAttachments = context.preprocessedAttachments;
        logger.info(
          { count: processedAttachments.length },
          'Using pre-processed attachments from dependency jobs'
        );
      } else if (context.attachments && context.attachments.length > 0) {
        // Fallback: process attachments inline (shouldn't happen with job chain, but defensive)
        processedAttachments = await processAttachments(context.attachments, personality);
        logger.info(
          { count: processedAttachments.length },
          'Processed attachments to text descriptions (inline fallback)'
        );
      }

      // Format the user's message (now with transcriptions available)
      const userMessage = this.promptBuilder.formatUserMessage(message, context);

      // Format referenced messages (with vision/transcription) BEFORE memory retrieval
      // This processes attachments once and uses the result for both LTM search and the prompt
      const referencedMessagesDescriptions =
        context.referencedMessages && context.referencedMessages.length > 0
          ? await this.referencedMessageFormatter.formatReferencedMessages(
              context.referencedMessages,
              personality,
              isGuestMode
            )
          : undefined;

      // Extract plain text from formatted references for memory search
      const referencedMessagesTextForSearch =
        referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0
          ? this.referencedMessageFormatter.extractTextForSearch(referencedMessagesDescriptions)
          : undefined;

      // Extract recent conversation history for context-aware LTM search
      // This solves the "pronoun problem" where users say "what about that?"
      const recentHistoryWindow = this.extractRecentHistoryWindow(context.rawConversationHistory);

      // Build the actual message text for memory search
      // Includes: recent history context, user message, voice transcriptions, image descriptions, AND referenced content
      const searchQuery = this.promptBuilder.buildSearchQuery(
        userMessage,
        processedAttachments,
        referencedMessagesTextForSearch,
        recentHistoryWindow
      );

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

      // TOKEN-BASED CONTEXT WINDOW MANAGEMENT
      // Build system prompt and current message first
      const systemPrompt = this.promptBuilder.buildFullSystemPrompt(
        personality,
        participantPersonas,
        relevantMemories,
        context,
        referencedMessagesDescriptions
      );

      const { message: currentMessage, contentForStorage } = this.promptBuilder.buildHumanMessage(
        userMessage,
        processedAttachments,
        context.activePersonaName,
        referencedMessagesDescriptions
      );

      // Use ContextWindowManager to calculate budget and select history
      const promptContext = this.contextWindowManager.buildContext({
        systemPrompt,
        currentMessage,
        relevantMemories,
        conversationHistory: context.conversationHistory ?? [],
        rawConversationHistory: context.rawConversationHistory,
        contextWindowTokens: personality.contextWindowTokens || AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
      });

      // Build final messages array from prompt context
      const messages: BaseMessage[] = [
        promptContext.systemPrompt,
        ...promptContext.selectedHistory,
        promptContext.currentMessage,
      ];

      // Get the appropriate model (provider determined by AI_PROVIDER env var)
      // Pass all LLM sampling parameters from personality config
      const { model, modelName } = this.llmInvoker.getModel({
        modelName: personality.model,
        apiKey: userApiKey,
        temperature: personality.temperature,
        topP: personality.topP,
        topK: personality.topK,
        frequencyPenalty: personality.frequencyPenalty,
        presencePenalty: personality.presencePenalty,
        repetitionPenalty: personality.repetitionPenalty,
        maxTokens: personality.maxTokens,
      });

      // Calculate attachment counts for dynamic timeout calculation
      const imageCount =
        context.attachments?.filter(
          att => att.contentType.startsWith('image/') && att.isVoiceMessage !== true
        ).length ?? 0;
      const audioCount =
        context.attachments?.filter(
          att => att.contentType.startsWith('audio/') || att.isVoiceMessage === true
        ).length ?? 0;

      // Invoke the model with timeout and retry logic
      // LLMInvoker handles censored responses automatically with retry
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
      const userName =
        context.userName !== undefined && context.userName.length > 0
          ? context.userName
          : context.activePersonaName !== undefined && context.activePersonaName.length > 0
            ? context.activePersonaName
            : 'User';
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

      if (personaId !== null && personaId.length > 0) {
        await this.longTermMemory.storeInteraction(
          personality,
          contentForStorage,
          content,
          context,
          personaId
        );
      } else {
        logger.warn({}, `[RAG] No persona found for user ${context.userId}, skipping LTM storage`);
      }

      // Extract attachment descriptions for history storage with context
      const attachmentDescriptions =
        processedAttachments.length > 0
          ? processedAttachments
              .map(a => {
                // Add filename/type context before each description
                let header = '';
                if (a.type === AttachmentType.Image) {
                  header = `[Image: ${a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment'}]`;
                } else if (a.type === AttachmentType.Audio) {
                  if (
                    a.metadata.isVoiceMessage === true &&
                    a.metadata.duration !== undefined &&
                    a.metadata.duration !== null &&
                    a.metadata.duration > 0
                  ) {
                    header = `[Voice message: ${a.metadata.duration.toFixed(1)}s]`;
                  } else {
                    header = `[Audio: ${a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment'}]`;
                  }
                }
                return `${header}\n${a.description}`;
              })
              .join('\n\n')
          : undefined;

      // Extract token usage if available (LangChain provides usage_metadata)
      const responseData = response as unknown as {
        usage_metadata?: {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
        };
      };
      const usageMetadata = responseData.usage_metadata;
      const tokensIn = usageMetadata?.input_tokens;
      const tokensOut = usageMetadata?.output_tokens;

      return {
        content,
        retrievedMemories: relevantMemories.length,
        tokensIn,
        tokensOut,
        attachmentDescriptions,
        referencedMessagesDescriptions,
        modelUsed: modelName,
        userMessageContent: contentForStorage, // For bot-client to store in conversation_history and LTM
      };
    } catch (error) {
      logAndThrow(logger, `[RAG] Error generating response for ${personality.name}`, error);
    }
  }

  /**
   * Extract recent conversation history for context-aware LTM search
   *
   * Returns the last N conversation turns (user + assistant pairs) as a formatted string.
   * This helps resolve pronouns like "that", "it", "he" in the current message by
   * providing recent topic context to the embedding model.
   *
   * @param rawHistory The raw conversation history array
   * @returns Formatted string of recent history, or undefined if no history
   */
  private extractRecentHistoryWindow(
    rawHistory?: { role: string; content: string; tokenCount?: number }[]
  ): string | undefined {
    if (!rawHistory || rawHistory.length === 0) {
      return undefined;
    }

    // Get the last N turns (each turn = 2 messages: user + assistant)
    const turnsToInclude = AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS;
    const messagesToInclude = turnsToInclude * 2;

    // Take the last N messages (they're already in chronological order)
    const recentMessages = rawHistory.slice(-messagesToInclude);

    if (recentMessages.length === 0) {
      return undefined;
    }

    // Format as content only (no role labels) - role labels are noise for semantic search
    // The content itself is what matters for finding relevant memories
    const formatted = recentMessages
      .map(msg => {
        // Truncate very long messages to avoid bloating the search query
        // Use LTM_SEARCH_MESSAGE_PREVIEW (500) instead of LOG_PREVIEW (150) for better semantic context
        return msg.content.length > AI_DEFAULTS.LTM_SEARCH_MESSAGE_PREVIEW
          ? msg.content.substring(0, AI_DEFAULTS.LTM_SEARCH_MESSAGE_PREVIEW) + '...'
          : msg.content;
      })
      .join('\n');

    logger.debug(
      `[RAG] Extracted ${recentMessages.length} messages (${Math.ceil(recentMessages.length / 2)} turns) for LTM search context`
    );

    return formatted;
  }
}
