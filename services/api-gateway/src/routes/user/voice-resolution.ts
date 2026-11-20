/**
 * User Voice Resolution Route
 *
 * Aggregate read endpoint backing the `/voice view` dashboard. Returns the
 * resolved TTS provider for a personality, the resolved STT provider for
 * the user, a cloned-voice summary, the character's voice-enabled flag, and
 * the resolved Voice Response Mode in a single round-trip.
 *
 *   GET /api/user/voice-resolution?personalityId=X[&channelId=Y]
 *
 * STT resolution uses {@link SttResolver} directly — speaker-bound cascade
 * (override → tts-derived → voice-engine), no per-personality dimension.
 * TTS resolution still goes through {@link TtsConfigResolver} since TTS
 * does vary per personality.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  type GetVoiceResolutionResponse,
  type ResolvedTtsView,
  type ResolvedSttView,
  type ClonedVoicesSummary,
} from '@tzurot/common-types/schemas/api/voice-resolution';
import { type LoadedTtsPersonality } from '@tzurot/common-types/types/configResolution';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TtsConfigResolver, SttResolver } from '@tzurot/config-resolver';
import { userRoutes } from '@tzurot/clients';
import { withManifestInput } from '../../utils/manifestInput.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { resolveAudioProviderKeys } from '../../utils/audioProviderKeyResolver.js';
import { fetchAllTzurotVoices } from './voices.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-voice-resolution');

/** Cap inline preview slugs at this many to keep the dashboard embed compact. */
const MAX_PREVIEW_SLUGS = 5;

/**
 * GET /api/user/voice-resolution?personalityId=X — aggregate TTS+STT+voices summary
 *
 * Per-process resolver instances. Cache lifetime ~5 min; mutating endpoints
 * publish invalidation events but the gateway doesn't subscribe to them
 * here, so cache lifetime is the TTL.
 */
export const handleGetVoiceResolution = (deps: RouteDeps): RequestHandler => {
  const { prisma, cascadeResolver } = deps;
  const ttsResolver = new TtsConfigResolver(prisma);
  const sttResolver = new SttResolver(prisma);
  return withManifestInput(
    userRoutes.getVoiceResolution,
    async (req: ProvisionedRequest, res: Response, { query }) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const { personalityId, channelId } = query;

      // Independent existence checks — issue them in parallel.
      const [personality, userExists] = await Promise.all([
        prisma.personality.findFirst({
          where: { id: personalityId },
          select: { id: true, name: true, voiceEnabled: true },
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        }),
      ]);
      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality'));
      }
      if (userExists === null) {
        return sendError(res, ErrorResponses.notFound('User'));
      }

      const personalityForResolver: LoadedTtsPersonality = { id: personality.id };

      // Independent reads — issue them in parallel.
      const [resolved, ttsResolution, sttResult, keysResult] = await Promise.all([
        // Voice Response Mode resolves through the same cascade resolver the
        // config-overrides resolve handler uses; channelId, when present,
        // narrows the resolution to the invoking channel's tier.
        cascadeResolver.resolveOverrides(discordUserId, personalityId, channelId),
        // TTS resolution — defer to the cached resolver.
        ttsResolver.resolveConfig(discordUserId, personalityId, personalityForResolver),
        // STT resolution — user-scoped (no personalityId argument).
        sttResolver.resolveProvider(discordUserId),
        // Cloned-voice summary — only if the user has at least one BYOK key.
        // No keys → summary is "0 voices" (avoids surfacing a 404).
        resolveAudioProviderKeys(prisma, discordUserId),
      ]);
      const voiceResponseMode = {
        value: resolved.voiceResponseMode,
        source: resolved.sources.voiceResponseMode,
      };

      const ttsView: ResolvedTtsView = {
        // resolver surfaces configName but not configId at the top level
        configId: null,
        configName: ttsResolution.configName ?? null,
        provider: ttsResolution.config.provider,
        source: ttsResolution.source,
      };

      const sttView: ResolvedSttView = sttResult;

      let voicesSummary: ClonedVoicesSummary = {
        tzurotCount: 0,
        totalVoices: 0,
        previewSlugs: [],
      };
      if ('keys' in keysResult && keysResult.keys.size > 0) {
        const { voices, totalVoicesByProvider } = await fetchAllTzurotVoices(keysResult.keys);
        const totalVoices = Array.from(totalVoicesByProvider.values()).reduce((a, b) => a + b, 0);
        voicesSummary = {
          tzurotCount: voices.length,
          totalVoices,
          previewSlugs: voices.slice(0, MAX_PREVIEW_SLUGS).map(v => v.slug),
        };
      }

      const response: GetVoiceResolutionResponse = {
        personalityName: personality.name,
        voiceEnabled: personality.voiceEnabled,
        voiceResponseMode,
        tts: ttsView,
        stt: sttView,
        voices: voicesSummary,
      };

      logger.info(
        {
          discordUserId,
          personalityId,
          voiceEnabled: personality.voiceEnabled,
          voiceResponseMode: voiceResponseMode.value,
          voiceResponseModeSource: voiceResponseMode.source,
          ttsProvider: ttsView.provider,
          ttsSource: ttsView.source,
          sttProvider: sttView.provider,
          sttSource: sttView.source,
          tzurotCount: voicesSummary.tzurotCount,
        },
        'Resolved voice context for /voice view'
      );

      sendCustomSuccess(res, response, StatusCodes.OK);
    }
  );
};
