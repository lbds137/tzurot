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
import { createLogger, getConfig } from '@tzurot/common-types';
import type { AttachmentMetadata } from '@tzurot/common-types';
import { join } from 'path';

const logger = createLogger('TempAttachmentStorage');
const config = getConfig();

const TEMP_STORAGE_BASE = '/data/temp-attachments';

/**
 * Download Discord CDN attachments and store them locally
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
    const filename = attachment.name || `attachment-${index}-${Date.now()}.bin`;
    const localPath = join(requestDir, filename);

    // Save to disk
    const buffer = await response.arrayBuffer();
    await writeFile(localPath, Buffer.from(buffer));

    // Build our gateway URL
    const gatewayUrl = config.PUBLIC_GATEWAY_URL || config.GATEWAY_URL;
    const localUrl = `${gatewayUrl}/temp-attachments/${requestId}/${encodeURIComponent(filename)}`;

    logger.info(
      { originalUrl: attachment.url, localUrl, size: buffer.byteLength },
      'Downloaded attachment'
    );

    // Return updated attachment with local URL
    return {
      ...attachment,
      url: localUrl,
      size: buffer.byteLength
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
    logger.error(
      { err: error, requestId },
      'Failed to clean up temporary attachments'
    );
  }
}
