/**
 * Avatar Processing Utilities
 *
 * Shared utilities for resizing and validating avatar images.
 * Used by both avatar upload and character import commands.
 */

import sharp from 'sharp';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('avatar-utils');

// Avatar validation constants
export const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// Max input size - we'll resize anything larger than this
export const MAX_INPUT_SIZE_MB = 25;
export const MAX_INPUT_SIZE_BYTES = MAX_INPUT_SIZE_MB * 1024 * 1024;
// Target size for base64 payload (accounting for ~33% base64 overhead)
// API gateway has 10MB limit, so target 7MB raw → ~9.3MB base64
export const TARGET_SIZE_BYTES = 7 * 1024 * 1024;
// Resize dimensions - large enough for quality, small enough to fit
const RESIZE_WIDTH = 1024;
const RESIZE_HEIGHT = 1024;
// Quality levels to try progressively
const QUALITY_LEVELS = [85, 70, 55, 40];

/**
 * Result of avatar processing
 */
export interface AvatarProcessingResult {
  success: true;
  buffer: Buffer;
  wasResized: boolean;
  finalQuality?: number;
}

/**
 * Error result from avatar processing
 */
export interface AvatarProcessingError {
  success: false;
  error: 'too_large' | 'processing_failed';
  message: string;
}

export type ProcessAvatarResult = AvatarProcessingResult | AvatarProcessingError;

/**
 * Process an avatar image buffer, resizing if necessary to fit within target size.
 *
 * @param imageBuffer - The raw image buffer
 * @param context - Logging context (e.g., slug or filename)
 * @returns Processing result with the final buffer or error
 */
export async function processAvatarBuffer(
  imageBuffer: Buffer,
  context: string
): Promise<ProcessAvatarResult> {
  // If already under target size, return as-is
  if (imageBuffer.length <= TARGET_SIZE_BYTES) {
    return {
      success: true,
      buffer: imageBuffer,
      wasResized: false,
    };
  }

  logger.info({ originalSize: imageBuffer.length, context }, 'Resizing large avatar image');

  try {
    // Progressively reduce quality until image fits within target size
    let resized: Buffer | null = null;
    let finalQuality: number | undefined;

    for (const quality of QUALITY_LEVELS) {
      resized = await sharp(imageBuffer)
        .resize(RESIZE_WIDTH, RESIZE_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toBuffer();

      if (resized.length <= TARGET_SIZE_BYTES) {
        finalQuality = quality;
        logger.info(
          { newSize: resized.length, quality, context },
          'Avatar image resized successfully'
        );
        break;
      }

      logger.info(
        { size: resized.length, quality, context },
        'Resize still too large, trying lower quality'
      );
    }

    // Final check - if still too large after all quality levels, reject
    if (!resized || resized.length > TARGET_SIZE_BYTES) {
      logger.warn(
        { size: resized?.length, context },
        'Image still too large after all compression attempts'
      );
      return {
        success: false,
        error: 'too_large',
        message:
          'This image is too complex to resize automatically. Please use a simpler image or reduce its size manually.',
      };
    }

    return {
      success: true,
      buffer: Buffer.from(resized),
      wasResized: true,
      finalQuality,
    };
  } catch (error) {
    logger.error({ err: error, context }, 'Failed to resize avatar image');
    return {
      success: false,
      error: 'processing_failed',
      message:
        'Failed to process the image. Please try a different image format (PNG, JPG, or WebP).',
    };
  }
}
