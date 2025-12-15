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
  getPrismaClient,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { processAttachments, type ProcessedAttachment } from './MultimodalProcessor.js';
import { stripResponseArtifacts } from '../utils/responseCleanup.js';
import { replacePromptPlaceholders } from '../utils/promptPlaceholders.js';
import { logAndThrow } from '../utils/errorHandling.js';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import { LLMInvoker } from './LLMInvoker.js';
import { MemoryRetriever } from './MemoryRetriever.js';
import { PromptBuilder } from './PromptBuilder.js';
import { LongTermMemoryService } from './LongTermMemoryService.js';
import { ContextWindowManager } from './context/ContextWindowManager.js';
import { PersonaResolver } from './resolvers/index.js';
import { UserReferenceResolver } from './UserReferenceResolver.js';
import type {
  ConversationContext,
  ProcessedInputs,
  PersonaLoadResult,
  BudgetAllocationResult,
  BudgetAllocationOptions,
  ModelInvocationResult,
  ModelInvocationOptions,
  RAGResponse,
} from './ConversationalRAGTypes.js';

// Re-export public types for external consumers
export type {
  MemoryDocument,
  ParticipantPersona,
  DiscordEnvironment,
  ConversationContext,
  RAGResponse,
} from './ConversationalRAGTypes.js';

const logger = createLogger('ConversationalRAGService');

export class ConversationalRAGService {
  private llmInvoker: LLMInvoker;
  private memoryRetriever: MemoryRetriever;
  private promptBuilder: PromptBuilder;
  private longTermMemory: LongTermMemoryService;
  private referencedMessageFormatter: ReferencedMessageFormatter;
  private contextWindowManager: ContextWindowManager;
  private userReferenceResolver: UserReferenceResolver;

  constructor(memoryManager?: PgvectorMemoryAdapter, personaResolver?: PersonaResolver) {
    this.llmInvoker = new LLMInvoker();
    this.memoryRetriever = new MemoryRetriever(memoryManager, personaResolver);
    this.promptBuilder = new PromptBuilder();
    this.longTermMemory = new LongTermMemoryService(memoryManager);
    this.referencedMessageFormatter = new ReferencedMessageFormatter();
    this.contextWindowManager = new ContextWindowManager();
    this.userReferenceResolver = new UserReferenceResolver(getPrismaClient());
  }

  // ============================================================================
  // HELPER METHODS (extracted from generateResponse for complexity reduction)
  // ============================================================================

  /**
   * Process input attachments and format messages for AI consumption
   */
  private async processInputs(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    isGuestMode: boolean
  ): Promise<ProcessedInputs> {
    // Use pre-processed attachments from dependency jobs if available
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

    // Format the user's message
    const userMessage = this.promptBuilder.formatUserMessage(message, context);

    // Format referenced messages (with vision/transcription)
    const referencedMessagesDescriptions =
      context.referencedMessages && context.referencedMessages.length > 0
        ? await this.referencedMessageFormatter.formatReferencedMessages(
            context.referencedMessages,
            personality,
            isGuestMode,
            context.preprocessedReferenceAttachments
          )
        : undefined;

    // Extract plain text from formatted references for memory search
    const referencedMessagesTextForSearch =
      referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0
        ? this.referencedMessageFormatter.extractTextForSearch(referencedMessagesDescriptions)
        : undefined;

    // Extract recent conversation history for context-aware LTM search
    const recentHistoryWindow = this.extractRecentHistoryWindow(context.rawConversationHistory);

    // Build search query for memory retrieval
    const searchQuery = this.promptBuilder.buildSearchQuery(
      userMessage,
      processedAttachments,
      referencedMessagesTextForSearch,
      recentHistoryWindow
    );

    return {
      processedAttachments,
      userMessage,
      referencedMessagesDescriptions,
      referencedMessagesTextForSearch,
      searchQuery,
    };
  }

