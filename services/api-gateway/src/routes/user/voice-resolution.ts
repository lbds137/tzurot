/**
 * User Voice Resolution Route
 *
 * Aggregate read endpoint backing the `/voice view` dashboard. Returns the
 * resolved TTS provider, resolved STT provider (with cascade source), and
 * a cloned-voice summary in a single round-trip.
 *
 *   GET /user/voice-resolution?personalityId=X
 *
 * Resolution shape mirrors the live resolvers (TtsConfigResolver +
 * SttResolver), but the cascade is computed inline here rather than going
 * through the cached resolver instances. Reasoning:
 *   - This is a low-traffic dashboard read; no need for a TTLCache layer.
 *   - The api-gateway doesn't need to manage resolver lifecycle / Redis
 *     subscription just to power one read endpoint.
 *   - The "what does the resolver currently see" semantic is preserved
 *     because both code paths read the same DB columns.
 *
 * If the inline cascade ever drifts from SttResolver semantics, the
 * tests in `SttResolver.test.ts` + this route's tests both hit the same
 * fixtures, so the mismatch shows up in CI.
 */

import { Router, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  isSttProvider,
  isByokAudioProvider,
  type PrismaClient,
  type SttProvider,
  type GetVoiceResolutionResponse,
  type ResolvedTtsView,
  type ResolvedSttView,
  type ClonedVoicesSummary,
  type SttResolutionSource,
  TtsConfigResolver,
  type LoadedTtsPersonality,
  GetVoiceResolutionQuerySchema,
} from '@tzurot/common-types';
import { requireUserAuth, requireProvisionedUser } from '../../services/AuthMiddleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { resolveAudioProviderKeys } from '../../utils/audioProviderKeyResolver.js';
import { fetchAllTzurotVoices } from './voices.js';
import type { ProvisionedRequest } from '../../types.js';

const logger = createLogger('user-voice-resolution');

/** Cap inline preview slugs at this many to keep the dashboard embed compact. */
const MAX_PREVIEW_SLUGS = 5;

interface SttCascadeRow {
  defaultProvider: string | null;
  defaultSttProviderId: string | null;
  perPersonalitySttProviderId: string | null;
}

/**
 * Inline 5-layer STT cascade — mirrors {@link SttResolver.resolveProvider}
 * but reads directly from a pre-fetched row to avoid extra Prisma round-trips
 * when we already have the user context for the TTS query.
 */
function computeSttResolution(
  row: SttCascadeRow,
  ttsProvider: string
): { provider: SttProvider; source: SttResolutionSource } {
  // Layer 1
  if (row.perPersonalitySttProviderId !== null && isSttProvider(row.perPersonalitySttProviderId)) {
    return { provider: row.perPersonalitySttProviderId, source: 'user-personality' };
  }
  // Layer 2
  if (row.defaultSttProviderId !== null && isSttProvider(row.defaultSttProviderId)) {
    return { provider: row.defaultSttProviderId, source: 'user-default' };
  }
  // Layer 3 — BYOK audio providers derive (self-hosted TTS uses Pocket TTS,
  // a different engine than the voice-engine STT backend).
  if (isByokAudioProvider(ttsProvider)) {
    return { provider: ttsProvider, source: 'tts-derived' };
  }
  // Layer 4
  if (row.defaultProvider !== null && isSttProvider(row.defaultProvider)) {
    return { provider: row.defaultProvider, source: 'admin-default' };
  }
  // Layer 5
  return { provider: 'voice-engine', source: 'hardcoded' };
}

export function createVoiceResolutionRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // Single TtsConfigResolver instance per gateway process. Caches per-user
  // resolutions for ~5 min — acceptable staleness for a dashboard read.
  // Mutating endpoints (PUT/DELETE on tts-override and stt-override) publish
  // invalidation events; the gateway doesn't subscribe to them here, so
  // cache lifetime is the TTL.
  const ttsResolver = new TtsConfigResolver(prisma);

  router.get(
    '/',
    requireUserAuth(),
    requireProvisionedUser(prisma),
    asyncHandler(async (req: ProvisionedRequest, res: Response) => {
      const discordUserId = req.userId;
      const userId = resolveProvisionedUserId(req);

      const parseResult = GetVoiceResolutionQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return sendZodError(res, parseResult.error);
      }
      const { personalityId } = parseResult.data;

      // Fetch the personality + the user's STT cascade fields in one shot.
      const [personality, userRow] = await Promise.all([
        prisma.personality.findFirst({
          where: { id: personalityId },
          select: { id: true, name: true },
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            defaultProvider: true,
            defaultSttProviderId: true,
            personalityConfigs: {
              where: { personalityId },
              select: { sttProviderId: true },
              take: 1,
            },
          },
        }),
      ]);
      if (personality === null) {
        return sendError(res, ErrorResponses.notFound('Personality'));
      }
      if (userRow === null) {
        return sendError(res, ErrorResponses.notFound('User'));
      }

      // TTS resolution — defer to the cached resolver. LoadedTtsPersonality
      // only carries `id`; the resolver re-queries PersonalityDefaultTtsConfig
      // itself, so a partial personality projection is sufficient.
      const personalityForResolver: LoadedTtsPersonality = { id: personality.id };
      const ttsResolution = await ttsResolver.resolveConfig(
        discordUserId,
        personalityId,
        personalityForResolver
      );

      const ttsView: ResolvedTtsView = {
        // resolver surfaces configName but not configId at the top level
        configId: null,
        configName: ttsResolution.configName ?? null,
        provider: ttsResolution.config.provider,
        source: ttsResolution.source,
      };

      // STT resolution — inline cascade.
      const sttResult = computeSttResolution(
        {
          defaultProvider: userRow.defaultProvider,
          defaultSttProviderId: userRow.defaultSttProviderId,
          perPersonalitySttProviderId: userRow.personalityConfigs[0]?.sttProviderId ?? null,
        },
        ttsView.provider
      );
      const sttView: ResolvedSttView = sttResult;

      // Cloned-voice summary — only if the user has at least one BYOK key.
      // No keys → summary is "0 voices" (avoids surfacing a 404).
      let voicesSummary: ClonedVoicesSummary = {
        tzurotCount: 0,
        totalVoices: 0,
        previewSlugs: [],
      };
      const keysResult = await resolveAudioProviderKeys(prisma, discordUserId);
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
        tts: ttsView,
        stt: sttView,
        voices: voicesSummary,
      };

      logger.info(
        {
          discordUserId,
          personalityId,
          ttsProvider: ttsView.provider,
          ttsSource: ttsView.source,
          sttProvider: sttView.provider,
          sttSource: sttView.source,
          tzurotCount: voicesSummary.tzurotCount,
        },
        'Resolved voice context for /voice view'
      );

      sendCustomSuccess(res, response, StatusCodes.OK);
    })
  );

  return router;
}
