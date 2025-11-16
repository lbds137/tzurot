/**
 * Temporary Attachment Storage
 *
 * Downloads Discord CDN attachments to local Railway volume storage
 * to avoid CDN expiration issues and unreliable external fetches.
 *
 * Attachments are stored at: /data/temp-attachments/{requestId}/{filename}
 * Served via: GET /temp-attachments/{requestId}/{filename}
 * Cleaned up after AI job completes.
 */

import { mkdir, writeFile, rm } from 'fs/promises';
import { createLogger, getConfig, MEDIA_LIMITS, CONTENT_TYPES } from '@tzurot/common-types';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { join } from 'path';
import sharp from 'sharp';

const logger = createLogger('TempAttachmentStorage');
const config = getConfig();

const TEMP_STORAGE_BASE = '/data/temp-attachments';

/**
 * Resize image if it exceeds the maximum size limit
 * Returns the resized buffer or original if no resize needed
 */
async function resizeImageIfNeeded(buffer: Buffer, contentType: string): Promise<Buffer> {
  const originalSize = buffer.byteLength;

  // Only resize images
  if (!contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    return buffer;
  }

  // Check if resize is needed
  if (originalSize <= MEDIA_LIMITS.MAX_IMAGE_SIZE) {
    logger.info({ originalSize }, 'Image within size limit, no resize needed');
    return buffer;
  }

  logger.info(
    {
      originalSize,
      maxSize: MEDIA_LIMITS.MAX_IMAGE_SIZE,
      sizeMB: (originalSize / 1024 / 1024).toFixed(2),
    },
    'Image exceeds size limit, resizing...'
  );

  // Resize image while maintaining aspect ratio
  // Target size leaves headroom for potential base64 encoding later
  const scaleFactor = Math.sqrt(MEDIA_LIMITS.IMAGE_TARGET_SIZE / originalSize);

  const metadata = await sharp(buffer).metadata();
  const newWidth = Math.floor((metadata.width || 2048) * scaleFactor);

  const resized = await sharp(buffer)
    .resize(newWidth, null, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: MEDIA_LIMITS.IMAGE_QUALITY })
    .toBuffer();

  logger.info(
    {
      originalSize,
      resizedSize: resized.byteLength,
      reduction: ((1 - resized.byteLength / originalSize) * 100).toFixed(1) + '%',
      newWidth,
    },
    'Image resized successfully'
  );

  return resized;
}

/**
 * Download Discord CDN attachments and store them locally
 * Automatically resizes images larger than 10MB
 * Returns updated attachment metadata with local URLs
 */
export async function downloadAndStoreAttachments(
  requestId: string,
  attachments: AttachmentMetadata[]
): Promise<AttachmentMetadata[]> {
  if (attachments.length === 0) {
    return [];
  }

  // Create request-specific directory
  const requestDir = join(TEMP_STORAGE_BASE, requestId);
  await mkdir(requestDir, { recursive: true });

  logger.info(
    { requestId, count: attachments.length },
    'Downloading attachments to local storage in parallel'
  );

  // Download all attachments in parallel
  const downloadPromises = attachments.map(async (attachment, index) => {
    // Download from Discord CDN
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get filename from original URL or use name with index to avoid collisions
    const filename = attachment.name ?? `attachment-${index}-${Date.now()}.bin`;
    const localPath = join(requestDir, filename);

    // Download and optionally resize if it's a large image
    const originalBuffer = Buffer.from(await response.arrayBuffer());
    const originalSize = originalBuffer.byteLength;

    const buffer = await resizeImageIfNeeded(originalBuffer, attachment.contentType);

    // Save to disk (resized if applicable)
    await writeFile(localPath, buffer);

    // Build our gateway URL
    const gatewayUrl = config.PUBLIC_GATEWAY_URL ?? config.GATEWAY_URL;
    const localUrl = `${gatewayUrl}/temp-attachments/${requestId}/${encodeURIComponent(filename)}`;

    logger.info(
      { originalUrl: attachment.url, localUrl, originalSize, finalSize: buffer.byteLength },
      'Downloaded and stored attachment'
    );

    // Return updated attachment with local URL and final size
    // Preserve original URL for transcript caching
    return {
      ...attachment,
      originalUrl: attachment.url, // Discord CDN URL (for caching lookups)
      url: localUrl, // Local Railway URL (for fetching)
      size: buffer.byteLength,
    };
  });

  // Wait for all downloads to complete (even if some fail)
  const results = await Promise.allSettled(downloadPromises);

  // Extract results (use original URL as fallback for failures)
  const updatedAttachments = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      logger.error(
        { err: result.reason, url: attachments[index].url },
        'Failed to download attachment, using original URL'
      );
      // Keep original URL as fallback
      return attachments[index];
    }
  });

  return updatedAttachments;
}

/**
 * Clean up temporary attachments for a request
 */
export async function cleanupAttachments(requestId: string): Promise<void> {
  const requestDir = join(TEMP_STORAGE_BASE, requestId);

  try {
    await rm(requestDir, { recursive: true, force: true });
    logger.info({ requestId }, 'Cleaned up temporary attachments');
  } catch (error) {
    logger.error({ err: error, requestId }, 'Failed to clean up temporary attachments');
  }
}
