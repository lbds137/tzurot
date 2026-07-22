/**
 * Generation Step
 *
 * Generates AI response using the RAG service with all prepared context.
 */

import {
  ApiErrorCategory,
  ApiErrorType,
  generateErrorReferenceId,
  USER_ERROR_MESSAGES,
} from '@tzurot/common-types/constants/error';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type MessageContent } from '@tzurot/common-types/types/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type FreeTierRequestQuota } from '../../../../services/FreeTierRequestQuota.js';
import { createDiagnosticCollectorForRequest } from '../../../../services/diagnostics/personalityOwnerResolver.js';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type { IPipelineStep, GenerationContext } from '../types.js';
import { type EmbeddingServiceInterface } from '../../../../utils/duplicateDetection.js';
import { runWithAutoPromotionFallback } from './autoPromotionFallback.js';
import {
  composeQuotaFallbackInfo,
  runWithQuotaFallback,
  type QuotaFallbackDeps,
} from './quotaFallbackRunner.js';
import { composeGenerationFailureResult } from './generationFailureResult.js';
import { validatePrerequisites, enforceGuestFreeTierQuota } from './generationStepValidation.js';
import { generateWithDuplicateRetry } from './duplicateRetry.js';
import { logDuplicateDetectionSetup } from './duplicateDetectionDiagnostics.js';
import { getRecentAssistantMessages } from '../../../../utils/conversationHistoryUtils.js';
import { storeDiagnosticLog } from './diagnosticStorage.js';
import { buildConversationContext } from './conversationContextBuilder.js';

const logger = createLogger('GenerationStep');

export class GenerationStep implements IPipelineStep {
  private readonly freeTierQuota: FreeTierRequestQuota | undefined;
  private readonly onZaiFreeTierFailure: ((error: unknown) => Promise<void>) | undefined;
  readonly name = 'Generation';

  constructor(
    private readonly ragService: ConversationalRAGService,
    private readonly prisma: PrismaClient,
    private readonly embeddingService?: EmbeddingServiceInterface,
    private readonly quotaFallbackDeps?: QuotaFallbackDeps,
    /** Quota-adjacent extras, bundled to keep the DI surface at five params. */
    extras?: {
      freeTierQuota?: FreeTierRequestQuota;
      /** Reacts to z.ai free-tier failures (window-exhausted cooldown, account
       * kill switch) — the errors are visible only inside the fallback runner. */
      onZaiFreeTierFailure?: (error: unknown) => Promise<void>;
    }
  ) {
    this.freeTierQuota = extras?.freeTierQuota;
    this.onZaiFreeTierFailure = extras?.onZaiFreeTierFailure;
  }

