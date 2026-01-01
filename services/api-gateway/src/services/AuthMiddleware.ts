/**
 * Authentication Middleware
 *
 * Express middleware for verifying bot owner authentication.
 * Centralizes auth logic that was duplicated across admin routes.
 */

import type { Request, Response, NextFunction } from 'express';
import { getConfig, createLogger, isBotOwner } from '@tzurot/common-types';
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
 * Extract service secret from request header (X-Service-Auth)
 *
 * @param req - Express request
 * @returns Service secret if found, undefined otherwise
 */
export function extractServiceSecret(req: Request): string | undefined {
  const headerKey = req.headers['x-service-auth'];
  if (typeof headerKey === 'string' && headerKey.length > 0) {
    return headerKey;
  }
  return undefined;
}

/**
 * Verify service secret matches configured secret
 *
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param providedSecret - The secret to verify
 * @returns true if valid, false otherwise
 */
export function isValidServiceSecret(providedSecret: string | undefined): boolean {
  const config = getConfig();
  const configuredSecret = config.INTERNAL_SERVICE_SECRET;

  if (
    providedSecret === undefined ||
    providedSecret.length === 0 ||
    configuredSecret === undefined ||
    configuredSecret.length === 0
  ) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  if (providedSecret.length !== configuredSecret.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < providedSecret.length; i++) {
    result |= providedSecret.charCodeAt(i) ^ configuredSecret.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Check if request is from bot owner (for user-initiated requests only)
 *
 * Use this for READ operations that should:
 * - Allow service-only requests (no userId) without auth check
 * - Require bot owner for user-initiated requests (with userId)
 *
 * This prevents the bug where internal service calls fail because they
 * don't have a user context.
 *
 * @param userId - The user ID from the request (may be undefined for service calls)
 * @returns true if authorized (service call OR bot owner), false otherwise
 *
 * @example
 * ```ts
 * // For READ operations - allow service-only, check owner for user requests
 * if (!isAuthorizedForRead(req.userId)) {
 *   sendError(res, ErrorResponses.unauthorized('Only bot owners can view this'));
 *   return;
 * }
 * ```
 */
export function isAuthorizedForRead(userId: string | undefined): boolean {
  // No userId = service-only operation, always allowed
  if (userId === undefined) {
    return true;
  }
  // Has userId = user-initiated, must be bot owner
  return isBotOwner(userId);
}

/**
 * Check if request is from bot owner (required for modifications)
 *
 * Use this for WRITE operations (PUT, POST, DELETE) that always require
 * bot owner authentication, even for service calls.
 *
 * @param userId - The user ID from the request
 * @returns true if bot owner, false otherwise
 *
 * @example
 * ```ts
 * // For WRITE operations - always require bot owner
 * if (!isAuthorizedForWrite(req.userId)) {
 *   sendError(res, ErrorResponses.unauthorized('Only bot owners can modify this'));
 *   return;
 * }
 * ```
 */
export function isAuthorizedForWrite(userId: string | undefined): boolean {
  // No userId = not authorized for writes
  if (userId === undefined) {
    return false;
  }
  return isBotOwner(userId);
}

/**
 * Express middleware to require service-to-service authentication
 *
 * Checks the X-Service-Auth header against INTERNAL_SERVICE_SECRET environment variable.
 * Use this to protect endpoints that should only be called by internal services (bot-client, ai-worker).
 *
 * Usage:
 * ```ts
 * app.use(requireServiceAuth()); // Apply globally
 * // or
 * router.post('/ai/generate', requireServiceAuth(), async (req, res) => {
 *   // Only requests with valid service secret can reach here
 * });
 * ```
 *
 * @param customMessage - Optional custom unauthorized message
 * @returns Express middleware function
 */
export function requireServiceAuth(customMessage?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const serviceSecret = extractServiceSecret(req);

    if (!isValidServiceSecret(serviceSecret)) {
      // Log unauthorized access attempt for security monitoring
      logger.warn(
        {
          hasSecret: serviceSecret !== undefined,
          path: req.path,
          method: req.method,
          ip: req.ip,
        },
        '[Auth] Service authentication failed'
      );

      const errorResponse = ErrorResponses.unauthorized(
        customMessage ?? 'Service authentication required'
      );
      const statusCode = getStatusCode(errorResponse.error);

      res.status(statusCode).json(errorResponse);
      return;
    }

    // Also extract userId if provided (for routes that need isBotOwner check)
    const userId = extractUserId(req);
    if (userId !== undefined && userId.length > 0) {
      (req as AuthenticatedRequest).userId = userId;
    }

    next();
  };
}
