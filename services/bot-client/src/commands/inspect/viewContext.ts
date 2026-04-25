/**
 * Viewer-aware rendering context for the /inspect command.
 *
 * Threaded through view builders so they can redact character internals
 * (system prompt, memory previews) when the inspecting user does not own
 * the personality the diagnostic log was generated against.
 *
 * Computed once per interaction from `interaction.user.id` (not cached from
 * the original /inspect invocation). This is the defense-in-depth path —
 * ephemeral replies already prevent other users from seeing the buttons,
 * but each click still re-evaluates ownership against the clicker.
 */

import { isBotOwner } from '@tzurot/common-types';
import type { DiagnosticLog } from './types.js';

export interface ViewContext {
  /**
   * True if the inspecting user can see character-internal data
   * (system prompt content, memory preview text). False means the
   * relevant view builders redact those fields with a 🔒 affordance.
   *
   * - Bot admin → always true (admin has DB access regardless)
   * - Personality owner → true
   * - Non-owner → false
   * - Missing `meta.personalityOwnerDiscordId` → true. Covers logs predating
   *   PR #898, deleted-owner User rows (resolver returned null), test
   *   environments without DB access, and any future schema drift. This
   *   fallback is load-bearing, not just a transition aid.
   */
  canViewCharacter: boolean;
}

/**
 * Compute the view context for a given inspector + diagnostic log.
 *
 * @param log - the resolved diagnostic log
 * @param inspectorDiscordId - Discord user ID of the user clicking the button
 *   (or running the slash command). MUST be the clicker's id, not the
 *   original /inspect invoker — see file header.
 */
export function computeViewContext(log: DiagnosticLog, inspectorDiscordId: string): ViewContext {
  const ownerDiscordId = log.data.meta.personalityOwnerDiscordId;
  const canViewCharacter =
    isBotOwner(inspectorDiscordId) ||
    ownerDiscordId === undefined ||
    ownerDiscordId === inspectorDiscordId;
  return { canViewCharacter };
}
