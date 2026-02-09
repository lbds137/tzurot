/**
 * Zod Validation Helpers
 *
 * Shared utilities for extracting human-readable error messages
 * from Zod validation failures and sending error responses.
 */

import type { ZodError } from 'zod';
import type { Response } from 'express';
import { sendError } from './responseHelpers.js';
import { ErrorResponses } from './errorResponses.js';

/**
 * Extract a human-readable error message from a ZodError.
 * Returns the first issue with field path prefix.
 */
export function formatZodError(error: ZodError): string {
  const firstIssue = error.issues[0];
  const fieldPath = firstIssue.path.join('.');
  return fieldPath ? `${fieldPath}: ${firstIssue.message}` : firstIssue.message;
}

/**
 * Send a validation error response from a ZodError.
 * Shorthand for the common safeParse failure pattern.
 */
export function sendZodError(res: Response, error: ZodError): void {
  sendError(res, ErrorResponses.validationError(formatZodError(error)));
}
