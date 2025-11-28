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

/**
 * Extract admin API key from request header (X-Admin-Key)
 *
 * @param req - Express request
 * @returns Admin API key if found, undefined otherwise
 */
export function extractAdminApiKey(req: Request): string | undefined {
  const headerKey = req.headers['x-admin-key'];
  if (typeof headerKey === 'string' && headerKey.length > 0) {
    return headerKey;
  }
  return undefined;
}

/**
 * Verify admin API key matches configured key
 *
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param providedKey - The key to verify
 * @returns true if valid, false otherwise
 */
export function isValidAdminKey(providedKey: string | undefined): boolean {
  const config = getConfig();
  const configuredKey = config.ADMIN_API_KEY;

  if (
    providedKey === undefined ||
    providedKey.length === 0 ||
    configuredKey === undefined ||
    configuredKey.length === 0
  ) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  if (providedKey.length !== configuredKey.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < providedKey.length; i++) {
    result |= providedKey.charCodeAt(i) ^ configuredKey.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Express middleware to require admin API key authentication
 *
 * Checks the X-Admin-Key header against ADMIN_API_KEY environment variable.
 * Use this to protect administrative endpoints that are called from the bot.
 *
 * Usage:
 * ```ts
 * router.use('/admin', requireAdminAuth());
 * // or
 * router.put('/admin/config/:id', requireAdminAuth(), async (req, res) => {
 *   // Only requests with valid admin key can reach here
 * });
 * ```
 *
 * @param customMessage - Optional custom unauthorized message
 * @returns Express middleware function
 */
export function requireAdminAuth(customMessage?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const adminKey = extractAdminApiKey(req);

    if (!isValidAdminKey(adminKey)) {
      // Log unauthorized access attempt for security monitoring
      logger.warn(
        {
          hasKey: adminKey !== undefined,
          path: req.path,
          method: req.method,
          ip: req.ip,
        },
        '[Auth] Admin authentication failed'
      );

      const errorResponse = ErrorResponses.unauthorized(
        customMessage ?? 'Admin authentication required'
      );
      const statusCode = getStatusCode(errorResponse.error);

      res.status(statusCode).json(errorResponse);
      return;
    }

    next();
  };
}
