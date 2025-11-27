/**
 * Async Handler Wrapper
 * Eliminates boilerplate async IIFE pattern and error handling in route handlers
 */

import type { Request, Response } from 'express';
import { createLogger } from '@tzurot/common-types';
import { ErrorResponses } from './errorResponses.js';
import { sendError } from './responseHelpers.js';

const logger = createLogger('asyncHandler');

/**
 * Wraps an async route handler to handle errors and avoid async IIFE boilerplate
 *
 * Before:
 * ```typescript
 * router.post('/endpoint', (req, res) => {
 *   void (async () => {
 *     try {
 *       // handler logic
 *     } catch (error) {
 *       logger.error({ err: error }, 'Error');
 *       const errorResponse = ErrorResponses.internalError(message);
 *       res.status(getStatusCode(errorResponse.error)).json(errorResponse);
 *     }
 *   })();
 * });
 * ```
 *
 * After:
 * ```typescript
 * router.post('/endpoint', asyncHandler(async (req, res) => {
 *   // just write the happy path
 *   const result = await doSomething();
 *   sendSuccess(res, result);
 * }));
 * ```
 *
 * Supports typed requests (e.g., AuthenticatedRequest) via generic parameter:
 * ```typescript
 * asyncHandler(async (req: AuthenticatedRequest, res) => {
 *   const userId = req.userId; // Type-safe
 * })
 * ```
 *
 * @param handler - Async route handler function
 * @returns Express route handler with error handling
 */
export function asyncHandler<R extends Request = Request>(
  handler: (req: R, res: Response) => Promise<void>
): (req: Request, res: Response) => void {
  return (req: Request, res: Response) => {
    void (async () => {
      try {
        await handler(req as R, res);
      } catch (error) {
        logger.error({ err: error }, 'Request handler error');

        // If response already sent, don't try to send error
        if (res.headersSent) {
          logger.warn({}, 'Response already sent, cannot send error response');
          return;
        }

        const errorResponse = ErrorResponses.internalError(
          error instanceof Error ? error.message : 'Internal server error'
        );

        sendError(res, errorResponse);
      }
    })();
  };
}
