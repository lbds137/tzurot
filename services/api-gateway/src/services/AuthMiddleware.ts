/**
 * Authentication Middleware
 *
 * Express middleware for verifying bot owner authentication.
 * Centralizes auth logic that was duplicated across admin routes.
 */

import type { Request, Response, NextFunction } from 'express';
import { getConfig, createLogger } from '@tzurot/common-types';
import { ErrorResponses, getStatusCode } from '../utils/errorResponses.js';
import type { AuthenticatedRequest } from '../types.js';

const logger = createLogger('auth-middleware');

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
  if (
    req.body !== null &&
    req.body !== undefined &&
    typeof (req.body as Record<string, unknown>).ownerId === 'string'
  ) {
    return (req.body as Record<string, string>).ownerId;
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

  if (
    ownerId === undefined ||
    ownerId.length === 0 ||
    config.BOT_OWNER_ID === undefined ||
    config.BOT_OWNER_ID.length === 0
  ) {
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
      // Log unauthorized access attempt for security monitoring
      logger.warn(
        {
          ownerId: ownerId ?? 'none',
          path: req.path,
          method: req.method,
          ip: req.ip,
        },
        '[Auth] Unauthorized access attempt'
      );

      const errorResponse = ErrorResponses.unauthorized(customMessage);
      const statusCode = getStatusCode(errorResponse.error);

      res.status(statusCode).json(errorResponse);
      return;
    }

    next();
  };
}

/**
 * Extract user ID from request header (X-User-Id)
 *
 * @param req - Express request
 * @returns User ID if found, undefined otherwise
 */
export function extractUserId(req: Request): string | undefined {
  const headerUserId = req.headers['x-user-id'];
  if (typeof headerUserId === 'string' && headerUserId.length > 0) {
    return headerUserId;
  }
  return undefined;
}

/**
 * Express middleware to require user authentication (any user, not just owner)
 *
 * Usage:
 * ```ts
 * router.post('/wallet/set', requireUserAuth(), async (req, res) => {
 *   const userId = req.userId; // Available after auth
 * });
 * ```
 *
 * @param customMessage - Optional custom unauthorized message
 * @returns Express middleware function
 */
export function requireUserAuth(customMessage?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = extractUserId(req);

    if (userId === undefined || userId.length === 0) {
      logger.warn(
        {
          path: req.path,
          method: req.method,
          ip: req.ip,
        },
        '[Auth] Missing user ID in request'
      );

      const errorResponse = ErrorResponses.unauthorized(
        customMessage ?? 'User authentication required'
      );
      const statusCode = getStatusCode(errorResponse.error);

      res.status(statusCode).json(errorResponse);
      return;
    }

    // Attach userId to request for downstream handlers
    (req as AuthenticatedRequest).userId = userId;

    next();
  };
}
