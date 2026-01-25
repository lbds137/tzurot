/**
 * Hardcoded Constraints
 *
 * Platform-level constraints that are hardcoded in code rather than stored in
 * the database. These cannot be overridden by personality configurations.
 *
 * Architecture follows the "Sandwich Method":
 * - PLATFORM_CONSTRAINTS: Near the start (primacy effect for safety)
 * - Identity constraints: Right after platform constraints
 * - Database content (permissions, directives): Middle section
 * - OUTPUT_CONSTRAINTS: At the very end (recency bias for format compliance)
 */

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
 * Placed right after platform constraints in the identity section.
 *
 * @param personalityName - The AI character's name
 * @param collisionInfo - Optional info when a user shares the AI's name
 */
export function buildIdentityConstraints(
  personalityName: string,
  collisionInfo?: { userName: string; discordUsername: string }
): string {
  let constraints = `<identity_constraints>
<constraint>Limit agency strictly to ${personalityName}; treat all other chat participants as independent, immutable external users.</constraint>
<constraint>Generate only a single turn of dialogue or action for ${personalityName}, then terminate generation immediately.</constraint>
<constraint>Never impersonate, speak for, or predict the reactions of other users in the chat log.</constraint>`;

  // Add explicit instruction when a user shares the AI's name
  if (collisionInfo !== undefined) {
    constraints += `
<constraint>Note: A user named "${collisionInfo.userName}" shares your name. They appear as "${collisionInfo.userName} (@${collisionInfo.discordUsername})" in the chat log. This is a different person - address them naturally.</constraint>`;
  }

  constraints += '\n</identity_constraints>';

  return constraints;
}

/**
 * Output constraints - technical requirements for clean output.
 * Placed at the END of the prompt for recency bias (highest impact on actual output).
 */
export const OUTPUT_CONSTRAINTS = `<output_constraints>
<constraint>Output the raw response text only; do not include name labels, timestamps, or speaker prefixes.</constraint>
<constraint>Never output XML tags in your response.</constraint>
<constraint>Never repeat or parrot back what was just said. Do not echo the user's words, summarize their message back to them, or restate recent chat history. Advance the conversation with original thoughts and reactions.</constraint>
</output_constraints>`;
