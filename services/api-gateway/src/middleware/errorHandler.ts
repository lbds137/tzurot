/**
 * Error Handler Middleware
 *
 * Global error handling for Express routes.
 */

import type { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types';
import { ErrorResponses } from '../utils/errorResponses.js';

const logger = createLogger('api-gateway');

/**
 * 404 Not Found handler
 * Must be registered AFTER all routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  const errorResponse = ErrorResponses.notFound(`Route ${req.method} ${req.path}`);
  res.status(StatusCodes.NOT_FOUND).json(errorResponse);
}

/**
 * Global error handler
 * Must be registered LAST
 */
export function globalErrorHandler(isProduction: boolean) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error({ err }, '[Server] Unhandled error:');

    const errorResponse = ErrorResponses.internalError(
      isProduction ? 'Internal server error' : err.message
    );

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(errorResponse);
  };
}
