/**
 * Image Processing Utilities
 *
 * Avatar optimization logic extracted from admin routes.
 * Handles resizing and quality reduction to meet Discord's avatar requirements.
 */

import sharp from 'sharp';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('image-processor');

/**
 * Avatar optimization configuration
 */
export interface AvatarOptimizationOptions {
  /** Target width in pixels (default: 256) */
  targetWidth?: number;
  /** Target height in pixels (default: 256) */
  targetHeight?: number;
  /** Maximum file size in bytes (default: 200KB) */
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
export interface AvatarOptimizationResult {
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
  maxSizeBytes: 200 * 1024, // 200KB
  initialQuality: 90,
  minQuality: 50,
  qualityStep: 10
};

/**
 * Optimize avatar image to meet Discord's requirements
 *
 * Takes a base64-encoded image and:
 * 1. Decodes it to a buffer
 * 2. Resizes to target dimensions (default 256x256)
 * 3. Converts to PNG
 * 4. Iteratively reduces quality if file size exceeds target
 *
 * @param base64Data - Base64-encoded image data
 * @param options - Optimization options
 * @returns Optimization result with processed buffer and metadata
 * @throws Error if image processing fails
 */
export async function optimizeAvatar(
  base64Data: string,
  options: AvatarOptimizationOptions = {}
): Promise<AvatarOptimizationResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Decode base64 to buffer
  const originalBuffer = Buffer.from(base64Data, 'base64');
  const originalSizeKB = originalBuffer.length / 1024;

  logger.info(`[ImageProcessor] Original avatar size: ${originalSizeKB.toFixed(2)} KB`);

  // Start with initial quality
  let quality = opts.initialQuality;
  let processed = await sharp(originalBuffer)
    .resize(opts.targetWidth, opts.targetHeight, {
      fit: 'cover',
      position: 'center'
    })
    .png({ quality })
    .toBuffer();

  // Iteratively reduce quality if needed
  while (processed.length > opts.maxSizeBytes && quality > opts.minQuality) {
    quality -= opts.qualityStep;
    processed = await sharp(originalBuffer)
      .resize(opts.targetWidth, opts.targetHeight, {
        fit: 'cover',
        position: 'center'
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
      `[ImageProcessor] Avatar still exceeds ${(opts.maxSizeBytes / 1024).toFixed(0)}KB after optimization: ${processedSizeKB.toFixed(2)} KB`
    );
  }

  return {
    buffer: processed,
    originalSizeKB: Number(originalSizeKB.toFixed(2)),
    processedSizeKB: Number(processedSizeKB.toFixed(2)),
    quality,
    exceedsTarget
  };
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
