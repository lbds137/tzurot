/**
 * Shared renderer for the gateway's save-time model-compatibility warnings.
 *
 * The gateway returns clean prose (no emojis, no Discord concerns); this is the
 * one place that turns those strings into an ephemeral embed. Markdown-escaping
 * happens HERE rather than in the gateway strings because escaping is a Discord
 * rendering concern — the same warning may someday surface on a non-Discord
 * client.
 */
import { escapeMarkdown, type EmbedBuilder } from 'discord.js';
import { createWarningEmbed } from '../../utils/commandHelpers.js';

/**
 * Build the "Model Compatibility" warning embed, or null when there is nothing
 * to show — callers can gate their followUp on the null.
 */
export function buildModelCompatibilityEmbed(warnings: string[]): EmbedBuilder | null {
  if (warnings.length === 0) {
    return null;
  }
  return createWarningEmbed(
    '⚠️ Model Compatibility',
    warnings.map(warning => `• ${escapeMarkdown(warning)}`).join('\n')
  );
}
