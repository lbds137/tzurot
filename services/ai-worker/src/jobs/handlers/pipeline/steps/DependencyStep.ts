/**
 * Dependency Step
 *
 * Fetches and processes preprocessing results from dependency jobs
 * (audio transcriptions, image descriptions) from Redis.
 * Also processes extended context image attachments inline.
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { REDIS_KEY_PREFIXES, JobType } from '@tzurot/common-types/constants/queue';
import {
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
} from '@tzurot/common-types/types/jobs';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';
import type { IPipelineStep, GenerationContext, PreprocessingResults } from '../types.js';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type { VisionDescriptionWriter } from '../../../../services/context/visionDescriptionWriter.js';
import { processCrossProviderVisionImages } from './extendedContextVisionProcessor.js';

const logger = createLogger('DependencyStep');

/**
 * Derive the extended-context image list from the raw envelope when the thin
 * payload no longer ships `extendedContextAttachments`. The raw list is
 * images-only and uncapped (the channel fetcher collects only images;
 * raw inputs ship pre-decision) — apply the SAME cap rule the bot applied at
 * ship time: most-recent-maxImages via slice(-cap), and maxImages <= 0 means
 * the feature is off (the bot ships undefined then, not []).
 *
 * `rawImages` is oldest-first (the fetcher's collection order, preserved on
 * the wire), so slice(-cap) keeps the most-recent cap items — matching the
 * bot's own slice(-maxImages) on the same-ordered list.
 */
export function deriveExtendedContextImages(
  rawImages: AttachmentMetadata[] | undefined,
  maxImages: number | undefined
): AttachmentMetadata[] | undefined {
  if (rawImages === undefined) {
    return undefined;
  }
  const cap = maxImages ?? 0;
  if (cap <= 0) {
    return undefined;
  }
  return rawImages.slice(-cap);
}

/**
 * Prefer the payload's resolved image list; under the thin payload the bot
 * stops shipping it and the raw envelope is the source of truth. Invariant:
 * a payload field must never be the only carrier of data the envelope also
 * holds (otherwise dropping it from the thin payload silently loses the data).
 */
function selectExtendedContextImages(
  jobContext: GenerationContext['job']['data']['context'] | undefined,
  maxImages: number | undefined
): AttachmentMetadata[] | undefined {
  return (
    jobContext?.extendedContextAttachments ??
    deriveExtendedContextImages(
      jobContext?.rawAssemblyInputs?.rawExtendedContextImageAttachments,
      maxImages
    )
  );
}

/**
 * Audio info from transcription job
 */
interface AudioInfo {
  url: string;
  name: string;
  content: string;
  sourceReferenceNumber?: number;
}

/**
 * Image info from description job
 */
interface ImageInfo {
  url: string;
  description: string;
  sourceReferenceNumber?: number;
}

export class DependencyStep implements IPipelineStep {
  readonly name = 'DependencyResolution';

