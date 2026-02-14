/**
 * Discord mention utility for denylist commands.
 *
 * Strips mention wrappers (<@123>, <@!123>) so users can paste @mentions
 * directly into the target field without hitting ID length validation.
 */

/** Strip Discord mention wrappers: <@123>, <@!123> → 123 */
export function stripMention(input: string): string {
  const match = /^<@!?(\d+)>$/.exec(input);
  return match !== null ? match[1] : input;
}
