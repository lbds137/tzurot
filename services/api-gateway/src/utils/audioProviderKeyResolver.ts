/**
 * Audio Provider Key Resolver
 *
 * Resolves and decrypts ALL stored audio-provider API keys (ElevenLabs +
 * Mistral) for a user, returning a map keyed by provider id. Used by routes
 * that need to fan out across providers — e.g., `/user/voices` listing
 * cloned voices across both BYOK accounts a user has configured.
 *
 * Mirrors the shape of `ResolvedAuth.audioProviderKeys` in ai-worker
 * (declared in `services/ai-worker/src/jobs/handlers/pipeline/types.ts`)
 * — same domain concept, just resolved at the gateway boundary instead of
 * inside the pipeline.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { decryptApiKey } from '@tzurot/common-types/utils/encryption';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ErrorResponse, ErrorResponses } from './errorResponses.js';

const logger = createLogger('AudioProviderKeyResolver');

/**
 * Audio providers we resolve keys for. Mirrors the dispatcher's
 * `BYOK_PROVIDERS` set in ai-worker. Order doesn't matter at this layer
 * — callers iterate the returned map.
 */
const AUDIO_PROVIDER_TO_AIPROVIDER: ReadonlyMap<AudioProviderId, AIProvider> = new Map([
  ['elevenlabs', AIProvider.ElevenLabs],
  ['mistral', AIProvider.Mistral],
]);

/**
 * Resolve every audio-provider API key the user has stored.
 *
 * Returns a `Map<AudioProviderId, string>` containing only providers with
 * a successfully-decrypted key. An empty map means the user has no audio
 * keys configured (caller decides whether that's a 404 or just an empty
 * voice list — depends on the endpoint).
 *
 * Decryption failures for individual providers are logged and skipped (the
 * working keys still get returned). A user-not-found returns an
 * ErrorResponse, distinct from "user exists but has no keys."
 */
export async function resolveAudioProviderKeys(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ keys: Map<AudioProviderId, string> } | { errorResponse: ErrorResponse }> {
  const aiProviders = Array.from(AUDIO_PROVIDER_TO_AIPROVIDER.values());

  const user = await prisma.user.findFirst({
    where: { discordId: discordUserId },
    select: {
      id: true,
      apiKeys: {
        where: { provider: { in: aiProviders } },
        select: { provider: true, iv: true, content: true, tag: true },
      },
    },
  });

  if (user === null) {
    return { errorResponse: ErrorResponses.notFound('User') };
  }

  const keys = new Map<AudioProviderId, string>();
  for (const [audioProviderId, aiProvider] of AUDIO_PROVIDER_TO_AIPROVIDER.entries()) {
    // Compare the Prisma-emitted provider string against the AIProvider enum
    // value's underlying string. Casting only the enum side; k.provider is
    // already typed as string by Prisma's generated client.
    const targetProvider = aiProvider as string;
    const storedKey = user.apiKeys.find(k => k.provider === targetProvider);
    if (storedKey === undefined) {
      continue;
    }
    try {
      const apiKey = decryptApiKey({
        iv: storedKey.iv,
        content: storedKey.content,
        tag: storedKey.tag,
      });
      keys.set(audioProviderId, apiKey);
    } catch (error) {
      logger.error(
        { err: error, discordUserId, provider: audioProviderId },
        'Failed to decrypt key — skipping this provider'
      );
    }
  }

  return { keys };
}
