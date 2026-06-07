/**
 * Response Helpers
 * Utilities for sending consistent HTTP responses
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { z } from 'zod';
import { type ErrorResponse, getStatusCode } from './errorResponses.js';

/**
 * Send an error response with appropriate status code
 * @param res - Express response object
 * @param errorResponse - ErrorResponse object from ErrorResponses utility
 */
export function sendError(res: Response, errorResponse: ErrorResponse): void {
  res.status(getStatusCode(errorResponse.error)).json(errorResponse);
}

/**
 * Send a success response with data
 * @param res - Express response object
 * @param data - Response data to send
 * @param statusCode - HTTP status code (default: 200 OK)
 */
export function sendSuccess<T>(res: Response, data: T, statusCode = StatusCodes.OK): void {
  res.status(statusCode).json({ success: true, data });
}

/**
 * Send a success response with custom structure
 * @param res - Express response object
 * @param response - Custom response object
 * @param statusCode - HTTP status code (default: 200 OK)
 */
export function sendCustomSuccess<T extends object>(
  res: Response,
  response: T,
  statusCode = StatusCodes.OK
): void {
  res.status(statusCode).json(response);
}

/**
 * Send a success response whose payload is compile-time-pinned to a route's
 * declared output schema.
 *
 * Pass the SAME Zod schema the route's manifest entry declares as `output`;
 * `payload` is then typed as `z.output<typeof schema>`, so a handler whose
 * response shape drifts from its contract (missing field, extra envelope
 * wrapper, Date where the schema says ISO string) fails tsc instead of
 * failing the generated client's runtime validation in production. The
 * manifest-conformance harness (routes/conformance/) is the runtime
 * counterpart that also catches a handler passing the WRONG schema here.
 *
 * Prefer this over `sendCustomSuccess` for any route with a manifest entry.
 *
 * @param res - Express response object
 * @param _schema - The route's declared output schema (type anchor only — no
 *   runtime parse; serialization happens in res.json as usual)
 * @param payload - Response body; must satisfy the schema's inferred type
 * @param statusCode - HTTP status code (default: 200 OK)
 */
export function sendContractSuccess<T extends z.ZodType>(
  res: Response,
  _schema: T,
  payload: z.output<T>,
  statusCode = StatusCodes.OK
): void {
  res.status(statusCode).json(payload);
}
