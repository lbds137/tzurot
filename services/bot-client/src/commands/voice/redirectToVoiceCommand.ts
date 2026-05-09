/**
 * Deprecation-stub helper.
 *
 * Used by /settings tts and /settings voices subcommands after the
 * /voice consolidation. Each legacy subcommand still resolves to a real
 * handler (Discord requires this for the registered schema to remain
 * valid), but the handler now just replies ephemerally with the new
 * path the user should run instead.
 *
 * Stub-removal scheduling is tracked in backlog/inbox.md.
 */

import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

/**
 * Map from legacy `${group} ${subcommand}` keys to the new /voice path.
 * Includes the renames done as part of the consolidation:
 *   tts reset           → /voice tts clear
 *   tts default         → /voice tts set-default
 */
export const SETTINGS_TO_VOICE_REDIRECTS: Record<string, string> = {
  'tts set': '/voice tts set',
  'tts reset': '/voice tts clear',
  'tts default': '/voice tts set-default',
  'tts clear-default': '/voice tts clear-default',
  'tts browse': '/voice tts browse',
  'voices browse': '/voice voices browse',
  'voices clear': '/voice voices clear',
  'voices delete': '/voice voices delete',
};

/**
 * Reply ephemerally pointing the user at the new /voice path.
 *
 * The interaction is already deferred (DeferredCommandContext) so we
 * editReply rather than reply. `flags: MessageFlags.Ephemeral` is set
 * via the original deferReply, so this reply is invisible to others.
 */
export async function redirectToVoiceCommand(
  context: DeferredCommandContext,
  newPath: string
): Promise<void> {
  await context.editReply({
    content:
      `ℹ️ This command has moved to **\`${newPath}\`**.\n\n` +
      'The /settings voice surface was consolidated under a unified `/voice` command. ' +
      'The legacy /settings paths are scheduled for removal — use /voice going forward.',
  });
}

/**
 * Look up a legacy /settings subcommand by group + subcommand and route
 * to the new /voice path. Returns true if a redirect was sent, false if
 * the (group, subcommand) pair has no mapping (caller should handle the
 * unknown-subcommand error).
 */
export async function tryRedirectToVoice(
  context: DeferredCommandContext,
  group: string,
  subcommand: string
): Promise<boolean> {
  const newPath = SETTINGS_TO_VOICE_REDIRECTS[`${group} ${subcommand}`];
  if (newPath === undefined) {
    return false;
  }
  await redirectToVoiceCommand(context, newPath);
  return true;
}
