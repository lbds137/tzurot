/**
 * Extended-context cross-provider vision processing.
 *
 * Extracted from `DependencyStep` so the cross-provider vision path (resolve
 * auth + model atomically via `resolveVisionConfig`, then process) lives in its
 * own testable unit. The split is along the apiKeyResolver-present boundary —
 * DependencyStep keeps the legacy fallback inline and delegates the
 * cross-provider case here.
 */

import {
  createLogger,
  type AIProvider,
  type AttachmentMetadata,
  type SttDispatch,
} from '@tzurot/common-types';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type { GenerationContext } from '../types.js';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';
import {
  resolveVisionConfig,
  buildVisionAuthFailureResults,
} from '../../../../services/multimodal/visionAuthResolver.js';

const logger = createLogger('ExtendedContextVisionProcessor');

/**
 * Inputs for `processCrossProviderVisionImages`. `processAttachments` is passed
 * in (rather than imported) because the caller lazy-imports it to break a
 * circular dependency with MultimodalProcessor.
 */
export interface CrossProviderVisionOptions {
  imageAttachments: AttachmentMetadata[];
  personality: GenerationContext['job']['data']['personality'];
  jobId: string | undefined;
  userId: string;
  isGuestMode: boolean;
  userApiKey?: string;
  sttDispatch?: SttDispatch;
  mainProvider: AIProvider;
  apiKeyResolver: ApiKeyResolver;
  processAttachments: (typeof import('../../../../services/MultimodalProcessor.js'))['processAttachments'];
}

/**
 * Cross-provider vision path: resolve auth + model atomically via
 * `resolveVisionConfig`, then process.
 *
 * The single try/catch covers the whole block (resolution + processing) so a
 * transient resolver throw degrades the same as a `processAttachments` throw —
 * return the fail-fast placeholder (or empty on a hard processing error), log,
 * and let the chat continue. `resolveVisionConfig` may force a free-tier
 * downgrade for an authenticated user who can't auth the vision provider — that
 * forced model is threaded through `processAttachments.model` so `describeImage`
 * honors it rather than re-selecting the paid fallback.
 */
export async function processCrossProviderVisionImages(
  opts: CrossProviderVisionOptions
): Promise<ProcessedAttachment[]> {
  const {
    imageAttachments,
    personality,
    jobId,
    userId,
    isGuestMode,
    userApiKey,
    sttDispatch,
    mainProvider,
    apiKeyResolver,
    processAttachments,
  } = opts;
  try {
    const visionResult = await resolveVisionConfig({
      personality,
      mainProvider,
      mainApiKey: userApiKey,
      isGuestMode,
      userId,
      apiKeyResolver,
    });
    if (visionResult.kind === 'failFast') {
      // Even the free-model system fallback is unavailable (no system
      // OpenRouter key). Fail-fast with synthetic-failure entries; the
      // negative cache absorbs retries for 5min so the user sees a stable
      // fallback string until they fix the key.
      return await buildVisionAuthFailureResults(imageAttachments);
    }
    const { config } = visionResult;
    const processed = await processAttachments(imageAttachments, personality, {
      isGuestMode: config.isGuestMode,
      userApiKey: config.apiKey,
      sttDispatch,
      visionProvider: config.provider,
      model: config.model,
      loggingContext: {
        userId,
        apiKeySource: config.source,
        provider: config.provider,
      },
    });

    logger.info(
      {
        jobId,
        processedCount: processed.length,
        visionProvider: config.provider,
        visionModel: config.model,
      },
      'Extended context images processed successfully'
    );

    return processed;
  } catch (error) {
    logger.error(
      { err: error, jobId },
      'Failed to process extended context images - continuing without them'
    );
    return [];
  }
}
