/**
 * Failure-result composition for GenerationStep's catch path.
 *
 * Owns the error-path choreography: classify from the PRISTINE message, fold
 * the auto-promotion fallback story in AFTER classification (so incidental
 * wording in the fallback's error can't flip the root-cause category), record
 * the failure in the diagnostic collector, and shape the failure result the
 * pipeline returns to the delivery layer.
 *
 * Extracted from GenerationStep to keep that file under the size cap.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { parseApiError, getErrorLogContext } from '../../../../utils/apiErrorParser.js';
import { RetryError } from '../../../../utils/retry.js';
import type { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import type { GenerationContext } from '../types.js';
import {
  composeFallbackAwareErrorMessage,
  getAttemptedFallbackProvider,
  withFallbackFailure,
} from './autoPromotionFallback.js';
import { storeDiagnosticLog } from './diagnosticStorage.js';

// Named for the step that owns this path — the error logs here have always
// carried the GenerationStep source, and log greps depend on that continuity.
const logger = createLogger('GenerationStep');

type ReadyConfig = NonNullable<GenerationContext['config']>;
type ReadyAuth = NonNullable<GenerationContext['auth']>;

export interface GenerationFailureOptions {
  /** The error caught from the generation attempt (possibly RetryError-wrapped). */
  error: unknown;
  /** Pipeline context the failure result is spread onto. */
  context: GenerationContext;
  prisma: PrismaClient;
  diagnosticCollector: DiagnosticCollector;
  effectivePersonality: ReadyConfig['effectivePersonality'];
  configSource: ReadyConfig['configSource'];
  provider: ReadyAuth['provider'];
  isGuestMode: boolean;
}

/**
 * Compose the pipeline failure result for a generation error.
 *
 * The compound error message must ALSO land on errorInfo.technicalMessage —
 * that field (not result.error, which is log-only) is what bot-client's
 * buildErrorContent renders into the persona-voiced Discord error.
 */
export function composeGenerationFailureResult(
  options: GenerationFailureOptions
): GenerationContext {
  const {
    error,
    context,
    prisma,
    diagnosticCollector,
    effectivePersonality,
    configSource,
    provider,
    isGuestMode,
  } = options;
  const { job, startTime } = context;
  const { requestId, personality } = job.data;
  const processingTimeMs = Date.now() - startTime;

  const underlyingError = error instanceof RetryError ? error.lastError : error;
  // Classify from the PRISTINE message; the compose step below appends the
  // fallback-failure summary (if any) AFTER classification.
  const errorInfo = withFallbackFailure(parseApiError(underlyingError), error);
  const errorMessage = composeFallbackAwareErrorMessage(error);

  logger.error(
    { err: error, jobId: job.id, ...getErrorLogContext(underlyingError) },
    `Generation failed: ${errorInfo.category}`
  );

  // Record partial LLM response for /admin debug visibility
  // The LLMInvoker may have thrown before recordLlmResponse() was called
  diagnosticCollector.recordPartialLlmResponse({
    rawContent: '[error — see error data]',
    modelUsed: effectivePersonality.model ?? 'unknown',
  });

  // Record error in diagnostic collector for debugging failed requests
  diagnosticCollector.recordError({
    message: errorMessage,
    category: errorInfo.category,
    referenceId: errorInfo.referenceId,
    rawError: getErrorLogContext(underlyingError),
    failedAtStage: 'GenerationStep',
  });

  // Store diagnostic data even for failures (fire-and-forget)
  // This enables /admin debug to show what went wrong
  storeDiagnosticLog(
    prisma,
    diagnosticCollector,
    effectivePersonality.model ?? 'unknown',
    provider ?? 'unknown'
  );

  return {
    ...context,
    result: {
      requestId,
      success: false,
      error: errorMessage,
      personalityErrorMessage: personality.errorMessage,
      errorInfo,
      metadata: {
        processingTimeMs,
        modelUsed: effectivePersonality.model ?? undefined,
        providerUsed: provider,
        // The failed fallback attempt (if any) rides along so the error
        // footer renders the full route chain, not just the primary.
        fallbackProviderAttempted: getAttemptedFallbackProvider(error),
        configSource,
        isGuestMode,
        showModelFooter: context.configOverrides?.showModelFooter,
      },
    },
  };
}
