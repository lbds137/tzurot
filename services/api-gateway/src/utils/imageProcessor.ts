/**
 * Image Processing Utilities
 *
 * Avatar optimization logic extracted from admin routes.
 * Handles resizing and quality reduction to meet Discord's avatar requirements.
 */

import sharp from 'sharp';
import { createLogger, AVATAR_LIMITS } from '@tzurot/common-types';

const logger = createLogger('image-processor');

/**
 * Avatar optimization configuration
 */
interface AvatarOptimizationOptions {
  /** Target width in pixels (default: 256) */
  targetWidth?: number;
  /** Target height in pixels (default: 256) */
  targetHeight?: number;
  /** Maximum file size in bytes (default: AVATAR_LIMITS.TARGET_SIZE_KB * 1024) */
  maxSizeBytes?: number;
  /** Initial quality setting (default: 90) */
  initialQuality?: number;
  /** Minimum quality setting (default: 50) */
  minQuality?: number;
  /** Quality reduction step (default: 10) */
  qualityStep?: number;
}

/**
 * Result of avatar optimization
 */
interface AvatarOptimizationResult {
  /** Processed image buffer */
  buffer: Buffer;
  /** Original size in KB */
  originalSizeKB: number;
  /** Processed size in KB */
  processedSizeKB: number;
  /** Final quality setting used */
  quality: number;
  /** Whether the final size exceeds the target */
  exceedsTarget: boolean;
}

/**
 * Default optimization options
 */
const DEFAULT_OPTIONS: Required<AvatarOptimizationOptions> = {
  targetWidth: 256,
  targetHeight: 256,
  maxSizeBytes: AVATAR_LIMITS.TARGET_SIZE_KB * 1024,
  initialQuality: 90,
  minQuality: 50,
  qualityStep: 10,
};

/**
 * Optimize avatar image to meet Discord's requirements
 *
 * Takes a base64-encoded image and:
 * 1. Validates base64 format
 * 2. Decodes it to a buffer
 * 3. Resizes to target dimensions (default 256x256)
 * 4. Converts to PNG
 * 5. Iteratively reduces quality if file size exceeds target
 *
 * @param base64Data - Base64-encoded image data
 * @param options - Optimization options
 * @returns Optimization result with processed buffer and metadata
 * @throws Error if base64 is invalid or image processing fails
 */
export async function optimizeAvatar(
  base64Data: string,
  options: AvatarOptimizationOptions = {}
): Promise<AvatarOptimizationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate configuration - check individual values first, then relationships
  if (opts.minQuality < 1 || opts.minQuality > 100) {
    throw new Error(
      `Invalid configuration: minQuality must be between 1 and 100, got ${opts.minQuality}`
    );
  }

  if (opts.initialQuality < 1 || opts.initialQuality > 100) {
    throw new Error(
      `Invalid configuration: initialQuality must be between 1 and 100, got ${opts.initialQuality}`
    );
  }

  if (opts.minQuality > opts.initialQuality) {
    throw new Error(
      `Invalid configuration: minQuality (${opts.minQuality}) cannot be greater than initialQuality (${opts.initialQuality})`
    );
  }

  if (opts.targetWidth <= 0 || opts.targetHeight <= 0) {
    throw new Error(
      `Invalid configuration: dimensions must be positive (width: ${opts.targetWidth}, height: ${opts.targetHeight})`
    );
  }

  if (opts.maxSizeBytes < 0) {
    throw new Error(
      `Invalid configuration: maxSizeBytes cannot be negative, got ${opts.maxSizeBytes}`
    );
  }

  if (opts.qualityStep <= 0) {
    throw new Error(`Invalid configuration: qualityStep must be positive, got ${opts.qualityStep}`);
  }

  // Validate base64 input
  if (!isValidBase64(base64Data)) {
    throw new Error('Invalid base64 image data provided');
  }

  try {
    // Decode base64 to buffer
    const originalBuffer = Buffer.from(base64Data, 'base64');
    const originalSizeKB = originalBuffer.length / 1024;

    logger.info(`[ImageProcessor] Original avatar size: ${originalSizeKB.toFixed(2)} KB`);

    // Start with initial quality
    let quality = opts.initialQuality;
    let processed = await sharp(originalBuffer)
      .resize(opts.targetWidth, opts.targetHeight, {
        fit: 'cover',
        position: 'center',
      })
      .png({ quality })
      .toBuffer();

    // Iteratively reduce quality if needed
    while (processed.length > opts.maxSizeBytes && quality > opts.minQuality) {
      quality -= opts.qualityStep;
      processed = await sharp(originalBuffer)
        .resize(opts.targetWidth, opts.targetHeight, {
          fit: 'cover',
          position: 'center',
        })
        .png({ quality })
        .toBuffer();
    }

    const processedSizeKB = processed.length / 1024;
    const exceedsTarget = processed.length > opts.maxSizeBytes;

    logger.info(
      `[ImageProcessor] Processed avatar size: ${processedSizeKB.toFixed(2)} KB (quality: ${quality})`
    );

    if (exceedsTarget) {
      logger.warn(
        {},
        `[ImageProcessor] Avatar still exceeds ${(opts.maxSizeBytes / 1024).toFixed(0)}KB after optimization: ${processedSizeKB.toFixed(2)} KB`
      );
    }

    return {
      buffer: processed,
      originalSizeKB: Number(originalSizeKB.toFixed(2)),
      processedSizeKB: Number(processedSizeKB.toFixed(2)),
      quality,
      exceedsTarget,
    };
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: error }, '[ImageProcessor] Failed to process avatar image');
    throw new Error(
      `Failed to process avatar image: ${originalMessage}. Ensure it is a valid image format.`,
      { cause: error }
    );
  }
}

/**
 * Validate that a string is valid base64
 *
 * @param str - String to validate
 * @returns true if valid base64, false otherwise
 */
export function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) {
    return false;
  }

  try {
    // Try to decode and re-encode to validate
    const decoded = Buffer.from(str, 'base64');
    const reencoded = decoded.toString('base64');

    // Remove padding for comparison (base64 can have optional padding)
    const strNoPadding = str.replace(/=/g, '');
    const reencodedNoPadding = reencoded.replace(/=/g, '');

    return strNoPadding === reencodedNoPadding;
  } catch {
    return false;
  }
}
