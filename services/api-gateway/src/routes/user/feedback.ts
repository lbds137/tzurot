/**
 * User Feedback Intake Route
 * POST /user/feedback - store a feedback submission after the abuse gates
 *
 * Gates run cheap-first (owner-set posture: this surface is a spam/DoS
 * vector): Zod length cap → Redis cooldown → Redis daily cap → DB near-dup
 * dedupe. Every rejection names the specific limit so the ephemeral reply is
 * actionable. Redis counters are plain INCR/EXPIRE, fail-open by
 * construction — a Redis blip degrades to "no cooldown", never to blocking
 * legitimate feedback.
 */

import { type Response, type RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { Redis } from 'ioredis';
import { FEEDBACK_LIMITS } from '@tzurot/common-types/constants/feedback';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { SubmitFeedbackInputSchema } from '@tzurot/common-types/schemas/api/feedback';
import { hashFeedbackContent } from '@tzurot/common-types/utils/feedbackNormalization';
import { generateUserFeedbackUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('user-feedback');

const SECONDS_PER_DAY = 24 * 60 * 60;
/** Daily counter TTL: a day plus an hour of slop so the key always outlives
 *  its UTC-date window regardless of when the first submission lands. */
const DAILY_KEY_TTL_SECONDS = 25 * 60 * 60;

/** Cooldown gate: returns remaining seconds when active, null when clear.
 *  Fail-open: a Redis error skips the gate rather than blocking feedback. */
async function checkCooldown(redis: Redis, discordUserId: string): Promise<number | null> {
  const key = `${REDIS_KEY_PREFIXES.FEEDBACK_COOLDOWN}${discordUserId}`;
  try {
    const ttl = await redis.ttl(key);
    return ttl > 0 ? ttl : null;
  } catch (error) {
    logger.warn({ err: error }, 'Cooldown gate Redis error — failing open');
    return null;
  }
}

/** Daily-cap gate: increments and returns true when the cap is exceeded.
 *  Counts ATTEMPTS, not accepted submissions — an abuse gate should burn the
 *  spammer's budget on rejected duplicates too. Fail-open on Redis errors. */
async function checkDailyCap(redis: Redis, discordUserId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${REDIS_KEY_PREFIXES.FEEDBACK_DAILY}${discordUserId}:${day}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, DAILY_KEY_TTL_SECONDS);
    }
    return count > FEEDBACK_LIMITS.DAILY_CAP;
  } catch (error) {
    logger.warn({ err: error }, 'Daily-cap gate Redis error — failing open');
    return false;
  }
}

/** POST /api/user/feedback — gated intake, then store + arm the cooldown. */
export const handleSubmitFeedback = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (req: ProvisionedRequest, res: Response) => {
    if (deps.redis === undefined) {
      return sendError(
        res,
        ErrorResponses.serviceUnavailable('Feedback intake requires Redis; try again shortly.')
      );
    }
    const redis = deps.redis;

    const parseResult = SubmitFeedbackInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }
    const { content } = parseResult.data;

    const discordUserId = req.userId;

    const cooldownRemaining = await checkCooldown(redis, discordUserId);
    if (cooldownRemaining !== null) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `You're submitting feedback too quickly — try again in ${cooldownRemaining} seconds.`
        )
      );
    }

    if (await checkDailyCap(redis, discordUserId)) {
      return sendError(
        res,
        ErrorResponses.validationError(
          `Daily feedback limit reached (${FEEDBACK_LIMITS.DAILY_CAP} per day) — try again tomorrow.`
        )
      );
    }

    const userId = resolveProvisionedUserId(req);
    const contentHash = hashFeedbackContent(content);

    const windowStart = new Date(
      Date.now() - FEEDBACK_LIMITS.DEDUPE_WINDOW_DAYS * SECONDS_PER_DAY * 1000
    );
    const duplicate = await prisma.userFeedback.findFirst({
      where: { userId, contentHash, createdAt: { gt: windowStart } },
      select: { id: true },
    });
    if (duplicate !== null) {
      return sendError(
        res,
        ErrorResponses.validationError(
          "You've already submitted this feedback recently — no need to resend it."
        )
      );
    }

    const submittedAt = new Date();
    const row = await prisma.userFeedback.create({
      data: {
        id: generateUserFeedbackUuid(userId, contentHash, submittedAt.toISOString()),
        userId,
        content,
        contentHash,
      },
      select: { id: true },
    });

    // Arm the cooldown only AFTER a successful store — a gate failure or DB
    // error must not lock the user out of retrying. Best-effort: the row is
    // already stored, so a Redis error here must not turn the 201 into a 500.
    try {
      await redis.setex(
        `${REDIS_KEY_PREFIXES.FEEDBACK_COOLDOWN}${discordUserId}`,
        FEEDBACK_LIMITS.COOLDOWN_SECONDS,
        '1'
      );
    } catch (error) {
      logger.warn({ err: error }, 'Failed to arm feedback cooldown — continuing');
    }

    logger.info({ userId, feedbackId: row.id }, 'Feedback stored');
    sendCustomSuccess(res, { success: true, feedbackId: row.id }, StatusCodes.CREATED);
  });
};