  /**
   * Load participant personas and resolve user references in system prompt
   */
  private async loadPersonasAndResolveReferences(
    personality: LoadedPersonality,
    context: ConversationContext
  ): Promise<PersonaLoadResult> {
    // Fetch ALL participant personas from conversation history
    const participantPersonas = await this.memoryRetriever.getAllParticipantPersonas(context);
    if (participantPersonas.size > 0) {
      logger.info(
        `[RAG] Loaded ${participantPersonas.size} participant persona(s): ${Array.from(participantPersonas.keys()).join(', ')}`
      );
    } else {
      logger.debug(`[RAG] No participant personas found in conversation history`);
    }

    // Resolve user references in system prompt
    let processedPersonality = personality;
    if (personality.systemPrompt !== undefined && personality.systemPrompt.length > 0) {
      const { processedText, resolvedPersonas } =
        await this.userReferenceResolver.resolveUserReferences(
          personality.systemPrompt,
          personality.id
        );

      if (resolvedPersonas.length > 0) {
        processedPersonality = { ...personality, systemPrompt: processedText };

        // Add resolved personas to participants
        for (const persona of resolvedPersonas) {
          if (!participantPersonas.has(persona.personaName)) {
            participantPersonas.set(persona.personaName, {
              content: persona.content,
              isActive: false,
            });
            logger.debug(
              { personaName: persona.personaName },
              '[RAG] Added referenced user to participants'
            );
          }
        }

        logger.info(
          `[RAG] Resolved ${resolvedPersonas.length} user reference(s) in system prompt`
        );
      }
    }

    return { participantPersonas, processedPersonality };
  }

