/**
 * Authentication Middleware
 *
 * Express middleware for verifying bot owner authentication.
 * Centralizes auth logic that was duplicated across admin routes.
 */

import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '@tzurot/common-types/config/config';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { UserService } from '@tzurot/identity';
import { ErrorResponses, getStatusCode } from '../utils/errorResponses.js';
import type { AuthenticatedRequest, ProvisionedRequest } from '../types.js';

const logger = createLogger('auth-middleware');

/**
 * Extract the caller's Discord ID for owner-auth purposes.
 *
 * Owner identity uses the same `X-User-Id` header as any other user —
 * `requireOwnerAuth` downstream (`verifyBotOwner`) is what gates that the value
 * matches the configured bot owner; this just identifies the caller. Delegates
 * to {@link extractUserId} so the header parsing and empty-header handling live
 * in one place (a body value is never consulted — it is not a credential).
 *
 * @param req - Express request
 * @returns Owner ID if the header is a non-empty string, undefined otherwise
 */
export function extractOwnerId(req: Request): string | undefined {
  return extractUserId(req);
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

    // extractUserId already returns undefined for a missing/empty header (its
    // `length > 0` guard), so an undefined check is sufficient — no separate
    // empty-string arm needed.
    if (userId === undefined) {
      logger.warn(
        {
          path: req.path,
          method: req.method,
          ip: req.ip,
        },
        'Missing user ID in request'
      );

      const errorResponse = ErrorResponses.unauthorized(
        customMessage ?? 'User authentication required'
      );
      const statusCode = getStatusCode(errorResponse.error);

      res.status(statusCode).json(errorResponse);
      return;
    }

    // Middleware-level "human users only" invariant: a caller that declares
    // its subject is a bot (X-User-Is-Bot from bot-client's GatewayUser
    // context) is rejected before any route handler runs — bots must never
    // provision user rows or personas. Only the explicit 'true' declaration
    // rejects: an ABSENT header means the caller carries no Discord user
    // context (internal service calls), which the invariant doesn't govern.
    // This hoists the guarantee that previously lived only in
    // getOrCreateUser's null-return (reachable solely when callers passed
    // isBot) up to the auth boundary, uniformly for every user route.
    if (req.headers['x-user-is-bot'] === 'true') {
      logger.warn(
        {
          userId,
          path: req.path,
          method: req.method,
        },
        'Bot user rejected at auth boundary'
      );
      const errorResponse = ErrorResponses.unauthorized('Bot users cannot access user routes');
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    // Attach userId to request for downstream handlers
    (req as AuthenticatedRequest).userId = userId;

    next();
  };
}

/**
 * Safely read + URI-decode a header value. Returns `undefined` when the
 * header is missing/empty and `null` when present-but-malformed (i.e.
 * `decodeURIComponent` threw on an invalid `%` sequence). Callers
 * distinguish these cases because missing is normal during deploy
 * transition whereas malformed is a bot-client bug worth surfacing.
 */
