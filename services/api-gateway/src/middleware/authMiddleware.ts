/**
 * Authentication Middleware
 *
 * Express middleware for verifying bot owner authentication.
 * Centralizes auth logic that was duplicated across admin routes.
 */

import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '@tzurot/common-types';
import { ErrorResponses, getStatusCode } from '../utils/errorResponses.js';

/**
 * Extract owner ID from request (checks both header and body)
 *
 * @param req - Express request
 * @returns Owner ID if found, undefined otherwise
 */
export function extractOwnerId(req: Request): string | undefined {
  // Check header first (most common)
  const headerOwnerId = req.headers['x-owner-id'];
  if (typeof headerOwnerId === 'string') {
    return headerOwnerId;
  }

  // Check body (used by some endpoints like db-sync)
  if (req.body && typeof req.body.ownerId === 'string') {
    return req.body.ownerId;
  }

  return undefined;
}

/**
 * Verify owner ID matches configured bot owner
 *
 * @param ownerId - The owner ID to verify
 * @returns true if valid, false otherwise
 */
export function isValidOwner(ownerId: string | undefined): boolean {
  const config = getConfig();

  if (!ownerId || !config.BOT_OWNER_ID) {
    return false;
  }

  return ownerId === config.BOT_OWNER_ID;
}

/**
 * Express middleware to require bot owner authentication
 *
 * Usage:
 * ```ts
 * router.post('/admin/endpoint', requireOwnerAuth(), async (req, res) => {
 *   // Only bot owner can reach here
 * });
 * ```
 *
 * @param customMessage - Optional custom unauthorized message
 * @returns Express middleware function
 */
export function requireOwnerAuth(customMessage?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ownerId = extractOwnerId(req);

    if (!isValidOwner(ownerId)) {
      const errorResponse = ErrorResponses.unauthorized(customMessage);
      const statusCode = getStatusCode(errorResponse.error as any);

      res.status(statusCode).json(errorResponse);
      return;
    }

    next();
  };
}