  /**
   * `apiKeyResolver` is required for cross-provider vision auth resolution
   * (e.g., main=z.ai-coding + vision=OpenRouter). Optional for backwards
   * compatibility with existing test fixtures that instantiate `DependencyStep()`
   * without args; runtime instantiation in `LLMGenerationHandler` always
   * passes the resolver.
   *
   * `visionDescriptionWriter` persists rich attachment descriptions onto the
   * trigger user message immediately post-vision — the worker (producer of
   * the descriptions) owns this write; bot-client has no delivery-time
   * update.
   */
  constructor(
    private readonly apiKeyResolver?: ApiKeyResolver,
    private readonly visionDescriptionWriter?: VisionDescriptionWriter
  ) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, auth, config } = context;
    const { dependencies, context: jobContext } = job.data;

    // Use resolved effective personality from ConfigStep (includes user overrides, free model config, etc.)
    // Fall back to raw job personality only if config wasn't resolved (shouldn't happen in normal flow)
    if (!config) {
      logger.warn(
        { jobId: job.id },
        'Config context missing - using raw personality (ConfigStep may have failed)'
      );
    }
    const personality = config?.effectivePersonality ?? job.data.personality;

    // Auth should be available (AuthStep runs before DependencyStep)
    // If not available, log warning and continue without BYOK (fallback to system key)
    if (!auth) {
      logger.warn(
        { jobId: job.id },
        'Auth context not available - inline processing will use system API key'
      );
    }

    // Build initial preprocessing results from dependency jobs
    let preprocessing: PreprocessingResults = {
      processedAttachments: [],
      transcriptions: [],
      referenceAttachments: {},
    };

    if (dependencies && dependencies.length > 0) {
      logger.info(
        { jobId: job.id, dependencyCount: dependencies.length },
        'Fetching preprocessing results from dependency jobs'
      );

      const { redisService } = await import('../../../../redis.js');
      const { audioTranscriptions, imageDescriptions } = await this.fetchDependencyResults(
        dependencies,
        redisService
      );

      preprocessing = this.buildPreprocessingResults(audioTranscriptions, imageDescriptions);
    }

    // Process extended context attachments inline (not from dependency jobs)
    // Pass auth context for BYOK support (user's API key if available).
    const extendedContextImages = selectExtendedContextImages(
      jobContext,
      context.configOverrides?.maxImages
    );
    if (extendedContextImages && extendedContextImages.length > 0) {
      const extendedContextAttachments = await this.processExtendedContextAttachments(
        extendedContextImages,
        personality,
        job.id,
        {
          isGuestMode: auth?.isGuestMode ?? false,
          userApiKey: auth?.apiKey,
          sttDispatch: auth?.sttDispatch,
          mainProvider: auth?.provider,
        },
        jobContext.userId
      );
      preprocessing.extendedContextAttachments = extendedContextAttachments;
    }

    this.logPreprocessingResults(job.id, preprocessing);

    // Persist rich attachment descriptions (trigger + referenced images) into
    // durable history now that vision/transcription has produced them.
    await this.persistVisionDescriptions(context, preprocessing);

    return { ...context, preprocessing };
  }

  /**
   * Persist rich attachment descriptions into durable stored history,
   * decoupled from generation success (the writer never throws):
   * - trigger message's own attachments → upgraded message content
   * - referenced (quoted/replied-to) images → stored
   *   `referencedMessages[].resolvedImageDescriptions`, so a quoted image
   *   survives the ~1h vision-cache TTL on replay
   *
   * Both use the RAW job personality (NOT config.effectivePersonality): the
   * update must match the key the row was saved under, and routing-time
   * personality substitution doesn't change the saved row's key.
   */
  private async persistVisionDescriptions(
    context: GenerationContext,
    preprocessing: PreprocessingResults
  ): Promise<void> {
    const { job } = context;
    const jobContext = job.data.context;
    if (this.visionDescriptionWriter === undefined || jobContext === undefined) {
      return;
    }
    const personalityId = job.data.personality.id;

    if (preprocessing.processedAttachments.length > 0) {
      await this.visionDescriptionWriter.persistTriggerDescriptions({
        jobId: job.id,
        message: job.data.message,
        jobContext,
        personalityId,
        processedAttachments: preprocessing.processedAttachments,
      });
    }

    if (Object.keys(preprocessing.referenceAttachments).length > 0) {
      await this.visionDescriptionWriter.persistReferenceDescriptions({
        jobId: job.id,
        jobContext,
        personalityId,
        processedReferenceAttachments: preprocessing.referenceAttachments,
      });
    }
  }

  private async fetchDependencyResults(
    dependencies: { jobId: string; type: string; resultKey?: string }[],
    redisService: { getJobResult: <T>(key: string) => Promise<T | null> }
  ): Promise<{ audioTranscriptions: AudioInfo[]; imageDescriptions: ImageInfo[] }> {
    const audioTranscriptions: AudioInfo[] = [];
    const imageDescriptions: ImageInfo[] = [];

    for (const dep of dependencies) {
      try {
        const key = dep.resultKey?.substring(REDIS_KEY_PREFIXES.JOB_RESULT.length) ?? dep.jobId;
        if (dep.type === (JobType.AudioTranscription as string)) {
          const audio = await this.fetchAudioResult(dep.jobId, key, redisService);
          if (audio) {
            audioTranscriptions.push(audio);
          }
        } else if (dep.type === (JobType.ImageDescription as string)) {
          const images = await this.fetchImageResults(dep.jobId, key, redisService);
          imageDescriptions.push(...images);
        }
      } catch (error) {
        logger.error(
          { err: error, jobId: dep.jobId, type: dep.type },
          'Failed to fetch dependency result - continuing without it'
        );
      }
    }

    return { audioTranscriptions, imageDescriptions };
  }

  private async fetchAudioResult(
    jobId: string,
    key: string,
    redisService: { getJobResult: <T>(key: string) => Promise<T | null> }
  ): Promise<AudioInfo | null> {
    const result = await redisService.getJobResult<AudioTranscriptionResult>(key);
    if (result?.success === true && result.content !== undefined && result.content.length > 0) {
      logger.debug(
        { jobId, key, sourceRef: result.sourceReferenceNumber },
        'Retrieved audio transcription'
      );
      return {
        url: result.attachmentUrl ?? '',
        name: result.attachmentName ?? 'audio',
        content: result.content,
        sourceReferenceNumber: result.sourceReferenceNumber,
      };
    }
    logger.warn({ jobId, key }, 'Audio transcription job failed or has no result');
    return null;
  }

  private async fetchImageResults(
    jobId: string,
    key: string,
    redisService: { getJobResult: <T>(key: string) => Promise<T | null> }
  ): Promise<ImageInfo[]> {
    const result = await redisService.getJobResult<ImageDescriptionResult>(key);
    if (
      result?.success === true &&
      result.descriptions !== undefined &&
      result.descriptions.length > 0
    ) {
      logger.debug(
        { jobId, key, count: result.descriptions.length, sourceRef: result.sourceReferenceNumber },
        'Retrieved image descriptions'
      );
      return result.descriptions.map(d => ({
        ...d,
        sourceReferenceNumber: result.sourceReferenceNumber,
      }));
    }
    logger.warn({ jobId, key }, 'Image description job failed or has no result');
    return [];
  }

  /**
   * Process extended context attachments inline using MultimodalProcessor
   * These are images from extended context messages (limited by maxImages setting)
   *
   * @param attachments - Attachments to process
   * @param personality - Personality configuration for vision processing
   * @param jobId - Job ID for logging
   * @param isGuestMode - Whether user is in guest mode (uses free models)
   * @param userApiKey - User's BYOK API key (for BYOK users)
   * @param sttDispatch - Resolved STT dispatch (provider + matching BYOK key)
   */
  private async processExtendedContextAttachments(
    attachments: AttachmentMetadata[],
    personality: GenerationContext['job']['data']['personality'],
    jobId: string | undefined,
    authOptions: {
      isGuestMode: boolean;
      userApiKey?: string;
      sttDispatch?: SttDispatch;
      mainProvider?: AIProvider;
    },
    userId: string
  ): Promise<ProcessedAttachment[]> {
    const { isGuestMode, userApiKey, sttDispatch, mainProvider } = authOptions;
    // Filter to only images
    const imageAttachments = attachments.filter(a => a.contentType?.startsWith('image/'));
    if (imageAttachments.length === 0) {
      return [];
    }

    logger.info(
      {
        jobId,
        imageCount: imageAttachments.length,
        isGuestMode,
        hasUserApiKey: userApiKey !== undefined,
      },
      'Processing extended context images inline'
    );

    // Lazy import once for both branches below. Module-level static import is
    // blocked by a circular dep with MultimodalProcessor (the type-only import
    // at the top of this file is fine — types are erased). ES module caching
    // means the cost of `await import()` is a microtask after the first call,
    // so doing it once vs. twice is structurally identical at runtime — but
    // duplicating the import line in both branches was visual noise and made
    // the symmetry between the cross-provider and legacy paths harder to see.
    // `deriveApiKeySource` is only consumed by the legacy branch; destructuring
    // it here is fine — the cross-provider branch ignores the unused name.
    const { processAttachments, deriveApiKeySource } =
      await import('../../../../services/MultimodalProcessor.js');

    // Cross-provider vision auth: detect the personality's vision provider
    // and re-resolve the API key for that provider if it differs from the
    // main-model provider. Without this, a personality with main=z.ai-coding
    // + vision=OpenRouter (or vice versa) sends the wrong key to the wrong
    // provider's API and gets a 401.
    //
    // Note: `userApiKey` may be undefined here in the AuthStep error-recovery
    // case (degraded guest mode where ProviderRouter.resolveRoute threw).
    // We forward it as-is — `resolveVisionAuth` skips its same-provider fast
    // path when `mainApiKey` is empty, so per-provider resolution always runs
    // for that case rather than falling through to the legacy path that lacks
    // explicit `provider` plumbing.
    if (this.apiKeyResolver !== undefined && mainProvider !== undefined) {
      return processCrossProviderVisionImages({
        imageAttachments,
        personality,
        jobId,
        userId,
        isGuestMode,
        userApiKey,
        sttDispatch,
        mainProvider,
        apiKeyResolver: this.apiKeyResolver,
        processAttachments,
      });
    }

    // Fallback path — reached when EITHER apiKeyResolver is undefined (legacy
    // test fixture path; production always passes it via LLMGenerationHandler)
    // OR mainProvider is undefined (AuthStep error-recovery branch). Both
    // sub-cases proceed with the upstream-resolved main key verbatim — same as
    // pre-fix behavior, may misroute cross-provider personalities, but no
    // worse than before.
    //
    // The `apiKeyResolver === undefined` sub-case logs at error level because
    // it indicates a regression: the resolver should always be wired up in
    // production. The subsequent `logger.info('processed successfully',
    // path: 'legacy-fallback')` is intentional — together the two log lines
    // narrate "this shouldn't have happened, but we recovered." Operators
    // searching Railway logs for the error will see both entries and understand
    // the request did complete via the degraded path.
    if (this.apiKeyResolver === undefined) {
      logger.error(
        { jobId, mainProvider, hasUserApiKey: userApiKey !== undefined },
        'apiKeyResolver missing in DependencyStep — using legacy fallback path. ' +
          'Cross-provider personalities may misroute. This should not happen in production.'
      );
    }
    try {
      const processed = await processAttachments(imageAttachments, personality, {
        isGuestMode,
        userApiKey,
        sttDispatch,
        loggingContext: {
          userId,
          apiKeySource: deriveApiKeySource(isGuestMode, userApiKey),
        },
      });
      logger.info(
        { jobId, processedCount: processed.length, path: 'legacy-fallback' },
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

  private logPreprocessingResults(
    jobId: string | undefined,
    preprocessing: PreprocessingResults
  ): void {
    const refCount = Object.keys(preprocessing.referenceAttachments).length;
    const refAttachmentCount = Object.values(preprocessing.referenceAttachments).reduce(
      (sum, arr) => sum + arr.length,
      0
    );
    const extendedCount = preprocessing.extendedContextAttachments?.length ?? 0;
    logger.info(
      {
        jobId,
        directAttachmentCount: preprocessing.processedAttachments.length,
        referencedMessageCount: refCount,
        referencedAttachmentCount: refAttachmentCount,
        extendedContextAttachmentCount: extendedCount,
        totalPreprocessed:
          preprocessing.processedAttachments.length + refAttachmentCount + extendedCount,
      },
      'Preprocessing results ready'
    );
  }

  /**
   * Build preprocessing results from raw audio/image data
   */
  private buildPreprocessingResults(
    audioTranscriptions: AudioInfo[],
    imageDescriptions: ImageInfo[]
  ): PreprocessingResults {
    const directAttachments: ProcessedAttachment[] = [];
    const referenceAttachments: Record<number, ProcessedAttachment[]> = {};

    // Process images
    for (const img of imageDescriptions) {
      const attachment: ProcessedAttachment = {
        type: AttachmentType.Image,
        description: img.description,
        originalUrl: img.url,
        metadata: {
          url: img.url,
          name: img.url.split('/').pop() ?? 'image',
          contentType: 'image/unknown',
          size: 0,
        },
      };

      if (img.sourceReferenceNumber !== undefined) {
        referenceAttachments[img.sourceReferenceNumber] ??= [];
        referenceAttachments[img.sourceReferenceNumber].push(attachment);
      } else {
        directAttachments.push(attachment);
      }
    }

    // Process audio
    for (const audio of audioTranscriptions) {
      const attachment: ProcessedAttachment = {
        type: AttachmentType.Audio,
        description: audio.content,
        originalUrl: audio.url,
        metadata: {
          url: audio.url,
          name: audio.name,
          contentType: 'audio/unknown',
          size: 0,
        },
      };

      if (audio.sourceReferenceNumber !== undefined) {
        referenceAttachments[audio.sourceReferenceNumber] ??= [];
        referenceAttachments[audio.sourceReferenceNumber].push(attachment);
      } else {
        directAttachments.push(attachment);
      }
    }

    return {
      processedAttachments: directAttachments,
      transcriptions: audioTranscriptions
        .filter(a => a.sourceReferenceNumber === undefined)
        .map(a => a.content),
      referenceAttachments,
    };
  }
}
