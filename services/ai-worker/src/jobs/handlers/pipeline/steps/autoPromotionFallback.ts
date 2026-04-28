/**
 * Auto-promotion fallback retry orchestrator.
 *
 * Wraps a generate-attempt callback with a one-shot fallback retry for
 * auto-promoted z.ai requests. When ProviderRouter promotes an OpenRouter
 * `z-ai/<model>` request to z.ai-direct, AuthStep attaches a pre-computed
 * OpenRouter passthrough route (`auth.fallback`) ready to swap on failure —
 * defense in depth against the whitelist going stale (e.g., z.ai deprecates
 * a model without us noticing).
 *
 * Extracted from GenerationStep to keep that file under the 400-line cap.
 * Pure orchestration; doesn't know about RAG, only about the swap shape.
 */

import { createLogger, MessageContent, type ResolvedConfigOverrides } from '@tzurot/common-types';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type {
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGTypes.js';
import type { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import type { GenerationContext } from '../types.js';

const logger = createLogger('AutoPromotionFallback');

/**
 * Shape of a single generation attempt — matches the option object
 * `GenerationStep.generateWithDuplicateRetry` accepts. Kept locally rather
 * than imported because it's an internal contract between these two files.
 */
export interface GenerateAttemptOpts {
  personality: Parameters<ConversationalRAGService['generateResponse']>[0];
  message: MessageContent;
  conversationContext: ConversationContext;
  recentAssistantMessages: string[];
  apiKey: string | undefined;
  elevenlabsApiKey: string | undefined;
  isGuestMode: boolean;
  jobId: string | undefined;
  diagnosticCollector?: DiagnosticCollector;
  configOverrides?: ResolvedConfigOverrides;
}

export interface GenerateAttemptResult {
  response: RAGResponse;
  duplicateRetries: number;
  emptyRetries: number;
  leakedThinkingRetries: number;
}

type GenerateAttempt = (opts: GenerateAttemptOpts) => Promise<GenerateAttemptResult>;

/**
 * Run an attempt; if it fails AND `fallback` is set, swap personality + apiKey
 * to the fallback route and retry once. The fallback contains the original
 * (pre-promotion) `z-ai/<model>` form + OpenRouter key, so the retry hits
 * OpenRouter as if no promotion had occurred.
 *
 * Common case (`fallback === undefined`): straight passthrough, no overhead.
 * If the fallback retry also fails, the ORIGINAL error is propagated — the
 * user sees the actual root-cause failure (z.ai's response), not the
 * fallback's failure (which may be different — e.g., OpenRouter rate-limited).
 *
 * Worst-case LLM call count = 1 (z.ai initial) + ≤3 (OpenRouter inner-loop
 * retries on duplicate/empty responses). Inner `generateWithDuplicateRetry`
 * does NOT retry on HTTP errors — those rethrow immediately (see
 * GenerationStep.ts:147-161), so a z.ai HTTP failure escapes the inner loop
 * after a single call rather than consuming the 3-attempt retry budget.
 */
export async function runWithAutoPromotionFallback(
  attempt: GenerateAttempt,
  opts: GenerateAttemptOpts,
  fallback: NonNullable<GenerationContext['auth']>['fallback']
): Promise<GenerateAttemptResult> {
  if (fallback === undefined) {
    return attempt(opts);
  }

  try {
    return await attempt(opts);
  } catch (originalError) {
    logger.warn(
      {
        jobId: opts.jobId,
        err: originalError,
        promotedProvider: opts.personality.provider,
        promotedModel: opts.personality.model,
        fallbackProvider: fallback.provider,
        fallbackModel: fallback.model,
      },
      'Auto-promoted z.ai request failed; retrying via OpenRouter fallback (catalog drift defense)'
    );

    const fallbackPersonality = {
      ...opts.personality,
      provider: fallback.provider,
      model: fallback.model,
    };

    try {
      return await attempt({
        ...opts,
        personality: fallbackPersonality,
        apiKey: fallback.apiKey,
        isGuestMode: fallback.isGuestMode,
      });
    } catch (fallbackError) {
      logger.error(
        { jobId: opts.jobId, err: originalError, fallbackErr: fallbackError },
        'Auto-promotion fallback retry also failed; propagating original error'
      );
      throw originalError;
    }
  }
}
