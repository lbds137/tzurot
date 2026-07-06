/**
 * Config Override Helpers
 *
 * Shared utilities for config cascade override routes. These patterns are
 * repeated across user config-overrides, personality config-overrides,
 * channel config-overrides, and model-override routes.
 */

import type { Request, Response } from 'express';
import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { mergeConfigOverrides } from './configOverrideMerge.js';
import { sendError } from './responseHelpers.js';
import { ErrorResponses } from './errorResponses.js';
import { getRequiredParam } from './requestParams.js';

const logger = createLogger('configOverrideHelpers');

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

// ============================================================================
// Route preambles
// ============================================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract and UUID-validate the `:personalityId` route param, sending a
 * validation error on a malformed id. Returns null after sending (callers
 * early-return on null).
 */
export function getValidatedPersonalityId(req: Request, res: Response): string | null {
  const personalityId = getRequiredParam(req.params.personalityId, 'personalityId');
  if (!UUID_PATTERN.test(personalityId)) {
    sendError(res, ErrorResponses.validationError('Invalid personalityId format'));
    return null;
  }
  return personalityId;
}

/**
 * Confirm the personality a cascade override points at exists, sending a 404
 * otherwise. Existence-check only — override rows are user-scoped, so no
 * ownership gate belongs here (the owner-gated load in the personality
 * config-defaults route is deliberately a DIFFERENT shape).
 */
export async function findPersonalityOrSendNotFound(
  res: Response,
  prisma: PrismaClient,
  personalityId: string
): Promise<{ id: string; name: string } | null> {
  const personality = await prisma.personality.findFirst({
    where: { id: personalityId },
    select: { id: true, name: true },
  });
  if (personality === null) {
    sendError(res, ErrorResponses.notFound('Personality'));
    return null;
  }
  return personality;
}
