/**
 * Route Helpers
 *
 * Generic utilities shared across route handlers. For config-cascade-specific
 * helpers (merge, invalidation), see configOverrideHelpers.ts.
 */

import type { Response } from 'express';
import type { UserService } from '@tzurot/common-types';
import { sendError } from './responseHelpers.js';
import { ErrorResponses } from './errorResponses.js';

/**
 * Resolve the internal user UUID for an incoming Discord user ID, sending a
 * validation error response and returning `null` if the lookup fails because
 * the Discord user is a bot.
 *
 * Collapses the repeated pattern:
 *
 * ```ts
 * const userId = await userService.getOrCreateUser(req.userId, req.userId);
 * if (userId === null) {
 *   return sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
 * }
 * ```
 *
 * into:
 *
 * ```ts
 * const userId = await resolveUserIdOrSendError(userService, req.userId, res);
 * if (userId === null) return;
 * ```
 *
 * @returns internal user UUID on success, or `null` if error was sent
 */
export async function resolveUserIdOrSendError(
  userService: UserService,
  discordUserId: string,
  res: Response
): Promise<string | null> {
  const userId = await userService.getOrCreateUser(discordUserId, discordUserId);
  if (userId === null) {
    sendError(res, ErrorResponses.validationError('Cannot create user for bot'));
    return null;
  }
  return userId;
}
