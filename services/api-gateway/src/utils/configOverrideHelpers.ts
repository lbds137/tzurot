/**
 * Config Override Helpers
 *
 * Shared utilities for config cascade override routes. These patterns are
 * repeated across user config-overrides, personality config-overrides,
 * channel config-overrides, and model-override routes.
 */

import type { Response } from 'express';
import { Prisma, createLogger, type UserService } from '@tzurot/common-types';
import { mergeConfigOverrides } from './configOverrideMerge.js';
import { sendError } from './responseHelpers.js';
import { ErrorResponses } from './errorResponses.js';

const logger = createLogger('configOverrideHelpers');

// ============================================================================
// User Resolution
// ============================================================================

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
 * 15 call sites across 9 route files currently duplicate this pattern with
 * two minor error-text variants (`'Cannot create user for bot'` and
 * `'Cannot create user'`). This helper standardizes on the more specific
 * former message.
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

// ============================================================================
// Cache Invalidation
// ============================================================================

/**
 * Publish a cache invalidation event, swallowing errors.
 * If pub/sub fails, caches expire via TTL for eventual consistency.
 *
 * Uses warn level (not error) because TTL provides the safety net — a failed
 * pub/sub notification is a degraded-latency event, not a data correctness issue.
 *
 * @param fn - The invalidation function to call (e.g., service.invalidateUser)
 *             Pass undefined to skip invalidation (service not available).
 * @param context - Optional structured context for the log entry (e.g., { discordUserId })
 */
export async function tryInvalidateCache(
  fn: (() => Promise<void>) | undefined,
  context?: Record<string, unknown>
): Promise<void> {
  if (fn === undefined) {
    return;
  }
  try {
    await fn();
  } catch (error) {
    logger.warn({ err: error, ...context }, 'Failed to publish cache invalidation');
  }
}

// ============================================================================
// Config Override Merge
// ============================================================================

/** Result of merging config overrides. Either the merged JSON value or null if error was sent. */
export interface MergeOverridesResult {
  /** The merged value (null means "clear all overrides"), or undefined if validation failed. */
  merged: Record<string, unknown> | null | undefined;
  /** Prisma-safe JSON value. Only defined when merged is not undefined. */
  prismaValue: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
}

/**
 * Validate request body, merge config overrides, and convert to Prisma-safe value.
 *
 * Sends error response and returns `{ merged: undefined }` if:
 * - Body is not a JSON object
 * - Merged result is 'invalid' (schema validation failed)
 *
 * @returns merged value + Prisma-safe value, or undefined merged if error was sent
 */
export function mergeAndValidateOverrides(
  currentConfig: unknown,
  body: unknown,
  res: Response
): MergeOverridesResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    sendError(res, ErrorResponses.validationError('Request body must be a JSON object'));
    return { merged: undefined, prismaValue: undefined };
  }

  const input = body as Record<string, unknown>;
  const merged = mergeConfigOverrides(currentConfig, input);

  if (merged === 'invalid') {
    sendError(res, ErrorResponses.validationError('Invalid config format'));
    return { merged: undefined, prismaValue: undefined };
  }

  const prismaValue = merged === null ? Prisma.JsonNull : (merged as Prisma.InputJsonValue);
  return { merged, prismaValue };
}
