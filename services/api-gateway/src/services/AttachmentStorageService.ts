/**
 * Attachment Storage Service
 *
 * Downloads Discord CDN attachments to local Railway volume storage
 * to avoid CDN expiration issues and unreliable external fetches.
 *
 * Attachments are stored at: /data/temp-attachments/{requestId}/{filename}
 * Served via: GET /temp-attachments/{requestId}/{filename}
 * Cleaned up after AI job completes.
 */

import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { createLogger, MEDIA_LIMITS, CONTENT_TYPES } from '@tzurot/common-types';
import type { AttachmentMetadata } from '@tzurot/common-types';

const logger = createLogger('AttachmentStorageService');

interface AttachmentStorageOptions {
  /** Base directory for temporary attachments (default: /data/temp-attachments) */
  storageBasePath?: string;
  /** Public gateway URL for serving attachments */
  gatewayUrl?: string;
}

/**
 * Service for managing temporary attachment storage
 */
export class AttachmentStorageService {
  private readonly storageBasePath: string;
  private readonly gatewayUrl: string;

  constructor(options: AttachmentStorageOptions = {}) {
    this.storageBasePath = options.storageBasePath ?? '/data/temp-attachments';
    this.gatewayUrl = options.gatewayUrl ?? '';
  }

  /**
   * Download Discord CDN attachments and store them locally
   * Automatically resizes images larger than 10MB
   * Returns updated attachment metadata with local URLs
   */
  async downloadAndStore(
    requestId: string,
    attachments: AttachmentMetadata[]
  ): Promise<AttachmentMetadata[]> {
    if (attachments.length === 0) {
      return [];
    }

    // Create request-specific directory
    const requestDir = join(this.storageBasePath, requestId);
    await mkdir(requestDir, { recursive: true });

    logger.info(
      { requestId, count: attachments.length },
      'Downloading attachments to local storage in parallel'
    );

    // Download all attachments in parallel
    const downloadPromises = attachments.map(async (attachment, index) => {
      // Validate URL is from Discord CDN to prevent SSRF attacks
      const url = new URL(attachment.url);

      // Protocol must be HTTPS
      if (url.protocol !== 'https:') {
        throw new Error('Invalid attachment URL: protocol must be https:');
      }

      // Port must be default (443) or empty
      if (url.port !== '' && url.port !== '443') {
        throw new Error('Invalid attachment URL: non-standard port not allowed');
      }

      // No username/password allowed
      if (url.username !== '' || url.password !== '') {
        throw new Error('Invalid attachment URL: credentials not allowed');
      }

      // Hostname must be from allowed Discord CDN hosts
      // Normalize: strip trailing dots and ensure lowercase (URL API already lowercases)
      const normalizedHostname = url.hostname.replace(/\.+$/, '');

      // Reject IP addresses (IPv4 and IPv6)
      const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Pattern = /^\[?[0-9a-f:]+\]?$/i;
      if (ipv4Pattern.test(normalizedHostname) || ipv6Pattern.test(normalizedHostname)) {
        throw new Error('Invalid attachment URL: IP addresses not allowed');
      }

      // Validate against allowed Discord CDN hosts
      const allowedHosts = ['cdn.discordapp.com', 'media.discordapp.net'];
      if (!allowedHosts.includes(normalizedHostname)) {
        throw new Error(
          `Invalid attachment URL: must be from Discord CDN (${allowedHosts.join(', ')})`
        );
      }

      // Construct sanitized URL from validated components to break taint flow
      // This ensures we're not using the original user-provided URL
      const sanitizedUrl = `https://${normalizedHostname}${url.pathname}${url.search}${url.hash}`;

      // Download from Discord CDN using sanitized URL
      const response = await fetch(sanitizedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get filename from original URL or use name with index to avoid collisions
      const filename = attachment.name ?? `attachment-${index}-${Date.now()}.bin`;
      const localPath = join(requestDir, filename);

      // Download and optionally resize if it's a large image
      const originalBuffer = Buffer.from(await response.arrayBuffer());
      const originalSize = originalBuffer.byteLength;

      const buffer = await this.resizeImageIfNeeded(originalBuffer, attachment.contentType);

      // Save to disk (resized if applicable)
      await writeFile(localPath, buffer);

      // Build our gateway URL
      const localUrl = `${this.gatewayUrl}/temp-attachments/${requestId}/${encodeURIComponent(filename)}`;

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
    // eslint-disable-next-line sonarjs/prefer-immediate-return -- pre-existing
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
  async cleanup(requestId: string): Promise<void> {
    const requestDir = join(this.storageBasePath, requestId);

    try {
      await rm(requestDir, { recursive: true, force: true });
      logger.info({ requestId }, 'Cleaned up temporary attachments');
    } catch (error) {
      logger.error({ err: error, requestId }, 'Failed to clean up temporary attachments');
    }
  }

  /**
   * Resize image if it exceeds the maximum size limit
   * Returns the resized buffer or original if no resize needed
   */
  private async resizeImageIfNeeded(buffer: Buffer, contentType: string): Promise<Buffer> {
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
}
