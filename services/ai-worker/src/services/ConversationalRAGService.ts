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
  TEXT_LIMITS,
  getPrismaClient,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { processAttachments, type ProcessedAttachment } from './MultimodalProcessor.js';
import { stripResponseArtifacts } from '../utils/responseArtifacts.js';
import { removeDuplicateResponse } from '../utils/duplicateDetection.js';
import { extractThinkingBlocks } from '../utils/thinkingExtraction.js';
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
import { ContentBudgetManager } from './ContentBudgetManager.js';
import {
  buildAttachmentDescriptions,
  generateStopSequences,
  buildImageDescriptionMap,
  injectImageDescriptions,
  extractRecentHistoryWindow,
} from './RAGUtils.js';
import { redisService } from '../redis.js';
import type {
  ConversationContext,
  ProcessedInputs,
  PersonaLoadResult,
  ModelInvocationResult,
  ModelInvocationOptions,
  RAGResponse,
  GenerateResponseOptions,
  DeferredMemoryData,
} from './ConversationalRAGTypes.js';

// Re-export public types for external consumers
export type {
  MemoryDocument,
  ParticipantPersona,
  DiscordEnvironment,
  ConversationContext,
  RAGResponse,
  ParticipantInfo,
  DeferredMemoryData,
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
  private contentBudgetManager: ContentBudgetManager;

  constructor(memoryManager?: PgvectorMemoryAdapter, personaResolver?: PersonaResolver) {
    this.llmInvoker = new LLMInvoker();
    this.memoryRetriever = new MemoryRetriever(memoryManager, personaResolver);
    this.promptBuilder = new PromptBuilder();
    this.longTermMemory = new LongTermMemoryService(memoryManager);
    this.referencedMessageFormatter = new ReferencedMessageFormatter();
    this.contextWindowManager = new ContextWindowManager();
    this.userReferenceResolver = new UserReferenceResolver(getPrismaClient());
    this.contentBudgetManager = new ContentBudgetManager(
      this.promptBuilder,
      this.contextWindowManager
    );
  }

  // ============================================================================
  // HELPER METHODS (extracted from generateResponse for complexity reduction)
  // ============================================================================

  /**
   * Process input attachments and format messages for AI consumption
   *
   * @param personality - Personality configuration
   * @param message - User's message content
   * @param context - Conversation context
   * @param isGuestMode - Whether user is in guest mode (uses free models)
   * @param userApiKey - User's BYOK API key (for BYOK users)
   */
  private async processInputs(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    isGuestMode: boolean,
    userApiKey?: string
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
      // Pass isGuestMode and userApiKey for BYOK support
      processedAttachments = await processAttachments(
        context.attachments,
        personality,
        isGuestMode,
        userApiKey
      );
      logger.info(
        { count: processedAttachments.length },
        'Processed attachments to text descriptions (inline fallback)'
      );
    }

    // Format the user's message
    const userMessage = this.promptBuilder.formatUserMessage(message, context);

    // Format referenced messages (with vision/transcription)
    // Pass userApiKey for BYOK support in inline fallback processing
    const referencedMessagesDescriptions =
      context.referencedMessages && context.referencedMessages.length > 0
        ? await this.referencedMessageFormatter.formatReferencedMessages(
            context.referencedMessages,
            personality,
            isGuestMode,
            context.preprocessedReferenceAttachments,
            userApiKey
          )
        : undefined;

    // Extract plain text from formatted references for memory search
    const referencedMessagesTextForSearch =
      referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0
        ? this.referencedMessageFormatter.extractTextForSearch(referencedMessagesDescriptions)
        : undefined;

    // Extract recent conversation history for context-aware LTM search
    const recentHistoryWindow = extractRecentHistoryWindow(context.rawConversationHistory);

    // Build search query for memory retrieval
    const searchQuery = this.promptBuilder.buildSearchQuery(
      userMessage,
      processedAttachments,
      referencedMessagesTextForSearch,
      recentHistoryWindow
    );

    // Note: Extended context image descriptions are now injected inline into
    // conversation history entries (via injectImageDescriptions), not formatted
    // as a separate section. This improves context colocation - the AI sees
    // image descriptions directly within the messages they came from.

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
    // Pass personalityId for resolving per-personality persona overrides
    const participantPersonas = await this.memoryRetriever.getAllParticipantPersonas(
      context,
      personality.id
    );
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
              personaId: persona.personaId,
            });
            logger.debug(
              { personaName: persona.personaName },
              '[RAG] Added referenced user to participants'
            );
          }
        }

        logger.info(`[RAG] Resolved ${resolvedPersonas.length} user reference(s) in system prompt`);
      }
    }

    return { participantPersonas, processedPersonality };
  }

  /** Invoke the model and clean up the response */
  private async invokeModelAndClean(opts: ModelInvocationOptions): Promise<ModelInvocationResult> {
    const {
      personality,
      systemPrompt,
      userMessage,
      processedAttachments,
      context,
      participantPersonas,
      referencedMessagesDescriptions,
      userApiKey,
      retryConfig,
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
    // Apply retry config overrides if present (for duplicate detection retries)
    const { model, modelName } = this.llmInvoker.getModel({
      modelName: personality.model,
      apiKey: userApiKey,
      temperature: retryConfig?.temperatureOverride ?? personality.temperature,
      topP: personality.topP,
      topK: personality.topK,
      frequencyPenalty: retryConfig?.frequencyPenaltyOverride ?? personality.frequencyPenalty,
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
    const stopSequences = generateStopSequences(personality.name, participantPersonas);

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

    // Remove duplicate content (stop-token failure bug in some models like GLM-4.7)
    const deduplicatedContent = removeDuplicateResponse(rawContent);

    // Extract thinking blocks (DeepSeek R1, Claude with reasoning, o1/o3, etc.)
    // This must happen before stripResponseArtifacts to preserve the full thinking content
    const { thinkingContent, visibleContent } = extractThinkingBlocks(deduplicatedContent);

    // Strip artifacts from visible content only
    let cleanedContent = stripResponseArtifacts(visibleContent, personality.name);

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
        wasDeduplicated: rawContent !== deduplicatedContent,
        hadThinkingBlocks: thinkingContent !== null,
        thinkingContentLength: thinkingContent?.length ?? 0,
        wasStripped: visibleContent !== cleanedContent,
      },
      `[RAG] Content cleanup check for ${personality.name}`
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
      thinkingContent: thinkingContent ?? undefined,
    };
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
   * @param options - Optional configuration (userApiKey, isGuestMode, retryConfig)
   */
  // eslint-disable-next-line max-lines-per-function -- Orchestration method; further decomposition would obscure flow
  async generateResponse(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    options: GenerateResponseOptions = {}
  ): Promise<RAGResponse> {
    const { userApiKey, isGuestMode = false, retryConfig } = options;

    try {
      // Step 1: Process inputs (attachments, messages, search query)
      // Pass userApiKey for BYOK support in fallback vision processing
      const inputs = await this.processInputs(
        personality,
        message,
        context,
        isGuestMode,
        userApiKey
      );

      // Step 1.5: Inject image descriptions into history for inline display
      // This replaces the separate <recent_channel_images> section with inline descriptions
      const imageDescriptionMap = buildImageDescriptionMap(
        context.preprocessedExtendedContextAttachments
      );
      injectImageDescriptions(context.rawConversationHistory, imageDescriptionMap);

      // Step 2: Load personas and resolve user references
      const { participantPersonas, processedPersonality } =
        await this.loadPersonasAndResolveReferences(personality, context);

      // Step 3: Retrieve relevant memories
      logger.info(
        `[RAG] Memory search query: "${inputs.searchQuery.substring(0, TEXT_LIMITS.LOG_PREVIEW)}${inputs.searchQuery.length > TEXT_LIMITS.LOG_PREVIEW ? '...' : ''}"`
      );
      const { memories: retrievedMemories, focusModeEnabled } =
        await this.memoryRetriever.retrieveRelevantMemories(
          personality,
          inputs.searchQuery,
          context
        );

      // Step 4: Allocate token budgets and select content
      // Note: Image descriptions are now injected inline into history entries
      // (via injectImageDescriptions above) rather than passed separately
      const budgetResult = this.contentBudgetManager.allocate({
        personality,
        processedPersonality,
        participantPersonas,
        retrievedMemories,
        context,
        userMessage: inputs.userMessage,
        processedAttachments: inputs.processedAttachments,
        referencedMessagesDescriptions: inputs.referencedMessagesDescriptions,
        historyReductionPercent: retryConfig?.historyReductionPercent,
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
        retryConfig,
      });

      // Step 5.5: Resolve user references in AI output (shapes.inc format -> readable names)
      // The AI may have learned the @[username](user:uuid) format from conversation history
      // and reproduced it in its output. This step converts them back to readable names.
      const { processedText: finalContent } =
        await this.userReferenceResolver.resolveUserReferences(
          modelResult.cleanedContent,
          personality.id
        );

      // Step 6: Check incognito mode and handle memory storage
      const incognitoModeActive = await redisService.isIncognitoActive(
        context.userId,
        personality.id
      );

      // Build deferred memory data for potential later storage
      let deferredMemoryData: DeferredMemoryData | undefined;

      if (incognitoModeActive) {
        logger.info(
          { userId: context.userId, personalityId: personality.id },
          '[RAG] Incognito mode active - skipping LTM storage'
        );
      } else if (options.skipMemoryStorage === true) {
        // Deferred storage: resolve persona and build data for caller to store later
        const personaResult = await this.memoryRetriever.resolvePersonaForMemory(
          context.userId,
          personality.id
        );
        if (personaResult !== null) {
          const contentForEmbedding =
            inputs.referencedMessagesTextForSearch !== undefined &&
            inputs.referencedMessagesTextForSearch.length > 0
              ? `${budgetResult.contentForStorage}\n\n[Referenced content: ${inputs.referencedMessagesTextForSearch}]`
              : budgetResult.contentForStorage;

          deferredMemoryData = {
            contentForEmbedding,
            responseContent: finalContent,
            personaId: personaResult.personaId,
          };
          logger.debug(
            { userId: context.userId, personalityId: personality.id },
            '[RAG] Memory storage deferred - data included in response'
          );
        } else {
          logger.warn({}, `[RAG] No persona found for user ${context.userId}, cannot defer LTM`);
        }
      } else {
        // Immediate storage (default behavior)
        await this.storeToLongTermMemory(
          personality,
          context,
          budgetResult.contentForStorage,
          finalContent,
          inputs.referencedMessagesTextForSearch
        );
      }

      // Step 7: Build and return response
      return {
        content: finalContent,
        retrievedMemories: budgetResult.relevantMemories.length,
        tokensIn: modelResult.tokensIn,
        tokensOut: modelResult.tokensOut,
        attachmentDescriptions: buildAttachmentDescriptions(inputs.processedAttachments),
        referencedMessagesDescriptions: inputs.referencedMessagesDescriptions,
        modelUsed: modelResult.modelName,
        userMessageContent: budgetResult.contentForStorage,
        focusModeEnabled,
        incognitoModeActive,
        deferredMemoryData,
        thinkingContent: modelResult.thinkingContent,
      };
    } catch (error) {
      logAndThrow(logger, `[RAG] Error generating response for ${personality.name}`, error);
    }
  }

  /**
   * Store interaction to long-term memory
   * Note: Caller should check incognito mode before calling this method
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
        referencedMessagesTextForSearch !== undefined && referencedMessagesTextForSearch.length > 0
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
   * Store deferred memory data to long-term memory.
   *
   * Call this method after response validation passes (e.g., after duplicate
   * detection confirms the response is unique). This ensures only ONE memory
   * is stored per interaction, even when retry logic is used.
   *
   * @param personality - The personality that generated the response
   * @param context - Conversation context
   * @param deferredData - Data returned from generateResponse when skipMemoryStorage was true
   */
  async storeDeferredMemory(
    personality: LoadedPersonality,
    context: ConversationContext,
    deferredData: DeferredMemoryData
  ): Promise<void> {
    await this.longTermMemory.storeInteraction(
      personality,
      deferredData.contentForEmbedding,
      deferredData.responseContent,
      context,
      deferredData.personaId
    );
    logger.info(
      { userId: context.userId, personalityId: personality.id, personaId: deferredData.personaId },
      '[RAG] Stored deferred memory to LTM'
    );
  }
}
