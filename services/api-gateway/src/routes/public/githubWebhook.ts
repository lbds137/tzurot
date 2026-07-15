/**
 * GitHub release webhook — POST /webhooks/github/release
 *
 * Public-section route (GitHub cannot send X-Service-Auth); authentication
 * is the x-hub-signature-256 HMAC over the RAW body, which is why the
 * `/webhooks/github` prefix mounts `express.raw` ahead of the global JSON
 * parser (see main()). GitHub does NOT auto-retry failed deliveries — the
 * hourly reconcile sweep is the retry mechanism; awaiting the enqueue here
 * is for the webhook delivery log's observability, and every verified
 * replay resolves 200 (already-announced) so the hook stays green.
 */

import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { verifyGitHubSignature } from '../../utils/githubSignature.js';
import { announceGitHubRelease, GitHubReleaseSchema } from '../../services/releaseAnnounce.js';

const logger = createLogger('github-webhook');

/** The `release` event envelope — other event types are gated out by header. */
const ReleaseEventSchema = z.object({
  action: z.string(),
  release: GitHubReleaseSchema,
});

export interface GitHubWebhookDeps {
  prisma: PrismaClient;
  releaseBroadcastQueue: Queue | undefined;
}

function parseRawBody(rawBody: Buffer, res: Response): unknown {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(StatusCodes.BAD_REQUEST).json({ error: 'Body is not valid JSON' });
    return undefined;
  }
}

export function createGitHubReleaseWebhookRouter(deps: GitHubWebhookDeps): Router {
  const router = Router();

  router.post(
    '/release',
    asyncHandler(async (req: Request, res: Response) => {
      const secret = getConfig().GITHUB_WEBHOOK_SECRET;
      if (secret === undefined || deps.releaseBroadcastQueue === undefined) {
        res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
          error: 'Release webhook is not configured',
        });
        return;
      }

      if (!Buffer.isBuffer(req.body)) {
        if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
          // A parsed object means the JSON parser consumed the stream before
          // the raw mount — a wiring regression that breaks HMAC. Loud.
          logger.error({}, 'Webhook body arrived parsed — express.raw mount is missing');
          res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Webhook misconfigured' });
          return;
        }
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Expected application/json' });
        return;
      }

      const signature = req.get('x-hub-signature-256');
      if (!verifyGitHubSignature(req.body, signature, secret)) {
        logger.warn({ hasSignature: signature !== undefined }, 'Webhook signature rejected');
        res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Invalid signature' });
        return;
      }

      // Signature verified — everything below is trusted GitHub traffic, so
      // unhandled shapes resolve 200/ignored rather than erroring the hook.
      const event = req.get('x-github-event');
      if (event !== 'release') {
        // Includes the `ping` GitHub sends on webhook creation.
        res.status(StatusCodes.OK).json({ status: 'ignored', reason: `event:${event ?? 'none'}` });
        return;
      }

      const payload = parseRawBody(req.body, res);
      if (payload === undefined) {
        return;
      }
      const parsed = ReleaseEventSchema.safeParse(payload);
      if (!parsed.success) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Unexpected release payload shape' });
        return;
      }

      if (parsed.data.action !== 'published') {
        // `edited` fires when release:publish demotes the previous release —
        // never re-announce on edits.
        res
          .status(StatusCodes.OK)
          .json({ status: 'ignored', reason: `action:${parsed.data.action}` });
        return;
      }

      const outcome = await announceGitHubRelease(
        { prisma: deps.prisma, queue: deps.releaseBroadcastQueue },
        parsed.data.release
      );
      res.status(StatusCodes.OK).json(outcome);
    })
  );

  return router;
}
