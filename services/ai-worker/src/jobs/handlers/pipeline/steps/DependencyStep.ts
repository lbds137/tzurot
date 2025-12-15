/**
 * Dependency Step
 *
 * Fetches and processes preprocessing results from dependency jobs
 * (audio transcriptions, image descriptions) from Redis.
 */

import {
  createLogger,
  REDIS_KEY_PREFIXES,
  AttachmentType,
  JobType,
  type AudioTranscriptionResult,
  type ImageDescriptionResult,
} from '@tzurot/common-types';
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
    const { job } = context;
    const { dependencies } = job.data;

    if (!dependencies || dependencies.length === 0) {
      return {
        ...context,
        preprocessing: { processedAttachments: [], transcriptions: [], referenceAttachments: {} },
      };
    }

    logger.info(
      { jobId: job.id, dependencyCount: dependencies.length },
      '[DependencyStep] Fetching preprocessing results from dependency jobs'
    );

    const { redisService } = await import('../../../../redis.js');
    const { audioTranscriptions, imageDescriptions } = await this.fetchDependencyResults(
      dependencies,
      redisService
    );

    const preprocessing = this.buildPreprocessingResults(audioTranscriptions, imageDescriptions);
    this.logPreprocessingResults(job.id, preprocessing);

    return { ...context, preprocessing };
  }

  private async fetchDependencyResults(
    dependencies: Array<{ jobId: string; type: string; resultKey?: string }>,
    redisService: { getJobResult: <T>(key: string) => Promise<T | null> }
  ): Promise<{ audioTranscriptions: AudioInfo[]; imageDescriptions: ImageInfo[] }> {
    const audioTranscriptions: AudioInfo[] = [];
    const imageDescriptions: ImageInfo[] = [];

    for (const dep of dependencies) {
      try {
        const key = dep.resultKey?.substring(REDIS_KEY_PREFIXES.JOB_RESULT.length) ?? dep.jobId;
        if (dep.type === JobType.AudioTranscription) {
          const audio = await this.fetchAudioResult(dep.jobId, key, redisService);
          if (audio) audioTranscriptions.push(audio);
        } else if (dep.type === JobType.ImageDescription) {
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
      logger.debug({ jobId, key, sourceRef: result.sourceReferenceNumber }, '[DependencyStep] Retrieved audio transcription');
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
    if (result?.success === true && result.descriptions !== undefined && result.descriptions.length > 0) {
      logger.debug({ jobId, key, count: result.descriptions.length, sourceRef: result.sourceReferenceNumber }, '[DependencyStep] Retrieved image descriptions');
      return result.descriptions.map(d => ({ ...d, sourceReferenceNumber: result.sourceReferenceNumber }));
    }
    logger.warn({ jobId, key }, '[DependencyStep] Image description job failed or has no result');
    return [];
  }

  private logPreprocessingResults(jobId: string | undefined, preprocessing: PreprocessingResults): void {
    const refCount = Object.keys(preprocessing.referenceAttachments).length;
    const refAttachmentCount = Object.values(preprocessing.referenceAttachments).reduce((sum, arr) => sum + arr.length, 0);
    logger.info(
      {
        jobId,
        directAttachmentCount: preprocessing.processedAttachments.length,
        referencedMessageCount: refCount,
        referencedAttachmentCount: refAttachmentCount,
        totalPreprocessed: preprocessing.processedAttachments.length + refAttachmentCount,
      },
      '[DependencyStep] Fetched preprocessing results from dependency jobs'
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