function readEncodedHeader(req: Request, headerName: string): string | undefined | null {
  const raw = req.headers[headerName];
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Express middleware to provision the authenticated user via the full
 * context path. Replaces the legacy shadow-mode shell-path fallback.
 *
 * Runs AFTER `requireUserAuth()`. Reads the `X-User-Username` and
 * `X-User-DisplayName` headers set by bot-client, URI-decodes them, and
 * calls `UserService.getOrCreateUser(discordId, username, displayName)` —
 * the full provisioning path that avoids the placeholder-name shell-user
 * class of bug. Attaches `req.provisionedUserId` +
 * `req.provisionedDefaultPersonaId` on success.
 *
 * **Strict mode**: returns 400 Bad Request on every failure mode —
 * missing headers, malformed URI encoding, or a thrown `getOrCreateUser`.
 * The shadow-mode fallback that previously called `next()` without
 * attaching the provisioned fields was deleted alongside `getOrCreateUserShell`
 * after the canary log trended to zero in production.
 *
 * Usage:
 * ```ts
 * router.get('/override',
 *   requireUserAuth(),
 *   requireProvisionedUser(prisma),
 *   asyncHandler(handler)
 * );
 * ```
 *
 * @param prisma - PrismaClient used to construct a cached UserService
 * @returns Express middleware function
 */
// Cache UserService instances by PrismaClient reference so multiple factory
// calls with the same client share ONE UserService (and its TTLCache). Each
// route file mounts `requireProvisionedUser(prisma)` per-endpoint, so
// `memory.ts` (12 endpoints) would otherwise create 12 independent
// UserServices with 12 independent caches — cache hits would never carry
// across endpoints for the same user. WeakMap lets the instance be GC'd
// if/when the PrismaClient it was built against is released (not expected
// in prod, but correct for test fixtures that spin up short-lived clients).
//
// Exported so every api-gateway route factory goes through the same registry
// — `new UserService(prisma)` in a route file creates an independent cache
// that never shares hits with the middleware's instance, which defeats the
// sharing the registry was built to provide. The canonical pattern is:
//
//   export function createFooRoutes(prisma: PrismaClient): Router {
//     const userService = getOrCreateUserService(prisma);  // NOT `new UserService(prisma)`
//     ...
//   }
//
// Test-author note: because the WeakMap is module-scoped, reusing the same
// `PrismaClient` object (or the same mock cast) across multiple `it()`
// blocks in a vitest worker will share the cached UserService — and any
// state accumulated on it — across those tests. Construct a fresh prisma
// object per test (or reset via `beforeEach`) if cross-test isolation
// matters. Current tests construct fresh `{} as unknown as PrismaClient`
// references per assertion, which is why they don't collide.
const userServiceByPrisma = new WeakMap<PrismaClient, UserService>();

export function getOrCreateUserService(prisma: PrismaClient): UserService {
  let service = userServiceByPrisma.get(prisma);
  if (service === undefined) {
    service = new UserService(prisma);
    userServiceByPrisma.set(prisma, service);
  }
  return service;
}

export function requireProvisionedUser(prisma: PrismaClient) {
  // Shared UserService across all factory calls with the same prisma
  // reference — see `userServiceByPrisma` comment above for why.
  const userService = getOrCreateUserService(prisma);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const discordId = (req as AuthenticatedRequest).userId;
    // Shouldn't happen — requireUserAuth runs first and would 401 on
    // missing userId — but defense in depth.
    if (discordId === undefined || discordId.length === 0) {
      const errorResponse = ErrorResponses.unauthorized('User authentication required');
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    const username = readEncodedHeader(req, 'x-user-username');
    const displayName = readEncodedHeader(req, 'x-user-displayname');

    // Missing either header → bot-client didn't send the user-context.
    // Pre-strict-mode this fell through; now it 400s loudly so a
    // misconfigured bot-client deploy is caught immediately.
    if (username === undefined || displayName === undefined) {
      logger.warn(
        {
          discordId,
          path: req.path,
          method: req.method,
          hasUsername: username !== undefined,
          hasDisplayName: displayName !== undefined,
        },
        'Missing user-context headers — rejecting request'
      );
      const errorResponse = ErrorResponses.validationError(
        'Missing user-context headers (X-User-Username, X-User-DisplayName)'
      );
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    // Malformed URI → bot-client bug.
    if (username === null || displayName === null) {
      logger.warn(
        {
          discordId,
          path: req.path,
          usernameMalformed: username === null,
          displayNameMalformed: displayName === null,
        },
        'Malformed URI in user-context header — rejecting request'
      );
      const errorResponse = ErrorResponses.validationError('Malformed URI in user-context header');
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      return;
    }

    // Full provisioning path. getOrCreateUser handles P2002 races internally.
    try {
      const provisioned = await userService.getOrCreateUser(discordId, username, displayName);
      if (provisioned === null) {
        // getOrCreateUser returns null for bot accounts; HTTP routes
        // shouldn't receive bot traffic in practice. Reject explicitly
        // rather than falling through — defense-in-depth bot-block.
        logger.warn(
          { discordId, path: req.path },
          'getOrCreateUser returned null (bot user?) — rejecting request'
        );
        const errorResponse = ErrorResponses.unauthorized('Bot users cannot access user routes');
        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
        return;
      }
      (req as ProvisionedRequest).provisionedUserId = provisioned.userId;
      (req as ProvisionedRequest).provisionedDefaultPersonaId = provisioned.defaultPersonaId;
      next();
    } catch (err) {
      logger.error(
        { err, discordId, path: req.path },
        'getOrCreateUser threw during provisioning — rejecting request'
      );
      const errorResponse = ErrorResponses.internalError('User provisioning failed');
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
    }
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
        'Service authentication failed'
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
