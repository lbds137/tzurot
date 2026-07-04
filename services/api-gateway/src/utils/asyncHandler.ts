/**
 * Async Handler Wrapper
 * Eliminates boilerplate async IIFE pattern and error handling in route handlers
 */

import type { Request, Response } from 'express';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ErrorResponses } from './errorResponses.js';
import { sendError } from './responseHelpers.js';
import { ParameterError } from './requestParams.js';
import { NotFoundError } from './appErrors.js';

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
): (req: Request, res: Response) => Promise<void> {
  return (req: Request, res: Response): Promise<void> => {
    // Returns the IIFE's promise so callers (including tests) can await the
    // full request lifecycle. Express ignores the returned promise — the
    // framework's contract is res.json()/next(), so this is invisible in
    // production but lets tests rely on `await handler(req, res)` actually
    // awaiting all internal microtasks. Without this, multi-await handlers
    // (peek → validate → consume → soft-delete) leave their final res.json()
    // call queued AFTER the test's continuation, causing flaky mocks-not-called
    // assertions.
    return (async () => {
      try {
        await handler(req as R, res);
      } catch (error) {
        // If response already sent, don't try to send error
        if (res.headersSent) {
          logger.warn({ err: error }, 'Response already sent, cannot send error response');
          return;
        }

        // Missing/invalid route parameters are client errors, not server errors.
        // Logged at warn since it could indicate a routing misconfiguration.
        if (error instanceof ParameterError) {
          logger.warn({ err: error }, 'Missing required route parameter');
          sendError(res, ErrorResponses.validationError(error.message));
          return;
        }

        // A resource vanished (e.g. deleted between a route's existence pre-check
        // and a follow-up read). Client-caused, not a server fault → 404. Only the
        // clean `resource` reaches the body; the richer message stays in the log.
        if (error instanceof NotFoundError) {
          logger.warn({ err: error }, 'Resource not found');
          sendError(res, ErrorResponses.notFound(error.resource));
          return;
        }

        logger.error({ err: error }, 'Request handler error');

        const errorResponse = ErrorResponses.internalError(
          error instanceof Error ? error.message : 'Internal server error'
        );

        sendError(res, errorResponse);
      }
    })();
  };
}
