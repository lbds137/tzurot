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
// Maximum pixel count to prevent image bombs (100 megapixels)
const MAX_PIXEL_COUNT = 100_000_000;
// Valid sharp formats we support
const SUPPORTED_FORMATS = ['png', 'jpeg', 'gif', 'webp'] as const;
type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

/**
 * Result of avatar processing
 */
interface AvatarProcessingResult {
  success: true;
  buffer: Buffer;
  wasResized: boolean;
  finalQuality?: number;
}

/**
 * Error result from avatar processing
 */
interface AvatarProcessingError {
  success: false;
  error: 'too_large' | 'processing_failed' | 'invalid_format' | 'dimensions_too_large';
  message: string;
}

type ProcessAvatarResult = AvatarProcessingResult | AvatarProcessingError;

/**
 * Apply format-specific compression to a sharp pipeline.
 * Preserves PNG transparency, WebP quality, and GIF animations.
 */
function applyFormatCompression(
  pipeline: sharp.Sharp,
  format: SupportedFormat,
  quality: number
): sharp.Sharp {
  switch (format) {
    case 'png': {
      // Preserve PNG with transparency, use compression level based on quality
      // quality 85 → level 6, quality 40 → level 9
      const compressionLevel = Math.min(9, Math.floor((100 - quality) / 10) + 6);
      return pipeline.png({ compressionLevel });
    }
    case 'webp':
      return pipeline.webp({ quality });
    case 'gif':
      // Preserve GIF format to maintain animations
      // Note: sharp's gif() uses { colors } for palette size, not quality
      // Formula: 256 * (quality/100), so 85→217, 70→179, 55→140, 40→102
      return pipeline.gif({ colors: Math.max(32, Math.floor(256 * (quality / 100))) });
    case 'jpeg':
    default:
      return pipeline.jpeg({ quality });
  }
}

/**
 * Process an avatar image buffer, resizing if necessary to fit within target size.
 * Preserves format when possible (PNG transparency, WebP quality).
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
    // Validate image metadata before processing
    const metadata = await sharp(imageBuffer).metadata();

    // Check format is supported
    if (!metadata.format || !SUPPORTED_FORMATS.includes(metadata.format as SupportedFormat)) {
      logger.warn({ format: metadata.format, context }, 'Unsupported image format');
      return {
        success: false,
        error: 'invalid_format',
        message: 'Unsupported image format. Please use PNG, JPG, GIF, or WebP.',
      };
    }

    // Check dimensions to prevent image bombs
    if (metadata.width && metadata.height && metadata.width * metadata.height > MAX_PIXEL_COUNT) {
      logger.warn(
        { width: metadata.width, height: metadata.height, context },
        'Image dimensions too large'
      );
      return {
        success: false,
        error: 'dimensions_too_large',
        message: 'Image dimensions are too large. Please use an image smaller than 10000x10000.',
      };
    }

    const format = metadata.format as SupportedFormat;

    // Progressively reduce quality until image fits within target size
    let resized: Buffer | null = null;
    let finalQuality: number | undefined;

    for (const quality of QUALITY_LEVELS) {
      const pipeline = sharp(imageBuffer).resize(RESIZE_WIDTH, RESIZE_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      });

      resized = await applyFormatCompression(pipeline, format, quality).toBuffer();

      if (resized.length <= TARGET_SIZE_BYTES) {
        finalQuality = quality;
        logger.info(
          { newSize: resized.length, quality, format, context },
          'Avatar image resized successfully'
        );
        break;
      }

      logger.info(
        { size: resized.length, quality, format, context },
        'Resize still too large, trying lower quality'
      );
    }

    // Final check - if still too large after all quality levels, reject
    if (!resized || resized.length > TARGET_SIZE_BYTES) {
      logger.warn(
        { size: resized?.length, format, context },
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
      buffer: resized,
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
