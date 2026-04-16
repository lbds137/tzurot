/**
 * Avatar Processing Utility
 *
 * Handles validation, download, and conversion of Discord avatar attachments
 * Used by personality create and edit commands
 */

import type { Attachment } from 'discord.js';
import { CONTENT_TYPES, DISCORD_LIMITS, createLogger } from '@tzurot/common-types';

const logger = createLogger('avatar-processor');

/**
 * Custom error for avatar processing failures
 */
export class AvatarProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AvatarProcessingError';
  }
}

/**
 * Process a Discord attachment as an avatar
 *
 * Validates file type and size, downloads the image, and converts to base64.
 * Throws AvatarProcessingError on validation or download failures.
 *
 * @param attachment - Discord attachment from command interaction
 * @param context - Optional context string for logging (e.g., "Personality Create")
 * @returns Base64-encoded image data
 * @throws {AvatarProcessingError} On validation or download failures
 */
export async function processAvatarAttachment(
  attachment: Attachment,
  context = 'Avatar Processing'
): Promise<string> {
  // Validate file type
  if ((attachment.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX) ?? false) === false) {
    throw new AvatarProcessingError(
      '❌ Avatar must be an image file (PNG, JPEG, etc.)',
      'INVALID_FILE_TYPE'
    );
  }

  // Validate file size (10MB limit from Discord)
  if (attachment.size > DISCORD_LIMITS.AVATAR_SIZE) {
    throw new AvatarProcessingError('❌ Avatar file is too large (max 10MB)', 'FILE_TOO_LARGE');
  }

  // Download and convert to base64, with 30s timeout to avoid a stalled
  // Discord CDN holding the deferred interaction until Discord's 15-min cap.
  // Pattern matches commands/character/voice.ts:109-117.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let response: Response;
    try {
      response = await fetch(attachment.url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // For now, store original - resize will be handled by API gateway
    const avatarBase64 = buffer.toString('base64');

    logger.info(
      `[${context}] Downloaded avatar: ${attachment.name} (${(buffer.length / 1024).toFixed(2)} KB)`
    );

    return avatarBase64;
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    logger.error({ err: error, isTimeout }, 'Failed to download avatar');
    if (isTimeout) {
      throw new AvatarProcessingError(
        '❌ Avatar download timed out. Discord may be slow — please try again.',
        'DOWNLOAD_TIMEOUT'
      );
    }
    throw new AvatarProcessingError('❌ Failed to download avatar image', 'DOWNLOAD_FAILED');
  }
}
