/**
 * Preflight copy for Reroll: the user-facing refusal for a reroll whose reply
 * memory cannot be removed safely. The gateway decides (it plans against the
 * real stored rows); this maps its answer to a message. Checked before any
 * generation, so a refused reroll spends nothing and touches nothing.
 *
 * Mirrors `memoryPreflight.ts` (Edit Response) with "edit" read as "reroll".
 * `reply-off-template` cannot arise on a reroll (the planner is not given a
 * new reply to validate), so it falls to the generic message.
 */

import type { z } from 'zod';
import type { RerollMemoryPlanSchema } from '@tzurot/common-types/schemas/api/history';

export type RerollMemoryPlan = z.infer<typeof RerollMemoryPlanSchema>;

export const REROLL_MEMORY_LOCKED_MESSAGE =
  "This reply's memory is locked. Unlock it in /memory to reroll.";
export const REROLL_OTHER_LOCKED_MESSAGE =
  "Someone else's memory of this reply is locked, so it can't be rerolled.";
export const REROLL_MEMORY_UNSAFE_MESSAGE =
  "This reply's memory can't be updated safely, so it can't be rerolled.";

/** The refusal message, or null when the reroll may proceed. */
export function rerollPreflightMessage(plan: RerollMemoryPlan): string | null {
  if (plan.kind !== 'blocked') {
    return null;
  }
  switch (plan.reason) {
    case 'locked':
      return REROLL_MEMORY_LOCKED_MESSAGE;
    case 'other-locked':
      return REROLL_OTHER_LOCKED_MESSAGE;
    default:
      return REROLL_MEMORY_UNSAFE_MESSAGE;
  }
}
