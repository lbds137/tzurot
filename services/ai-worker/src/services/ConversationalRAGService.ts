/**
 * Conversational RAG Service - Orchestrates memory-augmented conversations
 *
 * @audit-ignore: database-testing
 * Reason: Orchestration layer - DB operations delegated to component services
 *
 * Helper modules extracted to separate files:
 * - ResponsePostProcessor: Response cleaning and reasoning extraction
 * - ConversationInputProcessor: Input normalization and attachment handling
 * - MemoryPersistenceService: Long-term memory storage
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
  enrichConversationHistory,
  countMediaAttachments,
} from './RAGUtils.js';
import { redisService, visionDescriptionCache } from '../redis.js';
import { ResponsePostProcessor } from './ResponsePostProcessor.js';
import { ConversationInputProcessor } from './ConversationInputProcessor.js';
import { MemoryPersistenceService } from './MemoryPersistenceService.js';
import { processAttachments } from './MultimodalProcessor.js';
import {
  parseResponseMetadata,
  recordLlmConfigDiagnostic,
  recordLlmResponseDiagnostic,
} from './diagnostics/DiagnosticRecorders.js';
import type { DiagnosticCollector } from './DiagnosticCollector.js';
import type {
  ConversationContext,
  PersonaLoadResult,
  ModelInvocationResult,
  ModelInvocationOptions,
  RAGResponse,
  GenerateResponseOptions,
  DeferredMemoryData,
} from './ConversationalRAGTypes.js';

const logger = createLogger('ConversationalRAGService');

export class ConversationalRAGService {
  private llmInvoker: LLMInvoker;
  private memoryRetriever: MemoryRetriever;
  private promptBuilder: PromptBuilder;
  private referencedMessageFormatter: ReferencedMessageFormatter;
  private contextWindowManager: ContextWindowManager;
  private userReferenceResolver: UserReferenceResolver;
  private contentBudgetManager: ContentBudgetManager;
  private responsePostProcessor: ResponsePostProcessor;
  private inputProcessor: ConversationInputProcessor;
  private memoryPersistence: MemoryPersistenceService;

  constructor(memoryManager?: PgvectorMemoryAdapter, personaResolver?: PersonaResolver) {
    this.llmInvoker = new LLMInvoker();
    this.memoryRetriever = new MemoryRetriever(memoryManager, personaResolver);
    this.promptBuilder = new PromptBuilder();
    const longTermMemory = new LongTermMemoryService(memoryManager);
    this.referencedMessageFormatter = new ReferencedMessageFormatter();
    this.contextWindowManager = new ContextWindowManager();
    this.userReferenceResolver = new UserReferenceResolver(getPrismaClient());
    this.contentBudgetManager = new ContentBudgetManager(
      this.promptBuilder,
      this.contextWindowManager
    );
    this.responsePostProcessor = new ResponsePostProcessor();
    this.inputProcessor = new ConversationInputProcessor(
      this.promptBuilder,
      this.referencedMessageFormatter,
      this.responsePostProcessor
    );
    this.memoryPersistence = new MemoryPersistenceService(longTermMemory, this.memoryRetriever);
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

    // Resolve user references across all personality text fields (shapes.inc format mentions)
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

  /** Invoke the model and clean up the response */
  // eslint-disable-next-line max-lines-per-function -- Core orchestration method with diagnostic logging
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
      diagnosticCollector: diagnosticCollectorRef,
    } = opts;
    // Cast from opaque DiagnosticCollectorRef to concrete type (safe — callers always pass DiagnosticCollector)
    const diagnosticCollector = diagnosticCollectorRef as DiagnosticCollector | undefined;
    // Build current message
    const { message: currentMessage } = this.promptBuilder.buildHumanMessage(
      userMessage,
      processedAttachments,
      {
        activePersonaName: context.activePersonaName,
        referencedMessagesDescriptions,
        activePersonaId: context.activePersonaId,
        discordUsername: context.discordUsername,
        personalityName: personality.name,
      }
    );

    // Build messages array
    const messages: BaseMessage[] = [systemPrompt, currentMessage];

    // Get model with all LLM sampling parameters (retry config overrides for duplicate detection)
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
    const { imageCount, audioCount } = countMediaAttachments(context.attachments);

    // Generate stop sequences
    const stopSequences = generateStopSequences(personality.name, participantPersonas);

    // Record assembled prompt and LLM config for diagnostics
    if (diagnosticCollector) {
      const totalTokenEstimate =
        this.promptBuilder.countTokens(systemPrompt.content as string) +
        this.promptBuilder.countTokens(currentMessage.content as string);

      diagnosticCollector.recordAssembledPrompt(messages, totalTokenEstimate);
      recordLlmConfigDiagnostic({
        collector: diagnosticCollector,
        modelName,
        personality,
        effectiveTemperature: retryConfig?.temperatureOverride ?? personality.temperature,
        effectiveFrequencyPenalty:
          retryConfig?.frequencyPenaltyOverride ?? personality.frequencyPenalty,
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

    // Extract token usage, finish reason, and reasoning details
    const metadata = parseResponseMetadata(response);
    const { usageMetadata, additionalKwargs, responseMetadata } = metadata;

    // Record LLM response for diagnostics
    if (diagnosticCollector) {
      recordLlmResponseDiagnostic(diagnosticCollector, rawContent, modelName, metadata);
    }

    // Process response: deduplicate, extract reasoning, strip artifacts, replace placeholders
    const processed = this.responsePostProcessor.processResponse(
      rawContent,
      additionalKwargs,
      responseMetadata,
      {
        personalityName: personality.name,
        userName: this.inputProcessor.resolveUserName(context),
        discordUsername: context.discordUsername,
      }
    );

    const { cleanedContent, thinkingContent, wasDeduplicated } = processed;

    // Record post-processing for diagnostics
    if (diagnosticCollector) {
      diagnosticCollector.recordPostProcessing({
        rawContent,
        deduplicatedContent: rawContent, // Already processed in responsePostProcessor
        thinkingContent,
        strippedContent: cleanedContent,
        finalContent: cleanedContent,
      });
    }

    logger.debug(
      {
        rawContentPreview: rawContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
        cleanedContentPreview: cleanedContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW),
        wasDeduplicated,
        hadThinkingBlocks: thinkingContent !== null,
        thinkingContentLength: thinkingContent?.length ?? 0,
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
    const {
      userApiKey,
      isGuestMode = false,
      retryConfig,
      diagnosticCollector: diagnosticCollectorRef,
    } = options;
    const diagnosticCollector = diagnosticCollectorRef as DiagnosticCollector | undefined;

    try {
      // Step 1: Process inputs (attachments, messages, search query)
      const inputs = await this.inputProcessor.processInputs(
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

      // Step 1.5: Enrich history with inline image descriptions + hydrated stored references
      await enrichConversationHistory(
        context.rawConversationHistory,
        context.preprocessedExtendedContextAttachments,
        getPrismaClient(),
        visionDescriptionCache,
        atts => processAttachments(atts, personality, isGuestMode, userApiKey)
      );

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
      // Note: Image descriptions and stored reference hydration are handled by
      // enrichConversationHistory (Step 1.5) — history is already enriched here
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
        // Deferred storage: build data for caller to store later
        deferredMemoryData =
          (await this.memoryPersistence.buildDeferredMemoryData(
            context,
            personality.id,
            budgetResult.contentForStorage,
            finalContent,
            inputs.referencedMessagesTextForSearch
          )) ?? undefined;
        if (deferredMemoryData !== undefined) {
          logger.debug(
            { userId: context.userId, personalityId: personality.id },
            '[RAG] Memory storage deferred - data included in response'
          );
        }
      } else {
        // Immediate storage (default behavior)
        await this.memoryPersistence.storeInteraction(
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
   * Store deferred memory data to long-term memory.
   *
   * Call this method after response validation passes (e.g., after duplicate
   * detection confirms the response is unique). This ensures only ONE memory
   * is stored per interaction, even when retry logic is used.
   */
  async storeDeferredMemory(
    personality: LoadedPersonality,
    context: ConversationContext,
    deferredData: DeferredMemoryData
  ): Promise<void> {
    await this.memoryPersistence.storeDeferredMemory(personality, context, deferredData);
  }
}