  // eslint-disable-next-line max-lines-per-function -- Pipeline step with diagnostic logging and error handling
  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, startTime, preprocessing } = context;
    const { requestId, personality, message, context: jobContext } = job.data;

    // The `asserts` annotation on validatePrerequisites narrows `context` to
    // ReadyGenerationContext for the rest of this scope, so config/auth/
    // preparedContext are typed as non-undefined without a redundant guard.
    validatePrerequisites(context);
    const { config, auth, preparedContext } = context;
    const { effectivePersonality, configSource } = config;
    const { apiKey, provider, isGuestMode } = auth;

    logger.info(
      {
        jobId: job.id,
        hasReferencedMessages: !!jobContext.referencedMessages,
        referencedMessagesCount: jobContext.referencedMessages?.length ?? 0,
      },
      'Processing with context'
    );

    const diagnosticCollector = await createDiagnosticCollectorForRequest({
      prisma: this.prisma,
      requestId,
      triggerMessageId: jobContext.triggerMessageId,
      userId: jobContext.userId,
      serverId: jobContext.serverId,
      channelId: jobContext.channelId,
      personalityId: effectivePersonality.id,
      personalityName: effectivePersonality.name,
      personalityOwnerInternalId: effectivePersonality.ownerId,
    });
    // Stash on context so downstream pipeline stages can append data
    // before the orchestrator stores the final diagnostic log.
    context.diagnosticCollector = diagnosticCollector;

    try {
      // Fair-share pre-flight for the SHARED free key (guests only). Throws the
      // FREE_TIER_QUOTA sentinel on over-share → the catch renders it
      // in-character with a bring-your-own-key CTA.
      await enforceGuestFreeTierQuota(
        this.freeTierQuota,
        isGuestMode,
        jobContext.userId,
        requestId,
        provider
      );

      // Build conversation context once (reused for retry if needed)
      const conversationContext = buildConversationContext(
        jobContext,
        preparedContext,
        preprocessing
      );

      // Get recent assistant messages for cross-turn duplicate detection
      // Checks up to 5 previous messages to catch duplicates of older responses
      const recentAssistantMessages = getRecentAssistantMessages(
        preparedContext.rawConversationHistory
      );

      // Log diagnostic info for duplicate detection setup
      logDuplicateDetectionSetup({
        jobId: job.id,
        rawConversationHistory: preparedContext.rawConversationHistory,
        recentAssistantMessages,
      });

      // Generate response with automatic retry on empty content and cross-turn duplication.
      // Two one-shot fallback layers wrap the attempt, innermost first:
      // - `runWithAutoPromotionFallback`: when ProviderRouter auto-promoted the request
      //   to z.ai-direct, a failure retries once via the pre-computed OpenRouter route
      //   (catalog-drift defense).
      // - `runWithQuotaFallback`: a quota-class failure (QUOTA_EXCEEDED /
      //   CREDIT_EXHAUSTION) retargets once to the tier-aware admin default. Its retry
      //   deliberately bypasses the auto-promotion wrapper — that wrapper's fallback
      //   route belongs to the PRIMARY model.
      const attemptOpts = {
        personality: effectivePersonality,
        message: message as MessageContent,
        conversationContext,
        recentAssistantMessages,
        apiKey,
        sttDispatch: auth.sttDispatch,
        isGuestMode,
        jobId: job.id,
        diagnosticCollector,
        configOverrides: context.configOverrides,
        // Primary attempt routes to the resolved provider; the fallback
        // wrapper overrides this to OpenRouter if it swaps to the fallback.
        effectiveProvider: provider,
      };
      const {
        response,
        duplicateRetries,
        emptyRetries,
        leakedThinkingRetries,
        effectiveProviderUsed,
        quotaFallback: reactiveQuotaFallback,
        autoPromotionFallback,
      } = await runWithQuotaFallback({
        primary: () =>
          runWithAutoPromotionFallback(
            opts => generateWithDuplicateRetry(this.ragService, this.embeddingService, opts),
            attemptOpts,
            auth.wasAutoPromoted === true ? auth.fallback : undefined
          ),
        retry: opts => generateWithDuplicateRetry(this.ragService, this.embeddingService, opts),
        opts: attemptOpts,
        userId: jobContext.userId,
        deps: this.quotaFallbackDeps,
        freeTierQuota: this.freeTierQuota,
        requestId,
        onZaiFreeTierFailure: this.onZaiFreeTierFailure,
      });
      // Three announce sources, pairwise-exclusive with the swap: the proactive
      // demotion clears `auth.fallback` (so no swap can fire), and a quota
      // retarget only fires when the whole primary FAILED (so a swap that
      // served can't coexist with it). The swap breadcrumb is therefore a
      // fallback of the existing composition, never a conflict.
      const quotaFallbackInfo =
        composeQuotaFallbackInfo(reactiveQuotaFallback, auth.quotaFallback) ??
        autoPromotionFallback;

      // Store memory ONCE after retry loop completes with a valid response.
      // This prevents duplicate memories when retries occur (the fix for the
      // "swiss cheese" duplicate memory bug - see memory:cleanup command).
      // Wrapped in try-catch: memory storage failure shouldn't fail the job
      // since the user already has their validated response.
      if (response.deferredMemoryData !== undefined && response.incognitoModeActive !== true) {
        try {
          await this.ragService.storeDeferredMemory(
            effectivePersonality,
            conversationContext,
            response.deferredMemoryData
          );
        } catch (error) {
          logger.error(
            { jobId: job.id, err: error },
            'Failed to store deferred memory - continuing without memory storage'
          );
        }
      }

      const processingTimeMs = Date.now() - startTime;
      logger.info(
        { jobId: job.id, processingTimeMs, duplicateRetries, emptyRetries, leakedThinkingRetries },
        'Generation completed'
      );

      // Final check for empty content (fallback after retry loop exhausted)
      // This handles the case where all retries still produced empty responses
      if (response.content.length === 0) {
        const emptyErrorMessage = 'LLM returned empty response after all retry attempts';
        const emptyReferenceId = generateErrorReferenceId();

        logger.warn(
          {
            jobId: job.id,
            hasThinking: response.thinkingContent !== undefined,
            thinkingLength: response.thinkingContent?.length ?? 0,
            emptyRetries,
          },
          'All retry attempts produced empty content'
        );

        // Record error for diagnostic flight recorder
        diagnosticCollector.recordError({
          message: emptyErrorMessage,
          category: ApiErrorCategory.EMPTY_RESPONSE,
          referenceId: emptyReferenceId,
          failedAtStage: 'GenerationStep (empty after retries)',
        });

        // Store diagnostic data for failures (fire-and-forget)
        storeDiagnosticLog(
          this.prisma,
          diagnosticCollector,
          response.modelUsed ?? 'unknown',
          provider ?? 'unknown'
        );

        return {
          ...context,
          result: {
            requestId,
            success: false,
            error: emptyErrorMessage,
            personalityErrorMessage: personality.errorMessage,
            errorInfo: {
              type: ApiErrorType.TRANSIENT,
              category: ApiErrorCategory.EMPTY_RESPONSE,
              userMessage: USER_ERROR_MESSAGES[ApiErrorCategory.EMPTY_RESPONSE],
              technicalMessage: emptyErrorMessage,
              referenceId: emptyReferenceId,
              shouldRetry: false, // Already retried with escalated params - model consistently produces empty
            },
            metadata: {
              processingTimeMs,
              modelUsed: response.modelUsed,
              providerUsed: effectiveProviderUsed ?? provider,
              configSource,
              isGuestMode,
              // Include thinking content so it can be shown even on failure
              thinkingContent: response.thinkingContent,
              showThinking: effectivePersonality.showThinking,
              showModelFooter: context.configOverrides?.showModelFooter,
              // A retarget may have fired even though the new model then
              // produced only empty responses — the swap still happened and
              // must still be announced (never silent).
              quotaFallback: quotaFallbackInfo,
            },
          },
        };
      }

      // Success-path diagnostic store happens in LLMGenerationHandler
      // (post-pipeline). Error-path stores remain inline above.

      return {
        ...context,
        result: {
          requestId,
          success: true,
          content: response.content,
          attachmentDescriptions: response.attachmentDescriptions,
          referencedMessagesDescriptions: response.referencedMessagesDescriptions,
          metadata: {
            retrievedMemories: response.retrievedMemories,
            tokensIn: response.tokensIn,
            tokensOut: response.tokensOut,
            processingTimeMs,
            modelUsed: response.modelUsed,
            // Effective provider after any auto-promotion fallback swap (OpenRouter
            // when the promoted z.ai call failed), so the footer links correctly.
            providerUsed: effectiveProviderUsed ?? provider,
            configSource,
            isGuestMode,
            crossTurnDuplicateDetected: duplicateRetries > 0,
            freshModeEnabled: response.freshModeEnabled,
            incognitoModeActive: response.incognitoModeActive,
            thinkingContent: response.thinkingContent,
            showThinking: effectivePersonality.showThinking,
            showModelFooter: context.configOverrides?.showModelFooter,
            // Tier-aware quota retarget (proactive from AuthStep or reactive
            // from the wrapper above) — the footer announces it, never silent.
            quotaFallback: quotaFallbackInfo,
          },
        },
      };
    } catch (error) {
      // Classification, fallback-story folding, diagnostic recording, and the
      // failure-result shape all live in the composer (see its module doc).
      return composeGenerationFailureResult({
        error,
        context,
        prisma: this.prisma,
        diagnosticCollector,
        effectivePersonality,
        configSource,
        provider,
        isGuestMode,
        // The proactive swap (if any) took effect for this failed attempt —
        // effectivePersonality is already the fallback model, and the error
        // footer must explain why. A failed REACTIVE retarget is not carried
        // (no reply came from its target); its story rides the
        // fallback-failure summary the composer already folds in.
        quotaFallback: auth.quotaFallback,
      });
    }
  }
}
