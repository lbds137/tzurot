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

    // If no dependencies, return empty preprocessing results
    if (!dependencies || dependencies.length === 0) {
      return {
        ...context,
        preprocessing: {
          processedAttachments: [],
          transcriptions: [],
          referenceAttachments: {},
        },
      };
    }

    logger.info(
      {
        jobId: job.id,
        dependencyCount: dependencies.length,
      },
      '[DependencyStep] Fetching preprocessing results from dependency jobs'
    );

    // Fetch Redis service (dynamic import to avoid circular deps)
    const { redisService } = await import('../../../../redis.js');

    // Collect results
    const audioTranscriptions: AudioInfo[] = [];
    const imageDescriptions: ImageInfo[] = [];

    for (const dep of dependencies) {
      try {
        // Extract key from resultKey (strip prefix)
        const key = dep.resultKey?.substring(REDIS_KEY_PREFIXES.JOB_RESULT.length) ?? dep.jobId;

        if (dep.type === JobType.AudioTranscription) {
          const result = await redisService.getJobResult<AudioTranscriptionResult>(key);
          if (
            result?.success === true &&
            result.content !== undefined &&
            result.content.length > 0
          ) {
            audioTranscriptions.push({
              url: result.attachmentUrl ?? '',
              name: result.attachmentName ?? 'audio',
              content: result.content,
              sourceReferenceNumber: result.sourceReferenceNumber,
            });
            logger.debug(
              { jobId: dep.jobId, key, sourceRef: result.sourceReferenceNumber },
              '[DependencyStep] Retrieved audio transcription'
            );
          } else {
            logger.warn(
              { jobId: dep.jobId, key },
              '[DependencyStep] Audio transcription job failed or has no result'
            );
          }
        } else if (dep.type === JobType.ImageDescription) {
          const result = await redisService.getJobResult<ImageDescriptionResult>(key);
          if (
            result?.success === true &&
            result.descriptions !== undefined &&
            result.descriptions.length > 0
          ) {
            const descriptionsWithSource = result.descriptions.map(d => ({
              ...d,
              sourceReferenceNumber: result.sourceReferenceNumber,
            }));
            imageDescriptions.push(...descriptionsWithSource);
            logger.debug(
              {
                jobId: dep.jobId,
                key,
                count: result.descriptions.length,
                sourceRef: result.sourceReferenceNumber,
              },
              '[DependencyStep] Retrieved image descriptions'
            );
          } else {
            logger.warn(
              { jobId: dep.jobId, key },
              '[DependencyStep] Image description job failed or has no result'
            );
          }
        }
      } catch (error) {
        logger.error(
          { err: error, jobId: dep.jobId, type: dep.type },
          '[DependencyStep] Failed to fetch dependency result - continuing without it'
        );
      }
    }

    // Convert to ProcessedAttachment format, separating direct vs. referenced
    const preprocessing = this.buildPreprocessingResults(audioTranscriptions, imageDescriptions);

    const refCount = Object.keys(preprocessing.referenceAttachments).length;
    const refAttachmentCount = Object.values(preprocessing.referenceAttachments).reduce(
      (sum, arr) => sum + arr.length,
      0
    );

    logger.info(
      {
        jobId: job.id,
        directAttachmentCount: preprocessing.processedAttachments.length,
        referencedMessageCount: refCount,
        referencedAttachmentCount: refAttachmentCount,
        totalPreprocessed: preprocessing.processedAttachments.length + refAttachmentCount,
      },
      '[DependencyStep] Fetched preprocessing results from dependency jobs'
    );

    return {
      ...context,
      preprocessing,
    };
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
