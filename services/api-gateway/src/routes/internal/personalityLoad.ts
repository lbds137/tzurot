/**
 * GET /internal/personality/load
 *
 * Routing read: resolves a personality by name/slug/alias/UUID with the same
 * access-control semantics as PersonalityService.loadPersonality (public OR
 * owned-by-userId when userId is provided). Serves bot-client's pre-job
 * routing paths — mention parsing, reply resolution, channel activation —
 * which need personality identity BEFORE any job exists and therefore can't
 * relocate into ai-worker's job-side hydration.
 *
 * Not-found returns `{ personality: null }` with 200, not a 404: mention
 * parsing probes many candidate names per message and most are not
 * personalities — a miss is the common case, not an error. bot-client's
 * caches (PersonalityIdCache + TTL cache) sit in front of this endpoint, so
 * only cache misses pay the HTTP hop.
 *
 * **Authentication**: `X-Service-Auth` enforcement happens upstream via the
 * global `requireServiceAuth()` on `/internal/*` in api-gateway's index.
 */

import { type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import { type LoadPersonalityInternalResponse } from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { PersonalityService } from '@tzurot/identity';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-personality-load');

const QuerySchema = z.object({
  // Names, slugs, aliases, or UUIDs — cap mirrors the DB varchar(255) columns.
  nameOrId: z.string().min(1).max(255),
  // Discord user ID for access control; omitted = internal operation (no gate).
  userId: z.string().max(32).optional(),
});

/** GET /api/internal/personality/load — routing-read personality resolution. */
export const handleLoadPersonalityInternal = (deps: RouteDeps): RequestHandler => {
  const personalityService = new PersonalityService(deps.prisma);

  return asyncHandler(async (req, res: Response) => {
    const parseResult = QuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      sendZodError(res, parseResult.error);
      return;
    }
    const { nameOrId, userId } = parseResult.data;

    const personality = await personalityService.loadPersonality(nameOrId, userId);

    // nameOrId is a personality name/slug, not user PII — logged so analysis
    // can correlate miss patterns for the loader's negative-caching tier.
    logger.debug(
      { nameOrId, found: personality !== null, hasUserId: userId !== undefined },
      'Personality load'
    );
    sendCustomSuccess(res, { personality } satisfies LoadPersonalityInternalResponse);
  });
};
