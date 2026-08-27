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

import { type PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type MessageContent } from '@tzurot/common-types/types/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
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
import { buildAttachmentDescriptions } from './RAGUtils.js';
import { redisService } from '../redis.js';
import { resolveEffectiveContextWindow } from './contextWindowResolver.js';
import { ResponsePostProcessor } from './ResponsePostProcessor.js';
import { ConversationInputProcessor } from './ConversationInputProcessor.js';
import { MemoryPersistenceService } from './MemoryPersistenceService.js';
import { resolveRagVisionAuth, enrichRagHistory } from './multimodal/ragVisionAuth.js';
import type { ApiKeyResolver } from './ApiKeyResolver.js';
import {
  recordBudgetDiagnostics,
  recordInputProcessingDiagnostics,
} from './diagnostics/DiagnosticRecorders.js';
import type { DiagnosticCollector } from './DiagnosticCollector.js';
import type {
  ConversationContext,
  RAGResponse,
  GenerateResponseOptions,
  DeferredMemoryData,
} from './ConversationalRAGTypes.js';
import { persistBuiltReferences } from './context/referencePersistence.js';
import { loadPersonasAndResolveReferences } from './personaReferenceLoader.js';
import { invokeModelAndClean } from './modelInvocation.js';

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
        requestId: context.requestId,
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
      // mix modes within one assembled prompt. `headerSpoofNeutralizeEnabled`
      // rides the same capture-once contract.
      const realMessagesEnabled = this.contentBudgetManager.isRealMessagesEnabled();
      const headerSpoofNeutralizeEnabled =
        this.contentBudgetManager.isHeaderSpoofNeutralizeEnabled();

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
        headerSpoofNeutralizeEnabled,
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
      const modelResult = await invokeModelAndClean(
        {
          promptBuilder: this.promptBuilder,
          llmInvoker: this.llmInvoker,
          responsePostProcessor: this.responsePostProcessor,
          inputProcessor: this.inputProcessor,
        },
        {
          personality,
          systemPrompt: budgetResult.systemPrompt,
          systemPromptSections: budgetResult.systemPromptSections,
          serializedHistory: budgetResult.serializedHistory,
          currentMessage: budgetResult.currentMessage,
          historyMessages: budgetResult.historyMessages,
          crossChannelMessage: budgetResult.crossChannelMessage,
          userMessage: inputs.userMessage,
          realMessagesEnabled,
          context,
          userApiKey,
          isGuestMode,
          retryConfig,
          maxLlmAttempts: options.maxLlmAttempts,
          diagnosticCollector,
        }
      );

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
