/**
 * Shared Avatar Processing Utility
 *
 * Extracted from personality create/update routes to eliminate duplication.
 * Handles base64 avatar decoding, optimization via sharp, and error wrapping.
 */

import { AVATAR_LIMITS } from '@tzurot/common-types/constants/media';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { optimizeAvatar } from './imageProcessor.js';
import { ErrorResponses, type ErrorResponse } from './errorResponses.js';

const logger = createLogger('avatarProcessor');

/** Successful processing result */
export interface AvatarSuccess {
  ok: true;
  buffer: Buffer;
}

/** Processing failure result */
export interface AvatarError {
  ok: false;
  error: ErrorResponse;
}

/**
 * Process and optimize avatar data.
 *
 * @returns `null` if no avatar data provided, `{ ok: true, buffer }` on success,
 *          or `{ ok: false, error }` on processing failure.
 */
export async function processAvatarData(
  avatarData: string | null | undefined,
  slug: string
): Promise<AvatarSuccess | AvatarError | null> {
  // null = no avatar (the dashboard round-trips null for a no-avatar character);
  // treat it like undefined/empty — no processing, no change to the stored avatar.
  if (avatarData === undefined || avatarData === null || avatarData.length === 0) {
    return null;
  }

  try {
    const result = await optimizeAvatar(avatarData);

    logger.info(
      {
        slug,
        originalSizeKB: result.originalSizeKB,
        processedSizeKB: result.processedSizeKB,
        quality: result.quality,
      },
      'Avatar optimized'
    );

    if (result.exceedsTarget) {
      logger.warn(
        {
          slug,
          processedSizeKB: result.processedSizeKB,
          targetSizeKB: AVATAR_LIMITS.TARGET_SIZE_KB,
        },
        'Avatar still exceeds target size after optimization'
      );
    }

    return { ok: true, buffer: result.buffer };
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to process avatar');
    return {
      ok: false,
      error: ErrorResponses.processingError(
        'Failed to process avatar image. Ensure it is a valid image file.'
      ),
    };
  }
}
