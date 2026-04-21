/**
 * ElevenLabs API Key Resolver
 *
 * Resolves and decrypts a user's stored ElevenLabs API key from the database.
 * Extracted from voice routes for reuse by any route that needs the user's
 * ElevenLabs key (voice management, future TTS endpoints, etc.).
 */

import { createLogger, decryptApiKey, AIProvider, type PrismaClient } from '@tzurot/common-types';
import type { ErrorResponse } from './errorResponses.js';
import { ErrorResponses } from './errorResponses.js';

const logger = createLogger('ElevenLabsKeyResolver');

/**
 * Resolve and decrypt the user's ElevenLabs API key.
 *
 * Looks up the user by Discord ID, finds their ElevenLabs key, and decrypts it.
 * Returns the decrypted key or an ErrorResponse for the caller to send.
 */
export async function resolveElevenLabsKey(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ apiKey: string } | { errorResponse: ErrorResponse }> {
  const user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: {
      id: true,
      apiKeys: {
        where: { provider: AIProvider.ElevenLabs },
        select: { iv: true, content: true, tag: true },
        take: 1,
      },
    },
  });

  if (user === null) {
    return { errorResponse: ErrorResponses.notFound('User') };
  }

  const storedKey = user.apiKeys[0];
  if (storedKey === undefined) {
    return {
      errorResponse: ErrorResponses.notFound(
        'ElevenLabs API key. Set one with /settings apikey set'
      ),
    };
  }

  try {
    const apiKey = decryptApiKey({
      iv: storedKey.iv,
      content: storedKey.content,
      tag: storedKey.tag,
    });
    return { apiKey };
  } catch (error) {
    logger.error({ err: error, discordUserId }, 'Failed to decrypt key');
    return { errorResponse: ErrorResponses.internalError('Failed to decrypt stored API key') };
  }
}
