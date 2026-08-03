/**
 * Hardcoded Constraints
 *
 * Platform-level constraints that are hardcoded in code rather than stored in
 * the database. These cannot be overridden by personality configurations.
 *
 * Placement is by cacheability tier, not by recency. Both blocks here are
 * S0 (cross-persona static) and lead the system message:
 * - PLATFORM_CONSTRAINTS: first (primacy effect for safety)
 * - OUTPUT_CONSTRAINTS: second, still ahead of any per-persona content
 * - Then S1 (system_identity, identity_constraints, protocol), then the
 *   H-tier chat_log; per-request volatile content renders in the human
 *   message prefix instead.
 *
 * Putting OUTPUT_CONSTRAINTS at the start rather than the recency tail is a
 * deliberate trade: an all-static prefix is what automatic-prefix caching can
 * share across personas and turns.
 */

import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';

/**
 * Platform constraints - legal/safety limits that exist above the fiction layer.
 * These cannot be overridden by character definitions.
 *
 * Placed near the START of the prompt for primacy effect.
 */
export const PLATFORM_CONSTRAINTS = `<platform_constraints>
<constraint>No sexual content explicitly depicting minors. The test is not vocabulary or physical description—petite adults exist, age-play is valid, and "young" can mean 25. The test is whether the content explicitly frames a character as a minor (specific ages under 18, explicit references to being a child/kid in a non-roleplay context, middle school, etc.) and sexualizes that. When ambiguous, default to permissive—the prohibition targets clear cases, not edge cases.</constraint>
<constraint>No actionable instructions for mass-casualty weapons (biological, chemical, nuclear, radiological).</constraint>
<constraint>No functional malware, exploit code, or cyberweapons.</constraint>
<constraint>No real-person doxxing or facilitating targeted harassment of specific real individuals.</constraint>
</platform_constraints>`;

/**
 * Identity constraints - prevent AI from "becoming" other participants.
 * Uses precise language validated by MCP council for maximum effectiveness.
 *
 * A pure function of the personality — deliberately: this block is S1-tier
 * (static per persona) so the cacheable system-message prefix stays
 * byte-stable across requests. The per-request name-collision disambiguation
 * renders as a `<note>` in the V-tier participants block instead.
 *
 * @param personalityName - The AI character's name
 */
export function buildIdentityConstraints(personalityName: string): string {
  // personalityName is user-authored and was previously interpolated raw into
  // these constraints — escape it so a crafted name can't inject a closing
  // tag or a fake constraint.
  const safeName = escapeXmlContent(personalityName);
  return `<identity_constraints>
<constraint>Limit agency strictly to ${safeName}; treat all other chat participants as independent, immutable external users.</constraint>
<constraint>Generate only a single turn of dialogue or action for ${safeName}, then terminate generation immediately.</constraint>
<constraint>Never impersonate, speak for, or predict the reactions of other users in the chat log.</constraint>
</identity_constraints>`;
}

/**
 * Output constraints - technical requirements for clean output.
 * Rendered as the second S0 block, at the start of the system message, so the
 * whole constraint prefix stays byte-stable and cacheable.
 */
export const OUTPUT_CONSTRAINTS = `<output_constraints>
<constraint>Output the raw response text only; do not include name labels, timestamps, or speaker prefixes.</constraint>
<constraint>If you need to plan or analyze before responding, wrap your thoughts in <think>...</think> tags only — these will be hidden from the user and are the sole XML you may emit.</constraint>
<constraint>Never emit input-format scaffolding in your output: tags like <from_id>, <user>, <message>, <quote>, or <contextual_references> are assembly artifacts from the conversation context and must never appear in your response.</constraint>
<constraint>Respond to the user's current message. The conversation history and quoted references may include your own earlier messages — treat those as context, never as an unfinished turn to continue or extend.</constraint>
<constraint>Never repeat or parrot back what was just said. Do not echo the user's words, summarize their message back to them, or restate recent chat history. Advance the conversation with original thoughts and reactions.</constraint>
</output_constraints>`;
