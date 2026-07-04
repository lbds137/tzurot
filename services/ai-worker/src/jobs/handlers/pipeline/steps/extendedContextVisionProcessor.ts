/**
 * Extended-context cross-provider vision processing.
 *
 * Extracted from `DependencyStep` so the cross-provider vision path (resolve
 * auth + model atomically via `resolveVisionConfig`, then process) lives in its
 * own testable unit. The split is along the apiKeyResolver-present boundary —
 * DependencyStep keeps the legacy fallback inline and delegates the
 * cross-provider case here.
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type { GenerationContext } from '../types.js';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';

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
 * Cross-provider vision path: forward the auth INPUTS bundle to `processAttachments`,
 * which routes images through the fallback loop (`describeImageWithFallback`). All
 * per-tier auth resolution, the free-tier downgrade, and the "configure your key"
 * placeholder now live INSIDE that loop — this function no longer resolves anything.
 *
 * The try/catch is a safety net for a genuinely unexpected `processAttachments` throw
 * (the loop itself never throws — it degrades each image to a placeholder in-band): on
 * such a throw we log and return `[]` so the chat continues without the images.
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
    // Phase-4: hand the auth INPUTS to the fallback loop (via processAttachments) rather
    // than pre-resolving one config here. The loop resolves per-tier auth, retries down
    // the chain on a retryable failure, and renders a stable placeholder on exhaustion —
    // including the "configure your key" guidance the old fail-fast branch produced.
    const processed = await processAttachments(imageAttachments, personality, {
      isGuestMode,
      sttDispatch,
      visionAuth: {
        personality,
        mainProvider,
        mainApiKey: userApiKey,
        isGuestMode,
        userId,
        apiKeyResolver,
      },
      loggingContext: { userId },
    });

    logger.info(
      { jobId, processedCount: processed.length },
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
