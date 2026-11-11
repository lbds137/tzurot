/**
 * Preprocessing Results Builder
 *
 * Rebuilds ProcessedAttachment entries from the raw audio/image results of
 * dependency jobs, routing reference-numbered results away from the trigger.
 */

import { AttachmentType } from '@tzurot/common-types/constants/media';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';
import type { PreprocessingResults } from '../types.js';
import { urlBasename } from './triggerAttachmentMerge.js';

/**
 * Audio info from transcription job
 */
export interface AudioInfo {
  url: string;
  name: string;
  content: string;
  sourceReferenceNumber?: number;
}

/**
 * Image info from description job
 */
export interface ImageInfo {
  url: string;
  description: string;
  sourceReferenceNumber?: number;
}

/**
 * Build preprocessing results from raw audio/image data
 */
export function buildPreprocessingResults(
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
        name: urlBasename(img.url),
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
    referenceAttachments,
  };
}
