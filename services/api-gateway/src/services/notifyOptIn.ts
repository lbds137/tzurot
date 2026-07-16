/**
 * First-deliberate-use stamp for release-DM eligibility.
 *
 * `users.notifyOptedInAt` is a state machine: null until the user's first
 * deliberate interaction with the bot, then set once and never overwritten
 * (the eligibility gate in releaseBroadcast checks only non-null; the value
 * records WHEN). A provisioned row alone must never qualify — extended-context
 * bystanders get rows without ever using the bot.
 *
 * Gateway-side deliberate-use signals that call this: BYOK key setup
 * (wallet/setKey) and an explicit /notifications preference update. The
 * third signal — a successful generation — is stamped by ai-worker's
 * AIJobProcessor, which owns its own copy (no cross-service imports).
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';

/** Set notifyOptedInAt once; a user already stamped is left untouched. */
export async function stampNotifyOptedIn(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, notifyOptedInAt: null },
    data: { notifyOptedInAt: new Date() },
  });
}