  /**
   * Allocate token budgets and select memories/history within constraints
   */
  private allocateBudgetsAndSelectContent(opts: BudgetAllocationOptions): BudgetAllocationResult {
    const {
      personality, processedPersonality, participantPersonas, retrievedMemories,
      context, userMessage, processedAttachments, referencedMessagesDescriptions,
    } = opts;
    const contextWindowTokens =
      personality.contextWindowTokens || AI_DEFAULTS.CONTEXT_WINDOW_TOKENS;

    // Build current message
    const { message: currentMessage, contentForStorage } = this.promptBuilder.buildHumanMessage(
      userMessage,
      processedAttachments,
      context.activePersonaName,
      referencedMessagesDescriptions
    );

    // Build base system prompt (no memories or history) to get base token count
    const systemPromptBaseOnly = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories: [],
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
    });

    // Count tokens for budget calculation
    const systemPromptBaseTokens = this.promptBuilder.countTokens(
      systemPromptBaseOnly.content as string
    );
    const currentMessageTokens = this.promptBuilder.countTokens(currentMessage.content as string);
    const historyTokens = this.contextWindowManager.countHistoryTokens(
      context.rawConversationHistory,
      personality.name
    );

    // Calculate memory budget
    const memoryBudget = this.contextWindowManager.calculateMemoryBudget(
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      historyTokens
    );

    // Select memories within budget
    const {
      selectedMemories: relevantMemories,
      tokensUsed: memoryTokensUsed,
      memoriesDropped: memoriesDroppedCount,
      droppedDueToSize,
    } = this.contextWindowManager.selectMemoriesWithinBudget(
      retrievedMemories,
      memoryBudget,
      context.userTimezone
    );

    if (memoriesDroppedCount > 0) {
      logger.info(
        `[RAG] Memory budget applied: kept ${relevantMemories.length}/${retrievedMemories.length} memories (${memoryTokensUsed} tokens, budget: ${memoryBudget}, dropped: ${memoriesDroppedCount}, oversized: ${droppedDueToSize})`
      );
    }

    // Build system prompt with memories
    const systemPromptWithMemories = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories,
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
    });

    // Calculate history budget
    const systemPromptWithMemoriesTokens = this.promptBuilder.countTokens(
      systemPromptWithMemories.content as string
    );
    const historyBudget = this.contextWindowManager.calculateHistoryBudget(
      contextWindowTokens,
      systemPromptWithMemoriesTokens,
      currentMessageTokens,
      0
    );

    // Select and serialize history
    const {
      serializedHistory,
      historyTokensUsed,
      messagesIncluded: _messagesIncluded,
      messagesDropped,
    } = this.contextWindowManager.selectAndSerializeHistory(
      context.rawConversationHistory,
      personality.name,
      historyBudget
    );

    // Build final system prompt with memories AND history
    const systemPrompt = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories,
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
      serializedHistory,
    });

    // Log token allocation
    logger.info(
      `[RAG] Token budget: total=${contextWindowTokens}, base=${systemPromptBaseTokens}, current=${currentMessageTokens}, memories=${memoryTokensUsed}/${retrievedMemories.length > 0 ? this.promptBuilder.countMemoryTokens(retrievedMemories) : 0}, historyBudget=${historyBudget}, historyUsed=${historyTokensUsed}`
    );
    if (messagesDropped > 0) {
      logger.debug(`[RAG] Dropped ${messagesDropped} history messages due to token budget`);
    }

    return {
      relevantMemories,
      serializedHistory,
      systemPrompt,
      memoryTokensUsed,
      historyTokensUsed,
      memoriesDroppedCount,
      messagesDropped,
      contentForStorage,
    };
  }

  /**
   * Invoke the model and clean up the response
   */
  private async invokeModelAndClean(opts: ModelInvocationOptions): Promise<ModelInvocationResult> {
    const {
      personality, systemPrompt, userMessage, processedAttachments,
      context, participantPersonas, referencedMessagesDescriptions, userApiKey,
    } = opts;
    // Build current message
    const { message: currentMessage } = this.promptBuilder.buildHumanMessage(
      userMessage,
      processedAttachments,
      context.activePersonaName,
      referencedMessagesDescriptions
    );

    // Build messages array
    const messages: BaseMessage[] = [systemPrompt, currentMessage];

    // Get model with all LLM sampling parameters
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

    // Calculate attachment counts for timeout
    const imageCount =
      context.attachments?.filter(
        att => att.contentType.startsWith('image/') && att.isVoiceMessage !== true
      ).length ?? 0;
    const audioCount =
      context.attachments?.filter(
        att => att.contentType.startsWith('audio/') || att.isVoiceMessage === true
      ).length ?? 0;

    // Generate stop sequences
    const stopSequences = this.generateStopSequences(personality.name, participantPersonas);

    // Invoke model
    const response = await this.llmInvoker.invokeWithRetry({
      model,
      messages,
      modelName,
      imageCount,
      audioCount,
      stopSequences,
    });

    const rawContent = response.content as string;

    // Strip artifacts
    let cleanedContent = stripResponseArtifacts(rawContent, personality.name);

    // Replace placeholders
    const userName =
      context.userName !== undefined && context.userName.length > 0
        ? context.userName
        : context.activePersonaName !== undefined && context.activePersonaName.length > 0
          ? context.activePersonaName
          : 'User';
    cleanedContent = replacePromptPlaceholders(
      cleanedContent,
      userName,
      personality.name,
      context.discordUsername
    );

    logger.debug(
      {
        rawContentPreview: rawContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
        cleanedContentPreview: cleanedContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
        wasStripped: rawContent !== cleanedContent,
      },
      `[RAG] Content stripping check for ${personality.name}`
    );

    logger.info(
      `[RAG] Generated ${cleanedContent.length} chars for ${personality.name} using model: ${modelName}`
    );

    // Extract token usage
    const responseData = response as unknown as {
      usage_metadata?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };
    const usageMetadata = responseData.usage_metadata;

    return {
      cleanedContent,
      modelName,
      tokensIn: usageMetadata?.input_tokens,
      tokensOut: usageMetadata?.output_tokens,
    };
  }

  /**
   * Build attachment descriptions for storage
   */
  private buildAttachmentDescriptions(processedAttachments: ProcessedAttachment[]): string | undefined {
    if (processedAttachments.length === 0) {
      return undefined;
    }

    return processedAttachments
      .map(a => {
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
      .join('\n\n');
  }

  /**
   * Generate a response using conversational RAG
   *
   * Architecture: This method orchestrates the response generation pipeline:
   * 1. Process inputs (attachments, messages, search query)
   * 2. Load personas and resolve user references
   * 3. Retrieve relevant memories from vector store
   * 4. Allocate token budgets and select content
   * 5. Invoke model and clean response
   * 6. Store to long-term memory
   * 7. Build and return response
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
      // Step 1: Process inputs (attachments, messages, search query)
      const inputs = await this.processInputs(personality, message, context, isGuestMode);

      // Step 2: Load personas and resolve user references
      const { participantPersonas, processedPersonality } =
        await this.loadPersonasAndResolveReferences(personality, context);

      // Step 3: Retrieve relevant memories
      logger.info(
        `[RAG] Memory search query: "${inputs.searchQuery.substring(0, TEXT_LIMITS.LOG_PREVIEW)}${inputs.searchQuery.length > TEXT_LIMITS.LOG_PREVIEW ? '...' : ''}"`
      );
      const retrievedMemories = await this.memoryRetriever.retrieveRelevantMemories(
        personality,
        inputs.searchQuery,
        context
      );

      // Step 4: Allocate token budgets and select content
      const budgetResult = this.allocateBudgetsAndSelectContent({
        personality,
        processedPersonality,
        participantPersonas,
        retrievedMemories,
        context,
        userMessage: inputs.userMessage,
        processedAttachments: inputs.processedAttachments,
        referencedMessagesDescriptions: inputs.referencedMessagesDescriptions,
      });

      // Step 5: Invoke model and clean response
      const modelResult = await this.invokeModelAndClean({
        personality,
        systemPrompt: budgetResult.systemPrompt,
        userMessage: inputs.userMessage,
        processedAttachments: inputs.processedAttachments,
        context,
        participantPersonas,
        referencedMessagesDescriptions: inputs.referencedMessagesDescriptions,
        userApiKey,
      });

      // Step 6: Store to long-term memory
      await this.storeToLongTermMemory(
        personality,
        context,
        budgetResult.contentForStorage,
        modelResult.cleanedContent,
        inputs.referencedMessagesTextForSearch
      );

      // Step 7: Build and return response
      return {
        content: modelResult.cleanedContent,
        retrievedMemories: budgetResult.relevantMemories.length,
        tokensIn: modelResult.tokensIn,
        tokensOut: modelResult.tokensOut,
        attachmentDescriptions: this.buildAttachmentDescriptions(inputs.processedAttachments),
        referencedMessagesDescriptions: inputs.referencedMessagesDescriptions,
        modelUsed: modelResult.modelName,
        userMessageContent: budgetResult.contentForStorage,
      };
    } catch (error) {
      logAndThrow(logger, `[RAG] Error generating response for ${personality.name}`, error);
    }
  }

  /**
   * Store interaction to long-term memory
   */
  private async storeToLongTermMemory(
    personality: LoadedPersonality,
    context: ConversationContext,
    contentForStorage: string,
    responseContent: string,
    referencedMessagesTextForSearch: string | undefined
  ): Promise<void> {
    const personaResult = await this.memoryRetriever.resolvePersonaForMemory(
      context.userId,
      personality.id
    );

    if (personaResult !== null) {
      // Build content for LTM embedding: includes references for semantic search
      const contentForEmbedding =
        referencedMessagesTextForSearch !== undefined &&
        referencedMessagesTextForSearch.length > 0
          ? `${contentForStorage}\n\n[Referenced content: ${referencedMessagesTextForSearch}]`
          : contentForStorage;

      await this.longTermMemory.storeInteraction(
        personality,
        contentForEmbedding,
        responseContent,
        context,
        personaResult.personaId
      );
    } else {
      logger.warn({}, `[RAG] No persona found for user ${context.userId}, skipping LTM storage`);
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

  /**
   * Generate stop sequences for identity bleeding prevention
   *
   * These sequences tell the LLM to stop generating if it starts speaking as another participant.
   * This is a technical kill-switch that works at the API level, complementing the XML structure
   * and prompt instructions.
   *
   * Stop sequences include:
   * - "\nParticipantName:" for each participant (users)
   * - "\nPersonalityName:" for the AI itself (prevent third-person then self-quoting)
   * - "<msg " to prevent outputting XML structure
   *
   * @param personalityName - Name of the AI personality
   * @param participantPersonas - Map of participant names to their persona info
   * @returns Array of stop sequences
   */
  private generateStopSequences(
    personalityName: string,
    participantPersonas: Map<string, { content: string; isActive: boolean }>
  ): string[] {
    const stopSequences: string[] = [];

    // Add stop sequence for each participant (users)
    // Use newline prefix to catch the common "Name:" pattern at line start
    for (const participantName of participantPersonas.keys()) {
      stopSequences.push(`\n${participantName}:`);
    }

    // Add stop sequence for the AI itself (prevent "Lilith: [third person]" then self-quoting)
    stopSequences.push(`\n${personalityName}:`);

    // Add XML tag stop sequences to prevent AI from outputting chat_log structure
    // Must match actual tags used in formatConversationHistoryAsXml()
    stopSequences.push('<message ');
    stopSequences.push('<message>');
    stopSequences.push('</message>');
    stopSequences.push('<chat_log>');
    stopSequences.push('</chat_log>');
    // Stop sequences for quoted message structure
    stopSequences.push('<quoted_messages>');
    stopSequences.push('</quoted_messages>');
    stopSequences.push('<quote ');
    stopSequences.push('<quote>');
    stopSequences.push('</quote>');

    // Log summary
    if (stopSequences.length > 0) {
      logger.info(
        {
          count: stopSequences.length,
          participants: Array.from(participantPersonas.keys()),
          personalityName,
        },
        '[RAG] Generated stop sequences for identity bleeding prevention'
      );
    }

    return stopSequences;
  }
}
