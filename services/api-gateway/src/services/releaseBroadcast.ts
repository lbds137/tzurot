/**
 * Release-broadcast recipient resolution + enqueue orchestration.
 *
 * Owns the level→threshold eligibility mapping and the announcement /
 * delivery-log bookkeeping the DM worker's ledger depends on. Every blast
 * trigger (/admin/broadcast, the release webhook, the reconcile sweep)
 * funnels through the same functions so idempotency lives in exactly one
 * place.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  NotifyLevelSchema,
  type NotifyLevelValue,
} from '@tzurot/common-types/schemas/api/notifications';
import type { Queue } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import {
  generateReleaseAnnouncementUuid,
  generateReleaseDeliveryLogUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { addValidatedJob } from '../utils/validatedQueue.js';
import { isPrismaUniqueConstraintError } from '../utils/prismaErrors.js';

const logger = createLogger('ReleaseBroadcast');

/** Page size for the eligible-recipient sweep (cursor-paginated, never clips). */
const RECIPIENT_PAGE_SIZE = 500;

/** Max recipients per DM batch job (mirrors the job schema's cap). */
export const BROADCAST_BATCH_SIZE = 50;

/**
 * Users notified for a release of weight `level`: everyone whose threshold
 * sits at the release's weight or further down the declaration order (a
 * `patch`-threshold user accepts everything; a `major`-threshold user only
 * the heaviest). Declaration order (major < minor < patch) is load-bearing —
 * see the NotifyLevel schema doc.
 */
export function eligibleThresholds(level: NotifyLevelValue): NotifyLevelValue[] {
  // NotifyLevelSchema.options carries the declaration order (major < minor <
  // patch) — single source, no second hand-maintained copy of the ordering.
  const ordered: readonly NotifyLevelValue[] = NotifyLevelSchema.options;
  return ordered.slice(ordered.indexOf(level));
}

export interface EligibleRecipient {
  userId: string;
  discordUserId: string;
  username: string;
}

/**
 * Cursor-paginated sweep over every opted-in user at or above the level's
 * threshold. Bounded per page (03-database take rule) but never clips the
 * total — a broadcast must reach the whole eligible set.
 */
export async function resolveEligibleRecipients(
  prisma: PrismaClient,
  level: NotifyLevelValue
): Promise<EligibleRecipient[]> {
  const thresholds = eligibleThresholds(level);
  const recipients: EligibleRecipient[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await prisma.user.findMany({
      where: { notifyEnabled: true, notifyLevel: { in: thresholds } },
      select: { id: true, discordId: true, username: true },
      orderBy: { id: 'asc' },
      take: RECIPIENT_PAGE_SIZE,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const user of page) {
      recipients.push({ userId: user.id, discordUserId: user.discordId, username: user.username });
    }
    if (page.length < RECIPIENT_PAGE_SIZE) {
      return recipients;
    }
    cursor = page[page.length - 1].id;
  }
}

export interface EnqueueBroadcastOptions {
  version: string;
  level: NotifyLevelValue;
  body: string;
  githubReleaseId?: string;
}

export type EnqueueBroadcastResult =
  | { ok: true; releaseId: string; recipients: number; batches: number }
  | { ok: false; reason: 'already-announced' };

/**
 * Create the announcement + pending delivery-log rows and enqueue the DM
 * batches. Idempotent end-to-end: the unique version rejects a re-announce,
 * delivery-log ids are deterministic (skipDuplicates), and batch jobIds are
 * deterministic (BullMQ dedups same-id jobs).
 */
export async function enqueueBroadcast(
  prisma: PrismaClient,
  queue: Queue,
  options: EnqueueBroadcastOptions
): Promise<EnqueueBroadcastResult> {
  const { version, level, body } = options;
  const releaseId = generateReleaseAnnouncementUuid(version);

  const existing = await prisma.releaseAnnouncement.findUnique({
    where: { version },
    select: { id: true },
  });
  if (existing !== null) {
    return { ok: false, reason: 'already-announced' };
  }

  const recipients = await resolveEligibleRecipients(prisma, level);

  try {
    await prisma.releaseAnnouncement.create({
      data: {
        id: releaseId,
        version,
        level,
        githubReleaseId: options.githubReleaseId ?? 'adhoc',
        body,
        // Nothing to deliver: the blast is complete at birth.
        ...(recipients.length === 0 ? { completedAt: new Date() } : {}),
      },
    });
  } catch (error) {
    // Two concurrent calls with the same version can both pass the findUnique
    // pre-check; the unique constraint is the real double-send protection, so
    // its violation resolves to the same friendly outcome as the pre-check.
    if (isPrismaUniqueConstraintError(error)) {
      return { ok: false, reason: 'already-announced' };
    }
    throw error;
  }

  if (recipients.length === 0) {
    logger.info({ version, level }, 'Broadcast created with zero eligible recipients');
    return { ok: true, releaseId, recipients: 0, batches: 0 };
  }

  await prisma.releaseDeliveryLog.createMany({
    data: recipients.map(recipient => ({
      id: generateReleaseDeliveryLogUuid(releaseId, recipient.userId),
      releaseId,
      userId: recipient.userId,
    })),
    skipDuplicates: true,
  });

  let batches = 0;
  for (let start = 0; start < recipients.length; start += BROADCAST_BATCH_SIZE) {
    const slice = recipients.slice(start, start + BROADCAST_BATCH_SIZE);
    await addValidatedJob(
      queue,
      JobType.ReleaseBroadcastDm,
      {
        requestId: `${releaseId}:${batches}`,
        jobType: JobType.ReleaseBroadcastDm,
        responseDestination: { type: 'api' },
        releaseId,
        version,
        body,
        recipients: slice.map(recipient => ({
          deliveryLogId: generateReleaseDeliveryLogUuid(releaseId, recipient.userId),
          userId: recipient.userId,
          discordUserId: recipient.discordUserId,
        })),
      },
      { jobId: `release-broadcast:${releaseId}:${batches}` }
    );
    batches += 1;
  }

  logger.info({ version, level, recipients: recipients.length, batches }, 'Broadcast enqueued');
  return { ok: true, releaseId, recipients: recipients.length, batches };
}
