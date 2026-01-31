/* eslint-disable max-lines -- Complex orchestration service, diagnostic recording pushed slightly over 500 lines */
/**
 * @audit-ignore: database-testing
 * Reason: Orchestration layer - DB operations delegated to component services
 * (LongTermMemoryService, PgvectorMemoryAdapter, UserReferenceResolver) which have their own tests.
 * TODO: Refactor this service before adding integration tests - see BACKLOG.md
 *
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
  type ReferencedMessage,
} from '@tzurot/common-types';
import { processAttachments, type ProcessedAttachment } from './MultimodalProcessor.js';
import { stripResponseArtifacts } from '../utils/responseArtifacts.js';
import { removeDuplicateResponse } from '../utils/duplicateDetection.js';
import {
  extractThinkingBlocks,
  extractApiReasoningContent,
  mergeThinkingContent,
} from '../utils/thinkingExtraction.js';
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

    // Filter out referenced messages that are already in conversation history
    // This prevents token waste from duplicating content that's already in context
    const filteredReferences = this.filterDuplicateReferences(
      context.referencedMessages,
      context.rawConversationHistory
    );

    // Format referenced messages (with vision/transcription)
    // Pass userApiKey for BYOK support in inline fallback processing
    const referencedMessagesDescriptions =
      filteredReferences.length > 0
        ? await this.referencedMessageFormatter.formatReferencedMessages(
            filteredReferences,
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

    // Resolve user references across all personality text fields
    // This handles shapes.inc format mentions in systemPrompt, characterInfo,
    // conversationalExamples, and other character definition fields
    // Note: Don't pass activePersonaId here - personality.id is a personality UUID, not a persona UUID.
    // Personalities are templates not tied to a specific persona, so self-reference detection doesn't apply.
    const { resolvedPersonality: processedPersonality, resolvedPersonas } =
      await this.userReferenceResolver.resolvePersonalityReferences(personality);

    // Add resolved personas to participants
    if (resolvedPersonas.length > 0) {
      for (const persona of resolvedPersonas) {
        if (!participantPersonas.has(persona.personaName)) {
          participantPersonas.set(persona.personaName, {
            preferredName: persona.preferredName ?? undefined,
            pronouns: persona.pronouns ?? undefined,
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

      logger.info(
        `[RAG] Resolved ${resolvedPersonas.length} user reference(s) in personality fields`
      );
    }

    return { participantPersonas, processedPersonality };
  }

  /**
   * Process thinking content from model response.
   * Handles edge case where model wraps entire response in thinking tags (e.g., R1T Chimera).
   */
  private processThinkingContent(
    deduplicatedContent: string,
    apiReasoning: string | null
  ): { visibleContent: string; thinkingContent: string | null } {
    const { thinkingContent: inlineThinking, visibleContent: extractedVisibleContent } =
      extractThinkingBlocks(deduplicatedContent);

    let visibleContent = extractedVisibleContent;
    let thinkingUsedAsResponse = false;

    // Handle edge case: if visible content is empty but thinking content exists,
    // the model likely wrapped its entire response in thinking tags
    if (
      visibleContent.trim().length === 0 &&
      inlineThinking !== null &&
      inlineThinking.length > 0
    ) {
      logger.warn(
        { inlineThinkingLength: inlineThinking.length },
        '[RAG] Empty visible content after thinking extraction - using thinking content as response'
      );
      visibleContent = inlineThinking;
      thinkingUsedAsResponse = true;
    }

    // Merge all sources - API reasoning first, then inline
    // If thinking was used as response, don't duplicate it as thinking content
    const thinkingContent = thinkingUsedAsResponse
      ? apiReasoning
      : mergeThinkingContent(apiReasoning, inlineThinking);

    if (thinkingUsedAsResponse) {
      logger.debug(
        { hasApiReasoning: apiReasoning !== null, inlineThinkingLength: inlineThinking?.length },
        '[RAG] Using thinking content as response - inline thinking discarded to avoid duplication'
      );
    }

    if (apiReasoning !== null) {
      logger.debug(
        { apiReasoningLength: apiReasoning.length, hasInline: inlineThinking !== null },
        '[RAG] Extracted API-level reasoning from response'
      );
    }

    return { visibleContent, thinkingContent };
  }

  /** Invoke the model and clean up the response */
  // eslint-disable-next-line max-lines-per-function, complexity -- Core orchestration method with diagnostic logging
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
      diagnosticCollector,
    } = opts;
    // Build current message
    const { message: currentMessage } = this.promptBuilder.buildHumanMessage(
      userMessage,
      processedAttachments,
      context.activePersonaName,
      referencedMessagesDescriptions,
      context.activePersonaId
    );

    // Build messages array
    const messages: BaseMessage[] = [systemPrompt, currentMessage];

    // Get model with all LLM sampling parameters
    // Apply retry config overrides if present (for duplicate detection retries)
    const effectiveTemperature = retryConfig?.temperatureOverride ?? personality.temperature;
    const effectiveFrequencyPenalty =
      retryConfig?.frequencyPenaltyOverride ?? personality.frequencyPenalty;

    const { model, modelName } = this.llmInvoker.getModel({
      modelName: personality.model,
      apiKey: userApiKey,
      // Basic sampling
      temperature: effectiveTemperature,
      topP: personality.topP,
      topK: personality.topK,
      frequencyPenalty: effectiveFrequencyPenalty,
      presencePenalty: personality.presencePenalty,
      repetitionPenalty: personality.repetitionPenalty,
      maxTokens: personality.maxTokens,
      // Advanced sampling
      minP: personality.minP,
      topA: personality.topA,
      seed: personality.seed,
      // Output control
      stop: personality.stop,
      logitBias: personality.logitBias,
      responseFormat: personality.responseFormat,
      showThinking: personality.showThinking,
      // Reasoning (for thinking models: o1/o3, Claude, DeepSeek R1)
      reasoning: personality.reasoning,
      // OpenRouter-specific
      transforms: personality.transforms,
      route: personality.route,
      verbosity: personality.verbosity,
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

    // Record assembled prompt and LLM config for diagnostics
    if (diagnosticCollector) {
      const totalTokenEstimate =
        this.promptBuilder.countTokens(systemPrompt.content as string) +
        this.promptBuilder.countTokens(currentMessage.content as string);

      diagnosticCollector.recordAssembledPrompt(messages, totalTokenEstimate);
      diagnosticCollector.recordLlmConfig({
        model: modelName,
        provider: modelName.split('/')[0] || 'unknown',
        // Basic sampling
        temperature: effectiveTemperature,
        topP: personality.topP,
        topK: personality.topK,
        maxTokens: personality.maxTokens,
        frequencyPenalty: effectiveFrequencyPenalty,
        presencePenalty: personality.presencePenalty,
        repetitionPenalty: personality.repetitionPenalty,
        // Advanced sampling
        minP: personality.minP,
        topA: personality.topA,
        seed: personality.seed,
        // Output control
        stop: personality.stop,
        logitBias: personality.logitBias,
        responseFormat: personality.responseFormat,
        showThinking: personality.showThinking,
        // Reasoning (for thinking models)
        reasoning: personality.reasoning,
        // OpenRouter-specific
        transforms: personality.transforms,
        route: personality.route,
        verbosity: personality.verbosity,
        // Stop sequences (generated at runtime)
        stopSequences,
      });
      diagnosticCollector.markLlmInvocationStart();
    }

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

    // Extract token usage, finish reason, and reasoning details for diagnostics
    const responseData = response as unknown as {
      usage_metadata?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
      response_metadata?: {
        finish_reason?: string;
        stop_reason?: string;
        finishReason?: string;
        stop?: string;
        stop_sequence?: string;
        // OpenRouter API-level reasoning (some providers use this format)
        reasoning_details?: unknown[];
      };
      // LangChain puts unknown fields from the API response here
      // OpenRouter puts DeepSeek R1's reasoning content in additional_kwargs.reasoning
      additional_kwargs?: {
        reasoning?: string;
      };
    };
    const usageMetadata = responseData.usage_metadata;
    const responseMetadata = responseData.response_metadata;
    const additionalKwargs = responseData.additional_kwargs;

    // Record LLM response for diagnostics
    if (diagnosticCollector) {
      const finishReason =
        responseMetadata?.finish_reason ??
        responseMetadata?.stop_reason ??
        responseMetadata?.finishReason ??
        'unknown';
      const rawStop = responseMetadata?.stop;
      const rawStopSeq = responseMetadata?.stop_sequence;
      const stopSequenceTriggered =
        (typeof rawStop === 'string' ? rawStop : null) ??
        (typeof rawStopSeq === 'string' ? rawStopSeq : null);

      diagnosticCollector.recordLlmResponse({
        rawContent,
        finishReason: String(finishReason),
        stopSequenceTriggered,
        promptTokens: usageMetadata?.input_tokens ?? 0,
        completionTokens: usageMetadata?.output_tokens ?? 0,
        modelUsed: modelName,
        // Debug info for troubleshooting reasoning extraction
        reasoningDebug: {
          additionalKwargsKeys: additionalKwargs !== undefined ? Object.keys(additionalKwargs) : [],
          hasReasoningInKwargs:
            additionalKwargs?.reasoning !== undefined &&
            typeof additionalKwargs.reasoning === 'string',
          reasoningKwargsLength:
            typeof additionalKwargs?.reasoning === 'string' ? additionalKwargs.reasoning.length : 0,
          responseMetadataKeys: responseMetadata !== undefined ? Object.keys(responseMetadata) : [],
          hasReasoningDetails: Array.isArray(responseMetadata?.reasoning_details),
        },
      });
    }

    // Remove duplicate content (stop-token failure bug in some models like GLM-4.7)
    const deduplicatedContent = removeDuplicateResponse(rawContent);

    // Extract thinking content from THREE sources (in priority order):
    // 1. additional_kwargs.reasoning - OpenRouter puts DeepSeek R1 reasoning here
    // 2. response_metadata.reasoning_details - Some providers use this format
    // 3. Inline thinking tags (<think>, <thinking>, etc.) - In the content itself
    //
    // LangChain's ChatOpenAI puts unknown API response fields in additional_kwargs,
    // which is where OpenRouter places the extracted thinking content for R1 models.
    let apiReasoning: string | null = null;

    // First check additional_kwargs.reasoning (primary location for DeepSeek R1)
    if (
      additionalKwargs?.reasoning !== undefined &&
      typeof additionalKwargs.reasoning === 'string' &&
      additionalKwargs.reasoning.length > 0
    ) {
      apiReasoning = additionalKwargs.reasoning;
      logger.debug(
        { reasoningLength: apiReasoning.length },
        '[RAG] Found reasoning content in additional_kwargs.reasoning'
      );
    }
    // Fall back to reasoning_details array (some providers use this format)
    else {
      apiReasoning = extractApiReasoningContent(responseMetadata?.reasoning_details);
    }

    // Process thinking content (handles R1T Chimera edge case where response is wrapped in thinking tags)
    const { visibleContent, thinkingContent } = this.processThinkingContent(
      deduplicatedContent,
      apiReasoning
    );

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

    // Record post-processing for diagnostics
    if (diagnosticCollector) {
      diagnosticCollector.recordPostProcessing({
        rawContent,
        deduplicatedContent,
        thinkingContent,
        strippedContent: visibleContent,
        finalContent: cleanedContent,
      });
    }

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
    const { userApiKey, isGuestMode = false, retryConfig, diagnosticCollector } = options;

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

      // Record input processing for diagnostics
      if (diagnosticCollector) {
        diagnosticCollector.recordInputProcessing({
          rawUserMessage: typeof message === 'string' ? message : message.content,
          processedAttachments: inputs.processedAttachments,
          referencedMessages: context.referencedMessages?.map(ref => ({
            discordMessageId: ref.discordMessageId,
            content: ref.content,
          })),
          searchQuery: inputs.searchQuery,
        });
      }

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
      diagnosticCollector?.markMemoryRetrievalStart();
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

      // Record memory retrieval and token budget for diagnostics
      if (diagnosticCollector) {
        diagnosticCollector.recordMemoryRetrieval({
          retrievedMemories,
          selectedMemories: budgetResult.relevantMemories,
          focusModeEnabled,
        });
        diagnosticCollector.recordTokenBudget({
          contextWindowSize: personality.contextWindowTokens ?? 131072,
          systemPromptTokens: this.promptBuilder.countTokens(
            budgetResult.systemPrompt.content as string
          ),
          memoryTokensUsed: budgetResult.memoryTokensUsed,
          historyTokensUsed: budgetResult.historyTokensUsed,
          memoriesDropped: budgetResult.memoriesDroppedCount,
          historyMessagesDropped: budgetResult.messagesDropped,
        });
      }

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
        diagnosticCollector,
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

  /**
   * Filter out referenced messages that are already in conversation history
   *
   * This prevents token waste from duplicating content. When a user replies to
   * a recent message, that message is likely already in the conversation history.
   * Including it again as a quoted message wastes tokens.
   *
   * @param referencedMessages - Messages being quoted/replied to
   * @param conversationHistory - Current conversation history (raw format with optional id)
   * @returns Filtered list of referenced messages not in history
   */
  private filterDuplicateReferences(
    referencedMessages: ReferencedMessage[] | undefined,
    conversationHistory: { id?: string }[] | undefined
  ): ReferencedMessage[] {
    if (!referencedMessages || referencedMessages.length === 0) {
      return [];
    }

    if (!conversationHistory || conversationHistory.length === 0) {
      return referencedMessages;
    }

    // Build set of message IDs from conversation history
    const historyIds = new Set<string>();
    for (const msg of conversationHistory) {
      if (msg.id !== undefined && msg.id.length > 0) {
        historyIds.add(msg.id);
      }
    }

    // Filter out referenced messages that are already in history
    const filtered = referencedMessages.filter(ref => !historyIds.has(ref.discordMessageId));

    if (filtered.length < referencedMessages.length) {
      const removed = referencedMessages.length - filtered.length;
      logger.debug(
        {
          originalCount: referencedMessages.length,
          filteredCount: filtered.length,
          removedCount: removed,
        },
        '[RAG] Filtered out referenced messages already in conversation history'
      );
    }

    return filtered;
  }
}
