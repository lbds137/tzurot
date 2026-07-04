/**
 * SlotResolver — pure function that produces the multi-tag slot list.
 *
 * Given the personalities a single Discord message identifies through its
 * various trigger sources (reply, activation, DM session, inline mentions),
 * this resolves them into the ordered slot list the MultiTagCoordinator
 * fans out to. Pure (no I/O); easy to test in isolation.
 *
 * Slot ordering:
 *   slot 0 = reply-to-character (if any)
 *   slot 1 = activated channel OR DM-session (if different from slot 0)
 *   slot 2+ = inline mentions in textual order
 *
 * Deduplicated by personality.id (first occurrence keeps its slot).
 * Capped at MULTI_TAG.MAX_TAGS.
 */

import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

/** What kind of trigger produced this slot. Drives isAutoResponse and DM-activation behavior. */
export type SlotSource = 'reply' | 'activation' | 'dm-session' | 'mention';

/**
 * A resolved slot — identity + source. The coordinator adds runtime fields
 * (jobId, status, result) when it submits.
 */
export interface ResolvedSlot {
  personality: LoadedPersonality;
  source: SlotSource;
  /**
   * `true` only for ambient sources (activation, dm-session) — these are
   * responses where the user didn't explicitly invoke this personality;
   * the channel/session did. `false` for reply and mention (explicit
   * user intent). Threaded through to the response sender's footer logic
   * (mirrors today's per-message `isAutoResponse` flag).
   */
  isAutoResponse: boolean;
}

export interface SlotResolverInput {
  /** Personality from a reply-to-character (if message is a reply). */
  replyPersonality?: LoadedPersonality | null;
  /**
   * Activated-channel personality (guild channels). Mutually exclusive with
   * `dmSessionPersonality` — only one of these can be set per message.
   */
  activatedPersonality?: LoadedPersonality | null;
  /**
   * DM-session personality (DM channels with an active session).
   *
   * **Scaffolding for DM session recovery.** No production code path
   * populates this field today — bare-DM dispatch lives in
   * `DMSessionProcessor` (not in the multi-tag fan-out), and multi-tag DM
   * messages skip the ambient slot, relying on the rightmost mention
   * becoming the new active session via the post-fan-out channel_settings
   * write. The field exists so a future recovery path can express "this
   * slot was the ambient DM session personality" when rehydrating a
   * persisted fan-out snapshot, and SlotResolver tests exercise the slot-1
   * tie-break logic to keep that path tested ahead of its first caller.
   */
  dmSessionPersonality?: LoadedPersonality | null;
  /** Inline `@`-mentions, in textual left-to-right order. */
  mentionedPersonalities?: LoadedPersonality[];
  /** Override the default cap. Defaults to `MULTI_TAG.MAX_TAGS`. */
  maxTags?: number;
}

/**
 * Resolve inputs to the slot list. Order: reply → ambient → mentions.
 * Deduped by personality.id; capped at maxTags.
 */
export function resolveSlots(input: SlotResolverInput): ResolvedSlot[] {
  const maxTags = input.maxTags ?? MULTI_TAG.MAX_TAGS;
  if (maxTags <= 0) {
    return [];
  }

  const seen = new Set<string>();
  const slots: ResolvedSlot[] = [];

  const tryAdd = (
    personality: LoadedPersonality | null | undefined,
    source: SlotSource,
    isAutoResponse: boolean
  ): boolean => {
    if (slots.length >= maxTags) {
      return false;
    }
    if (personality === null || personality === undefined) {
      return false;
    }
    if (seen.has(personality.id)) {
      return false;
    }
    seen.add(personality.id);
    slots.push({ personality, source, isAutoResponse });
    return true;
  };

  // Slot 0: reply (explicit user action).
  tryAdd(input.replyPersonality, 'reply', false);

  // Slot 1: ambient (activated channel takes priority over DM session if
  // both are somehow provided; in practice they're mutually exclusive by
  // channel type).
  if (input.activatedPersonality !== null && input.activatedPersonality !== undefined) {
    tryAdd(input.activatedPersonality, 'activation', true);
  } else {
    tryAdd(input.dmSessionPersonality, 'dm-session', true);
  }

  // Remaining slots: inline mentions in textual order.
  for (const mention of input.mentionedPersonalities ?? []) {
    tryAdd(mention, 'mention', false);
    if (slots.length >= maxTags) {
      break;
    }
  }

  return slots;
}

/**
 * Determine the personality that should become the new DM "active" character
 * after this fan-out completes. Returns `null` when nothing should change.
 *
 * Rule: textually-last mention wins; if no mentions, fall back to the reply
 * target; if neither, return null (ambient/dm-session continues unchanged).
 *
 * Used by the multi-tag coordinator post-fan-out in DM channels to update
 * `channel_settings` so the next bare DM message routes to the right
 * character. Aligns with user intent: "last tagged character stays activated."
 *
 * **Why reply-target counts as a session switch**: in a DM, replying to a
 * personality's message IS an explicit interaction with that personality —
 * the user clicked the reply UI on a specific bot message, so subsequent
 * bare DMs going to the replied-to character matches intent. This is the
 * "last explicit interaction wins" rule. Compare with `dm-session` source
 * (ambient/passive continuation) which does NOT trigger a switch — only
 * sources that represent fresh explicit user intent (reply, mention) do.
 */
export function pickNewDMActivePersonality(slots: ResolvedSlot[]): LoadedPersonality | null {
  // Walk in reverse to find the last mention.
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].source === 'mention') {
      return slots[i].personality;
    }
  }
  // No mentions — fall back to reply target if present.
  const replySlot = slots.find(s => s.source === 'reply');
  if (replySlot) {
    return replySlot.personality;
  }
  // Only ambient slots present — no change to active state.
  return null;
}
