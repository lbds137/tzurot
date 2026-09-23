/**
 * GET /api/internal/models
 *
 * The OpenRouter model catalog (cached in OpenRouterModelCache), powering the
 * bot-client `/models` command. Service-auth protected (global middleware in
 * api-gateway/src/index.ts) like every bot-client → gateway call.
 *
 * `inputModality`/`outputModality` filter the catalog (e.g. `inputModality=image`
 * for vision models, `outputModality=image` for image generation) — together
 * they replace the former `/models/{text,vision,image-generation}` sub-paths.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ModelsListResponseSchema } from '@tzurot/common-types/schemas/api/models';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { internalRoutes } from '@tzurot/clients';
import { withManifestInput } from '../../utils/manifestInput.js';
import { sendContractSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-models');

const DEFAULT_LIMIT = 25;
/** High enough for the full OpenRouter catalog (~340) so `/models browse` pages everything. */
const MAX_LIMIT = 1000;

/** GET /api/internal/models — filtered OpenRouter model catalog. */
export const handleGetModels = (deps: RouteDeps): RequestHandler => {
  const { modelCache } = deps;
  return withManifestInput(internalRoutes.getModels, async (_req, res: Response, { query }) => {
    // `modelCache` is optional on RouteDeps but always wired in production
    // (index.ts) and in the conformance harness. Guard defensively.
    if (modelCache === undefined) {
      return sendError(res, ErrorResponses.serviceUnavailable('Model cache unavailable'));
    }

    const { inputModality, outputModality, search, limit } = query;
    const parsedLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const models = await modelCache.getFilteredModels({
      inputModality,
      outputModality,
      search,
      limit: parsedLimit,
    });

    logger.debug(
      {
        inputModality,
        outputModality,
        search,
        count: models.length,
      },
      'Served model catalog'
    );
    sendContractSuccess(
      res,
      ModelsListResponseSchema,
      { models, count: models.length },
      StatusCodes.OK
    );
  });
};
