/**
 * Dependency Step
 *
 * Fetches and processes preprocessing results from dependency jobs
 * (audio transcriptions, image descriptions) from Redis.
 * Also processes extended context image attachments inline. When the job
 * carries dependencies, the trigger's results are merged per original
 * attachment (see triggerAttachmentMerge).
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { REDIS_KEY_PREFIXES, JobType } from '@tzurot/common-types/constants/queue';
import {
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
} from '@tzurot/common-types/types/jobs';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';
import type {
  IPipelineStep,
  GenerationContext,
  PreprocessingResults,
  TriggerAttachmentDownload,
} from '../types.js';
import {
  type AudioEmptyInfo,
  type AudioFailureInfo,
  mergeTriggerAttachments,
  restoreOriginalMetadata,
} from './triggerAttachmentMerge.js';
import {
  type AudioInfo,
  buildPreprocessingResults,
  type ImageInfo,
} from './preprocessingResultsBuilder.js';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type { VisionDescriptionWriter } from '../../../../services/context/visionDescriptionWriter.js';
import { processCrossProviderVisionImages } from './extendedContextVisionProcessor.js';

const logger = createLogger('DependencyStep');

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
      referenceAttachments: {},
    };

    if (dependencies && dependencies.length > 0) {
      logger.info(
        { jobId: job.id, dependencyCount: dependencies.length },
        'Fetching preprocessing results from dependency jobs'
      );

      const { redisService } = await import('../../../../redis.js');
      const { audioTranscriptions, imageDescriptions, audioFailures, audioEmpties } =
        await this.fetchDependencyResults(dependencies, redisService);

      const rebuilt = buildPreprocessingResults(audioTranscriptions, imageDescriptions);
      // The merge runs only when the job carries dependencies; a job with none
      // leaves the trigger to ConversationInputProcessor's inline branch,
      // unchanged. DownloadAttachmentsStep did not run (or found nothing) when
      // the recorded list is absent, so the job's own attachments stand in as
      // both originals and downloads.
      const downloads: TriggerAttachmentDownload[] =
        context.triggerAttachmentDownloads ??
        (jobContext.attachments ?? []).map(attachment => ({
          original: attachment,
          downloaded: attachment,
        }));
      // Joined before anything reads the list, so the prompt render and the
      // persisted history copy both see the provenance flags.
      const joined = restoreOriginalMetadata(
        rebuilt.processedAttachments,
        downloads.map(d => d.original),
        job.id
      );
      preprocessing = {
        ...rebuilt,
        processedAttachments: await mergeTriggerAttachments({
          jobEntries: joined,
          downloads,
          audioFailures: audioFailures.filter(f => f.sourceReferenceNumber === undefined),
          audioEmpties: audioEmpties.filter(e => e.sourceReferenceNumber === undefined),
          processInline: attachments =>
            this.processTriggerFilesInline(attachments, personality, auth, jobContext.userId),
          jobId: job.id,
        }),
      };
    }

    // Process extended context attachments inline (not from dependency jobs)
    // Pass auth context for BYOK support (user's API key if available).
    // No fallback: `ExtendedContextResolutionStep` resolved this at the front
    // door, so the field is the answer rather than a hint about where to look
    // for one. `?? []` is a plain default for the no-context case only.
    const extendedContextImages = jobContext?.extendedContextAttachments ?? [];
    if (extendedContextImages.length > 0) {
      const extendedContextAttachments = await this.processExtendedContextAttachments(
        extendedContextImages,
        personality,
        job.id,
        {
          isGuestMode: auth?.isGuestMode ?? false,
          userApiKey: auth?.apiKey,
          sttDispatch: auth?.sttDispatch,
          mainProvider: auth?.provider,
          requestId: job.data.requestId,
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
   * Persist the trigger message's OWN rich attachment descriptions into its
   * stored content, decoupled from generation success (the writer never
   * throws).
   *
   * Quoted-message media is persisted elsewhere — by the formatter that builds
   * the references, which is the only place the description that reaches the
   * prompt is in hand. Deriving it a second time from these preprocessing
   * results was how the stored copy could differ from the rendered one, and it
   * missed the inline-fallback path's descriptions entirely.
   *
   * Uses the RAW job personality (NOT config.effectivePersonality): the update
   * must match the key the row was saved under, and routing-time personality
   * substitution doesn't change the saved row's key.
   *
   * `rawMessageContent` crosses to the writer as the typed-vs-voice
   * discriminator. `job.data.message` is NOT that discriminator: this step runs
   * before ContextStep re-derives the message from the envelope, so for a voice
   * trigger the field still holds the bot-side STT transcript, which the writer
   * must not prefix onto descriptions that already carry the transcript.
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

    if (preprocessing.processedAttachments.length > 0) {
      await this.visionDescriptionWriter.persistTriggerDescriptions({
        jobId: job.id,
        message: job.data.message,
        rawMessageContent: jobContext.rawAssemblyInputs?.rawMessageContent,
        jobContext,
        personalityId: job.data.personality.id,
        processedAttachments: preprocessing.processedAttachments,
      });
    }
  }

  private async fetchDependencyResults(
    dependencies: { jobId: string; type: string; resultKey?: string }[],
    redisService: { getJobResult: <T>(key: string) => Promise<T | null> }
  ): Promise<{
    audioTranscriptions: AudioInfo[];
    imageDescriptions: ImageInfo[];
    audioFailures: AudioFailureInfo[];
    audioEmpties: AudioEmptyInfo[];
  }> {
    const audioTranscriptions: AudioInfo[] = [];
    const imageDescriptions: ImageInfo[] = [];
    const audioFailures: AudioFailureInfo[] = [];
    const audioEmpties: AudioEmptyInfo[] = [];

    for (const dep of dependencies) {
      try {
        const key = dep.resultKey?.substring(REDIS_KEY_PREFIXES.JOB_RESULT.length) ?? dep.jobId;
        if (dep.type === (JobType.AudioTranscription as string)) {
          const audio = await this.fetchAudioResult(dep.jobId, key, redisService);
          if (audio?.ok === true) {
            audioTranscriptions.push(audio.audio);
          } else if (audio?.ok === false) {
            audioFailures.push(audio.failure);
          } else if (audio?.ok === 'empty') {
            audioEmpties.push(audio.empty);
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

    return { audioTranscriptions, imageDescriptions, audioFailures, audioEmpties };
  }

  private async fetchAudioResult(
    jobId: string,
    key: string,
    redisService: { getJobResult: <T>(key: string) => Promise<T | null> }
  ): Promise<
    | { ok: true; audio: AudioInfo }
    | { ok: false; failure: AudioFailureInfo }
    | { ok: 'empty'; empty: AudioEmptyInfo }
    | null
  > {
    const result = await redisService.getJobResult<AudioTranscriptionResult>(key);
    if (result?.success === true && result.content !== undefined && result.content.length > 0) {
      logger.debug(
        { jobId, key, sourceRef: result.sourceReferenceNumber },
        'Retrieved audio transcription'
      );
      return {
        ok: true,
        audio: {
          url: result.attachmentUrl ?? '',
          name: result.attachmentName ?? 'audio',
          content: result.content,
          sourceReferenceNumber: result.sourceReferenceNumber,
        },
      };
    }
    if (result?.success === true) {
      // Reached only when the non-empty arm above did not match, so the content
      // is absent or empty: a successful job with no transcript is silence, not a failure.
      logger.debug({ jobId, key }, 'Audio transcription returned an empty transcript');
      return {
        ok: 'empty',
        empty: {
          url: result.attachmentUrl ?? '',
          sourceReferenceNumber: result.sourceReferenceNumber,
        },
      };
    }
    if (result?.success === false) {
      logger.warn(
        { jobId, key, failureReason: result.failureReason },
        'Audio transcription job failed'
      );
      return {
        ok: false,
        failure: {
          url: result.attachmentUrl ?? '',
          failureReason: result.failureReason,
          sourceReferenceNumber: result.sourceReferenceNumber,
        },
      };
    }
    logger.warn({ jobId, key }, 'Audio transcription job failed or has no result');
    return null;
  }

  /**
   * Process `file`-kind trigger attachments inline. Only those reach it (no
   * vision call), so the main key is correct; it stubs unsupported types and
   * sniffs a plain WebM for audio exactly as the lone inline path does.
   */
  private async processTriggerFilesInline(
    attachments: AttachmentMetadata[],
    personality: GenerationContext['job']['data']['personality'],
    auth: GenerationContext['auth'],
    userId: string
  ): Promise<ProcessedAttachment[]> {
    // Lazy import for the same circular-dependency reason as
    // processExtendedContextAttachments.
    const { processAttachments, deriveApiKeySource } =
      await import('../../../../services/MultimodalProcessor.js');
    const isGuestMode = auth?.isGuestMode ?? false;
    const userApiKey = auth?.apiKey;
    return processAttachments(attachments, personality, {
      isGuestMode,
      userApiKey,
      sttDispatch: auth?.sttDispatch,
      loggingContext: { userId, apiKeySource: deriveApiKeySource(isGuestMode, userApiKey) },
    });
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
      requestId: string | undefined;
    },
    userId: string
  ): Promise<ProcessedAttachment[]> {
    const { isGuestMode, userApiKey, sttDispatch, mainProvider, requestId } = authOptions;
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
        requestId,
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
}
