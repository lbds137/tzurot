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

import { type Request, type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { type ModelModality } from '@tzurot/common-types/types/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('internal-models');

const DEFAULT_LIMIT = 25;
/** High enough for the full OpenRouter catalog (~340) so `/models browse` pages everything. */
const MAX_LIMIT = 1000;
const VALID_MODALITIES: ModelModality[] = ['text', 'image', 'audio', 'video', 'file'];

function isValidModality(value: unknown): value is ModelModality {
  return typeof value === 'string' && VALID_MODALITIES.includes(value as ModelModality);
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return DEFAULT_LIMIT;
  }
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

/** GET /api/internal/models — filtered OpenRouter model catalog. */
export const handleGetModels = (deps: RouteDeps): RequestHandler => {
  const { modelCache } = deps;
  return asyncHandler(async (req: Request, res: Response) => {
    // `modelCache` is optional on RouteDeps but always wired in production
    // (index.ts) and in the conformance harness. Guard defensively.
    if (modelCache === undefined) {
      return sendError(res, ErrorResponses.serviceUnavailable('Model cache unavailable'));
    }

    const { inputModality, outputModality, search, limit } = req.query;
    const inputStr = typeof inputModality === 'string' ? inputModality : undefined;
    const outputStr = typeof outputModality === 'string' ? outputModality : undefined;

    if (inputStr !== undefined && !isValidModality(inputStr)) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Invalid inputModality: ${inputStr}. Valid values: ${VALID_MODALITIES.join(', ')}`
        )
      );
    }
    if (outputStr !== undefined && !isValidModality(outputStr)) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Invalid outputModality: ${outputStr}. Valid values: ${VALID_MODALITIES.join(', ')}`
        )
      );
    }

    const searchQuery = typeof search === 'string' ? search : undefined;
    const parsedLimit = parseLimit(limit);

    const models = await modelCache.getFilteredModels({
      inputModality: inputStr,
      outputModality: outputStr,
      search: searchQuery,
      limit: parsedLimit,
    });

    logger.debug(
      {
        inputModality: inputStr,
        outputModality: outputStr,
        search: searchQuery,
        count: models.length,
      },
      'Served model catalog'
    );
    sendCustomSuccess(res, { models, count: models.length }, StatusCodes.OK);
  });
};
