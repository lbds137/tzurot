/**
 * Response Helpers
 * Utilities for sending consistent HTTP responses
 */

import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
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
export function sendCustomSuccess(
  res: Response,
  response: Record<string, unknown> | object,
  statusCode = StatusCodes.OK
): void {
  res.status(statusCode).json(response);
}
