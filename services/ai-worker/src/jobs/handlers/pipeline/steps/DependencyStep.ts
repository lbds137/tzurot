/**
 * Dependency Step
 *
 * Fetches and processes preprocessing results from dependency jobs
 * (audio transcriptions, image descriptions) from Redis.
 * Also processes extended context image attachments inline.
 */

import {
  createLogger,
  REDIS_KEY_PREFIXES,
  AttachmentType,
  JobType,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
} from '@tzurot/common-types';
import type { AttachmentMetadata } from '@tzurot/common-types';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';
import type { IPipelineStep, GenerationContext, PreprocessingResults } from '../types.js';

const logger = createLogger('DependencyStep');

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

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, auth, config } = context;
    const { dependencies, context: jobContext } = job.data;

    // Use resolved effective personality from ConfigStep (includes user overrides, free model config, etc.)
    // Fall back to raw job personality only if config wasn't resolved (shouldn't happen in normal flow)
    if (!config) {
      logger.warn(
        { jobId: job.id },
        '[DependencyStep] Config context missing - using raw personality (ConfigStep may have failed)'
      );
    }
    const personality = config?.effectivePersonality ?? job.data.personality;

    // Auth should be available (AuthStep runs before DependencyStep)
    // If not available, log warning and continue without BYOK (fallback to system key)
    if (!auth) {
      logger.warn(
        { jobId: job.id },
        '[DependencyStep] Auth context not available - inline processing will use system API key'
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
        '[DependencyStep] Fetching preprocessing results from dependency jobs'
      );

      const { redisService } = await import('../../../../redis.js');
      const { audioTranscriptions, imageDescriptions } = await this.fetchDependencyResults(
        dependencies,
        redisService
      );

      preprocessing = this.buildPreprocessingResults(audioTranscriptions, imageDescriptions);
    }

    // Process extended context attachments inline (not from dependency jobs)
    // Pass auth context for BYOK support (user's API key if available)
    if (
      jobContext?.extendedContextAttachments &&
      jobContext.extendedContextAttachments.length > 0
    ) {
      const extendedContextAttachments = await this.processExtendedContextAttachments(
        jobContext.extendedContextAttachments,
        personality,
        job.id,
        auth?.isGuestMode ?? false,
        auth?.apiKey
      );
      preprocessing.extendedContextAttachments = extendedContextAttachments;
    }

    this.logPreprocessingResults(job.id, preprocessing);

    return { ...context, preprocessing };
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
          '[DependencyStep] Failed to fetch dependency result - continuing without it'
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
        '[DependencyStep] Retrieved audio transcription'
      );
      return {
        url: result.attachmentUrl ?? '',
        name: result.attachmentName ?? 'audio',
        content: result.content,
        sourceReferenceNumber: result.sourceReferenceNumber,
      };
    }
    logger.warn({ jobId, key }, '[DependencyStep] Audio transcription job failed or has no result');
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
        '[DependencyStep] Retrieved image descriptions'
      );
      return result.descriptions.map(d => ({
        ...d,
        sourceReferenceNumber: result.sourceReferenceNumber,
      }));
    }
    logger.warn({ jobId, key }, '[DependencyStep] Image description job failed or has no result');
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
   */
  private async processExtendedContextAttachments(
    attachments: AttachmentMetadata[],
    personality: GenerationContext['job']['data']['personality'],
    jobId: string | undefined,
    isGuestMode: boolean,
    userApiKey?: string
  ): Promise<ProcessedAttachment[]> {
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
      '[DependencyStep] Processing extended context images inline'
    );

    try {
      // Import processAttachments (lazy import to avoid circular deps)
      const { processAttachments } = await import('../../../../services/MultimodalProcessor.js');

      // Process images using MultimodalProcessor (uses VisionDescriptionCache)
      // Pass auth context for BYOK support
      const processed = await processAttachments(
        imageAttachments,
        personality,
        isGuestMode,
        userApiKey
      );

      logger.info(
        { jobId, processedCount: processed.length },
        '[DependencyStep] Extended context images processed successfully'
      );

      return processed;
    } catch (error) {
      logger.error(
        { err: error, jobId },
        '[DependencyStep] Failed to process extended context images - continuing without them'
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
      '[DependencyStep] Preprocessing results ready'
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
