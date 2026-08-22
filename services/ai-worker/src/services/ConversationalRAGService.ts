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

import { type BaseMessage } from '@langchain/core/messages';
import { type PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type MessageContent } from '@tzurot/common-types/types/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { contentToText } from '../utils/baseMessageContent.js';
import { logAndThrow } from '../utils/errorHandling.js';
import { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import { LLMInvoker } from './LLMInvoker.js';
import { MemoryRetriever } from './MemoryRetriever.js';
import type { FactRetriever } from './FactRetriever.js';
import { retrieveMemoriesAndFacts, createFactRetriever } from './factRetrievalHelper.js';
import { PromptBuilder } from './PromptBuilder.js';
import { LongTermMemoryService } from './LongTermMemoryService.js';
import type { ExtractionTrigger } from './extraction/ExtractionTrigger.js';
import { ContextWindowManager } from './context/ContextWindowManager.js';
import { type PersonaResolver } from '@tzurot/identity';
import { UserReferenceResolver } from './UserReferenceResolver.js';
import { ContentBudgetManager } from './ContentBudgetManager.js';
import {
  buildAttachmentDescriptions,
  buildModelSamplingConfig,
  countMediaAttachments,
} from './RAGUtils.js';
import { redisService, checkModelReasoningSupport } from '../redis.js';
import { resolveEffectiveContextWindow } from './contextWindowResolver.js';
import { deriveCacheKeyId } from './RateLimitCache.js';
import { ResponsePostProcessor } from './ResponsePostProcessor.js';
import { ConversationInputProcessor } from './ConversationInputProcessor.js';
import { interveningShippedText, logGeneratedResponse } from './cacheObservability.js';
import { MemoryPersistenceService } from './MemoryPersistenceService.js';
import { resolveRagVisionAuth, enrichRagHistory } from './multimodal/ragVisionAuth.js';
import type { ApiKeyResolver } from './ApiKeyResolver.js';
import {
  parseResponseMetadata,
  recordPreInvocationDiagnostics,
  recordLlmResponseDiagnostic,
  recordBudgetDiagnostics,
  recordInputProcessingDiagnostics,
  recordPostProcessingDiagnostics,
} from './diagnostics/DiagnosticRecorders.js';
import type { DiagnosticCollector } from './DiagnosticCollector.js';
import type {
  ConversationContext,
  ModelInvocationResult,
  ModelInvocationOptions,
  RAGResponse,
  GenerateResponseOptions,
  DeferredMemoryData,
} from './ConversationalRAGTypes.js';
import { persistBuiltReferences } from './context/referencePersistence.js';
import { loadPersonasAndResolveReferences } from './personaReferenceLoader.js';

const logger = createLogger('ConversationalRAGService');

export class ConversationalRAGService {
  private llmInvoker: LLMInvoker;
  private memoryRetriever: MemoryRetriever;
  private factRetriever?: FactRetriever;
  private promptBuilder: PromptBuilder;
  private referencedMessageFormatter: ReferencedMessageFormatter;
  private contextWindowManager: ContextWindowManager;
  private userReferenceResolver: UserReferenceResolver;
  private contentBudgetManager: ContentBudgetManager;
  private responsePostProcessor: ResponsePostProcessor;
  private inputProcessor: ConversationInputProcessor;
  private memoryPersistence: MemoryPersistenceService;

  constructor(
    private readonly prisma: PrismaClient,
    memoryManager?: PgvectorMemoryAdapter,
    personaResolver?: PersonaResolver,
    private readonly apiKeyResolver?: ApiKeyResolver,
    extractionTrigger?: ExtractionTrigger
  ) {
    this.llmInvoker = new LLMInvoker();
    // redisService doubles as the fresh-mode read-gate checker (FreshModeChecker seam)
    this.memoryRetriever = new MemoryRetriever(
      prisma,
      memoryManager,
      personaResolver,
      redisService
    );
    // Fact retrieval (Phase 2 slice 4a); undefined without a memory manager,
    // gated at call time by the runtime factsInPromptEnabled setting.
    this.factRetriever = createFactRetriever(prisma, memoryManager);
    this.promptBuilder = new PromptBuilder();
    const longTermMemory = new LongTermMemoryService(prisma, memoryManager, extractionTrigger);
    this.referencedMessageFormatter = new ReferencedMessageFormatter(prisma);
    this.contextWindowManager = new ContextWindowManager();
    this.userReferenceResolver = new UserReferenceResolver(prisma);
    this.contentBudgetManager = new ContentBudgetManager(
      this.promptBuilder,
      this.contextWindowManager
    );
    this.responsePostProcessor = new ResponsePostProcessor();
    this.inputProcessor = new ConversationInputProcessor(
      this.promptBuilder,
      this.referencedMessageFormatter
    );
    this.memoryPersistence = new MemoryPersistenceService(longTermMemory, this.memoryRetriever);
  }

  /** Invoke the model and clean up the response */
  // eslint-disable-next-line max-lines-per-function -- Core orchestration method with diagnostic logging
  private async invokeModelAndClean(opts: ModelInvocationOptions): Promise<ModelInvocationResult> {
    const {
      personality,
      systemPrompt,
      systemPromptSections,
      serializedHistory,
      currentMessage,
      historyMessages,
      crossChannelMessage,
      userMessage,
      context,
      userApiKey,
      isGuestMode,
      retryConfig,
      maxLlmAttempts,
      diagnosticCollector: diagnosticCollectorRef,
    } = opts;
    // Cast from opaque DiagnosticCollectorRef to concrete type (safe — callers always pass DiagnosticCollector)
    const diagnosticCollector = diagnosticCollectorRef as DiagnosticCollector | undefined;

    // Every element but the system prompt comes from the budget allocation —
    // the human message carries the selected memory/fact blocks in its
    // volatile prefix, so it must never be rebuilt here (a rebuild would ship
    // a memory-less turn while the budget assumed otherwise). Flag-off,
    // `historyMessages`/`crossChannelMessage` are both absent and this array
    // is byte-identical to `[systemPrompt, currentMessage]` (PR 2.3
    // byte-parity requirement). Flag-on, the array is
    // `[system, crossChannelHuman?, ...history, currentHuman]` (§9c).
    const messages: BaseMessage[] = [
      systemPrompt,
      ...(crossChannelMessage !== undefined ? [crossChannelMessage] : []),
      ...(historyMessages ?? []),
      currentMessage,
    ];

    // Check reasoning capability (async, cached with 5-min TTL).
    // Gated on the level being SET (not on it being enabled): ModelFactory's
    // supportsReasoning gate must also suppress an explicit `off`, so the
    // capability answer is needed whenever any level is configured.
    const supportsReasoning =
      personality.thinking !== undefined
        ? await checkModelReasoningSupport(personality.model)
        : undefined;

    // Get model with all LLM sampling parameters (retry config overrides for duplicate detection)
    const { model, modelName } = this.llmInvoker.getModel(
      buildModelSamplingConfig({ personality, userApiKey, retryConfig, supportsReasoning })
    );

    // Calculate attachment counts for timeout
    const { imageCount, audioCount } = countMediaAttachments(context.attachments);

    // Record assembled prompt (with section map) + LLM config for diagnostics
    if (diagnosticCollector) {
      recordPreInvocationDiagnostics({
        collector: diagnosticCollector,
        messages,
        systemPromptSections,
        countTokens: text => this.promptBuilder.countTokens(text),
        modelName,
        personality,
        effectiveTemperature: retryConfig?.temperatureOverride ?? personality.temperature,
        effectiveFrequencyPenalty:
          retryConfig?.frequencyPenaltyOverride ?? personality.frequencyPenalty,
      });
    }

    // cacheKeyId scopes doom caches by BILLING identity: guest/system-key
    // routes (including quota retargets, which pass the system key as a
    // string with isGuestMode=true) must scope as 'system', or the user's own
    // cached 402 vetoes the fallback that was chosen to dodge it.
    const cacheKeyId = deriveCacheKeyId(userApiKey, context.userId, isGuestMode);
    const response = await this.llmInvoker.invokeWithRetry({
      model,
      messages,
      modelName,
      cacheKeyId,
      imageCount,
      audioCount,
      maxAttempts: maxLlmAttempts,
    });

    // Non-text parts (thinking blocks, images) are intentionally excluded —
    // thinking content arrives via reasoning_details and is handled by
    // parseResponseMetadata/thinkingExtraction, not the content array.
    const rawContent = contentToText(response.content);

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
        // Gate: only check for leaked CoT when reasoning was configured.
        // Uses !== false (not === true) as a defensive guard — supportsReasoning
        // is always boolean in practice, but this prevents future undefined values
        // from accidentally suppressing glitch detection.
        //
        // Deliberately keys on the level being SET, not on it being enabled: a
        // config asking for `off` is exactly where an unrequested trace is most
        // likely to leak into content (providers that think regardless of the
        // request), so narrowing this to `!== 'off'` would disable leak
        // detection precisely where it earns its keep.
        reasoningEnabled: personality.thinking !== undefined && supportsReasoning !== false,
        // Included in the per-model reasoning-did-not-engage warn so log
        // searches can correlate extraction misses with specific upstream
        // model releases.
        modelName,
        // Threaded so the post-processor can strip leading verbatim echoes of
        // the user's message from the response (some LLMs learned this pattern).
        userMessage,
      }
    );

    const { cleanedContent, thinkingContent, wasDeduplicated, onlyThinkingProduced } = processed;

    // Record post-processing for diagnostics
    if (diagnosticCollector) {
      recordPostProcessingDiagnostics({
        collector: diagnosticCollector,
        rawContent,
        thinkingContent,
        cleanedContent,
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
      `Content cleanup check for ${personality.name}`
    );

    // Carries the token counts plus the prefix-cache diagnostics: the turn gap
    // the provider TTL races against, and three hashes that localize a prefix
    // change (stable core vs. inside history vs. the whole prompt).
    logGeneratedResponse(logger, {
      charCount: cleanedContent.length,
      personalityName: personality.name,
      modelName,
      systemPromptText: contentToText(systemPrompt.content),
      systemPromptSections,
      serializedHistory,
      currentMessageText: contentToText(currentMessage.content),
      ...interveningShippedText(messages),
      history: context.rawConversationHistory,
      triggerMessageId: context.triggerMessageId,
      cacheReadTokens: usageMetadata?.input_token_details?.cache_read,
      inputTokens: usageMetadata?.input_tokens,
    });

    return {
      cleanedContent,
      modelName,
      tokensIn: usageMetadata?.input_tokens,
      tokensOut: usageMetadata?.output_tokens,
      thinkingContent: thinkingContent ?? undefined,
      onlyThinkingProduced,
    };
  }

  /**
   * Generate a response using conversational RAG
   *
   * Architecture: This method orchestrates the response generation pipeline:
   * 0. Enrich history (inline image descriptions, stored references) — first,
   *    because the reference render in step 1 subtracts against what history
   *    will carry
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
      sttDispatch,
      isGuestMode = false,
      retryConfig,
      diagnosticCollector: diagnosticCollectorRef,
      configOverrides,
    } = options;
    const diagnosticCollector = diagnosticCollectorRef as DiagnosticCollector | undefined;

    try {
      // Resolve the cross-provider vision key ONCE for this request; thread it to
      // every vision call site below so none forwards the raw main-model key.
      const visionAuth = await resolveRagVisionAuth({
        personality,
        userId: context.userId,
        isGuestMode,
        mainApiKey: userApiKey,
        mainProvider: options.effectiveProvider,
        apiKeyResolver: this.apiKeyResolver,
      });

      // Step 0.5: Enrich history with inline image descriptions + hydrated stored
      // references, using the cross-provider-resolved vision auth.
      //
      // BEFORE Step 1, and that ordering is load-bearing rather than incidental.
      // The two steps communicate through a shared mutable object — this one
      // writes `imageDescriptions` onto `context.rawConversationHistory`
      // entries, and the reference render reads them back to decide how much of
      // a deduped quote <chat_log> already carries. Run the other way round, the
      // renderer sees pre-enrichment history, subtracts nothing, and the same
      // paid vision description is printed twice in one prompt (once in
      // <contextual_references>, once in <chat_log>). Nothing in Step 1 feeds
      // this call — all of its inputs are resolved above.
      await enrichRagHistory({
        prisma: this.prisma,
        context,
        personality,
        visionAuth,
        isGuestMode,
        sttDispatch,
      });

      // Read ONCE for the whole turn, before Step 1 — the reference-formatting
      // wording pickers (inside processInputs) need this turn's value before
      // Step 2.5 (`preselectHistory`) would otherwise produce it. Threaded
      // everywhere below rather than re-read, so a live flip mid-turn cannot
      // mix modes within one assembled prompt.
      const realMessagesEnabled = this.contentBudgetManager.isRealMessagesEnabled();

      // Step 1: Process inputs (attachments, messages, search query)
      const inputs = await this.inputProcessor.processInputs(personality, message, context, {
        isGuestMode,
        userApiKey,
        sttDispatch,
        visionAuth,
        realMessagesEnabled,
      });

      // Step 1.4: Write the references down. Vision and transcription were paid
      // for above; without this their only copy is a one-hour cache entry, and
      // the same quote replayed tomorrow renders `status="undescribed"`.
      await persistBuiltReferences({
        prisma: this.prisma,
        references: inputs.durableReferences,
        personalityId: personality.id,
        scope: context,
      });

      // Record input processing for diagnostics
      if (diagnosticCollector) {
        recordInputProcessingDiagnostics({
          collector: diagnosticCollector,
          message,
          inputs,
          context,
        });
      }

      // Step 2: Load personas and resolve user references
      const { participantPersonas, processedPersonality } = await loadPersonasAndResolveReferences(
        this.memoryRetriever,
        this.userReferenceResolver,
        personality,
        context
      );

      // Step 2.5: History pre-pass — select shipped history BEFORE retrieval
      // (STM/LTM dedup-hole fix: the exact shipped boundary must inform the
      // LTM query, or budget-truncated messages become reachable by neither
      // shipped-history nor LTM).
      const effectiveContextWindowTokens = await resolveEffectiveContextWindow(
        personality,
        options.effectiveProvider
      );
      const budgetOptionsBase = {
        personality,
        processedPersonality,
        participantPersonas,
        context,
        userMessage: inputs.userMessage,
        processedAttachments: inputs.processedAttachments,
        referencedMessagesDescriptions: inputs.referencedMessagesDescriptions,
        effectiveContextWindowTokens,
        realMessagesEnabled,
      };
      const preselected = this.contentBudgetManager.preselectHistory(budgetOptionsBase);
      context.stmLtmCutoffInputs = { oldestSelectedTs: preselected.oldestSelectedTs };

      // Step 3: Retrieve memories + facts (gate/scope semantics live on the helper)
      const {
        memories: retrievedMemories,
        freshModeEnabled,
        facts,
      } = await retrieveMemoriesAndFacts({
        memoryRetriever: this.memoryRetriever,
        factRetriever: this.factRetriever,
        personality,
        searchQuery: inputs.searchQuery,
        context,
        configOverrides,
        diagnosticCollector,
      });

      // Step 4: Allocate token budgets and select content
      // Note: Image descriptions and stored reference hydration are handled by
      // enrichConversationHistory (Step 0.5) — history is already enriched here
      const budgetResult = this.contentBudgetManager.allocate(
        { ...budgetOptionsBase, retrievedMemories, facts },
        preselected
      );

      // Record memory retrieval and token budget for diagnostics
      if (diagnosticCollector) {
        recordBudgetDiagnostics({
          collector: diagnosticCollector,
          retrievedMemories,
          freshModeEnabled,
          budgetResult,
          retrievedFactsCount: facts.length,
          contextWindowSize: effectiveContextWindowTokens,
          countTokens: text => this.promptBuilder.countTokens(text),
        });
      }

      // Step 5: Invoke model and clean response
      const modelResult = await this.invokeModelAndClean({
        personality,
        systemPrompt: budgetResult.systemPrompt,
        systemPromptSections: budgetResult.systemPromptSections,
        serializedHistory: budgetResult.serializedHistory,
        currentMessage: budgetResult.currentMessage,
        historyMessages: budgetResult.historyMessages,
        crossChannelMessage: budgetResult.crossChannelMessage,
        userMessage: inputs.userMessage,
        context,
        userApiKey,
        isGuestMode,
        retryConfig,
        maxLlmAttempts: options.maxLlmAttempts,
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

      // Step 6: Check incognito mode and handle memory storage.
      // A chime-in/random summon is incognito by default (skip storage, set the
      // footer flag); a personal summon records memories. The summon's anonymity
      // was resolved once in buildConversationContext. The user's own /memory
      // incognito Redis session still forces incognito regardless.
      const summonIncognito = context.summonAnonymity?.kind === 'incognito';
      const incognitoModeActive =
        summonIncognito || (await redisService.isIncognitoActive(context.userId, personality.id));

      // Build deferred memory data for potential later storage
      let deferredMemoryData: DeferredMemoryData | undefined;

      if (incognitoModeActive) {
        logger.info(
          { userId: context.userId, personalityId: personality.id },
          'Incognito mode active - skipping LTM storage'
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
            'Memory storage deferred - data included in response'
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
        freshModeEnabled,
        incognitoModeActive,
        deferredMemoryData,
        thinkingContent: modelResult.thinkingContent,
        onlyThinkingProduced: modelResult.onlyThinkingProduced,
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
