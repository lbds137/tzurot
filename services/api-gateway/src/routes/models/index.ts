/**
 * Models Routes
 * API endpoints for fetching available AI models from OpenRouter
 *
 * Endpoints:
 * - GET /models - List all models with optional filtering
 * - GET /models/text - List text generation models
 * - GET /models/vision - List vision-capable models
 * - GET /models/image-generation - List image generation models
 * - POST /models/refresh - Force refresh the cache (admin only)
 *
 * Query Parameters:
 * - inputModality: Filter by input modality (text, image, audio, video, file)
 * - outputModality: Filter by output modality (text, image, audio, video, file)
 * - search: Search by model name or ID
 * - limit: Maximum number of results (default: 25 for autocomplete)
 *
 * Note: This endpoint is public (no auth required) as it only returns
 * publicly available model information from OpenRouter.
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  createLogger,
  isBotOwner,
  type ModelModality,
  type ModelAutocompleteOption,
} from '@tzurot/common-types';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';

const logger = createLogger('models-routes');

/** Default limit for autocomplete results */
const DEFAULT_LIMIT = 25;
/** Maximum allowed limit */
const MAX_LIMIT = 100;
/** Valid modality values */
const VALID_MODALITIES: ModelModality[] = ['text', 'image', 'audio', 'video', 'file'];

/** Validate modality parameter */
function isValidModality(value: unknown): value is ModelModality {
  return typeof value === 'string' && VALID_MODALITIES.includes(value as ModelModality);
}

/** Parse and validate limit parameter */
function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return DEFAULT_LIMIT;
  }
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

/** Parse search and limit from query params */
function parseSearchParams(query: { search?: unknown; limit?: unknown }): {
  searchQuery: string | undefined;
  parsedLimit: number;
} {
  return {
    searchQuery: typeof query.search === 'string' ? query.search : undefined,
    parsedLimit: parseLimit(query.limit),
  };
}

/** Send models response */
function sendModelsResponse(res: Response, models: ModelAutocompleteOption[]): void {
  sendCustomSuccess(res, { models, count: models.length }, StatusCodes.OK);
}

/**
 * Create models router with injected dependencies
 */
export function createModelsRouter(modelCache: OpenRouterModelCache): Router {
  const router = Router();

  // GET /models - List all models with optional filtering
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const { inputModality, outputModality, search, limit } = req.query;
      const inputModalityStr = typeof inputModality === 'string' ? inputModality : undefined;
      const outputModalityStr = typeof outputModality === 'string' ? outputModality : undefined;

      if (inputModalityStr !== undefined && !isValidModality(inputModalityStr)) {
        return sendError(
          res,
          ErrorResponses.validationError(
            `Invalid inputModality: ${inputModalityStr}. Valid values: ${VALID_MODALITIES.join(', ')}`
          )
        );
      }
      if (outputModalityStr !== undefined && !isValidModality(outputModalityStr)) {
        return sendError(
          res,
          ErrorResponses.validationError(
            `Invalid outputModality: ${outputModalityStr}. Valid values: ${VALID_MODALITIES.join(', ')}`
          )
        );
      }

      const { searchQuery, parsedLimit } = parseSearchParams({ search, limit });
      logger.debug(
        {
          inputModality: inputModalityStr,
          outputModality: outputModalityStr,
          search: searchQuery,
          limit: parsedLimit,
        },
        '[Models] Fetching models'
      );

      const models = await modelCache.getFilteredModels({
        inputModality: inputModalityStr,
        outputModality: outputModalityStr,
        search: searchQuery,
        limit: parsedLimit,
      });
      sendModelsResponse(res, models);
    })
  );

  // GET /models/text - List text generation models
  router.get(
    '/text',
    asyncHandler(async (req: Request, res: Response) => {
      const { searchQuery, parsedLimit } = parseSearchParams(req.query);
      const models = await modelCache.getTextModels(searchQuery, parsedLimit);
      sendModelsResponse(res, models);
    })
  );

  // GET /models/vision - List vision-capable models
  router.get(
    '/vision',
    asyncHandler(async (req: Request, res: Response) => {
      const { searchQuery, parsedLimit } = parseSearchParams(req.query);
      const models = await modelCache.getVisionModels(searchQuery, parsedLimit);
      sendModelsResponse(res, models);
    })
  );

  // GET /models/image-generation - List image generation models
  router.get(
    '/image-generation',
    asyncHandler(async (req: Request, res: Response) => {
      const { searchQuery, parsedLimit } = parseSearchParams(req.query);
      const models = await modelCache.getImageGenerationModels(searchQuery, parsedLimit);
      sendModelsResponse(res, models);
    })
  );

  // POST /models/refresh - Force refresh the cache (admin only)
  router.post(
    '/refresh',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.headers['x-user-id'];
      const userIdStr = typeof userId === 'string' ? userId : undefined;

      if (userIdStr === undefined || !isBotOwner(userIdStr)) {
        return sendError(
          res,
          ErrorResponses.unauthorized('Only bot owner can refresh model cache')
        );
      }

      logger.info({ userId: userIdStr }, '[Models] Admin refreshing model cache');
      const modelCount = await modelCache.refreshCache();
      sendCustomSuccess(
        res,
        { success: true, modelCount, message: `Refreshed cache with ${modelCount} models` },
        StatusCodes.OK
      );
    })
  );

  return router;
}
