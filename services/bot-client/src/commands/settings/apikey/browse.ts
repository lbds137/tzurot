/**
 * Wallet Browse Handler
 * Shows configured API key providers with status and actions
 *
 * Follows the browse pattern for consistency with other commands.
 * Since wallet typically has few keys (one per provider), pagination
 * is not needed, but the pattern prepares for future expansion.
 *
 * Security:
 * - Never displays actual API keys
 * - Shows only provider names and status
 * - Response is ephemeral (only visible to the user)
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  AUTOCOMPLETE_BADGES,
  type AIProvider,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { getProviderDisplayName } from '../../../utils/providers.js';

const logger = createLogger('wallet-browse');

interface WalletKeyInfo {
  provider: AIProvider;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

interface WalletListResponse {
  keys: WalletKeyInfo[];
}

/**
 * Format a single key entry for the browse embed
 */
function formatKeyEntry(key: WalletKeyInfo, index: number): string {
  const statusBadge = key.isActive ? AUTOCOMPLETE_BADGES.DEFAULT : '';
  const statusText = key.isActive ? 'Active' : 'Inactive';
  const providerName = getProviderDisplayName(key.provider);

  const lastUsed =
    key.lastUsedAt !== null
      ? `<t:${Math.floor(new Date(key.lastUsedAt).getTime() / 1000)}:R>`
      : 'Never';
  const created = `<t:${Math.floor(new Date(key.createdAt).getTime() / 1000)}:D>`;

  return [
    `**${index + 1}.** ${statusBadge} ${providerName}`,
    `   └ ${statusText} • Last used: ${lastUsed} • Added: ${created}`,
  ].join('\n');
}

/**
 * Build the browse embed
 */
function buildBrowseEmbed(keys: WalletKeyInfo[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('💳 API Wallet Browser')
    .setColor(keys.length > 0 ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  if (keys.length === 0) {
    embed.setDescription(
      'You have no API keys configured yet.\n\n' +
        '**Getting Started:**\n' +
        '• Use `/settings apikey set` to add your own API key\n' +
        '• Get an OpenRouter key at https://openrouter.ai/keys\n\n' +
        '_BYOK = Bring Your Own Key_'
    );
    return embed;
  }

  // Format key entries
  const entries = keys.map((key, index) => formatKeyEntry(key, index));

  embed.setDescription(entries.join('\n\n'));

  // Add footer with count and legend
  const activeCount = keys.filter(k => k.isActive).length;
  embed.setFooter({
    text: `${keys.length} key${keys.length > 1 ? 's' : ''} configured • ${activeCount} active • ${AUTOCOMPLETE_BADGES.DEFAULT} = Active`,
  });

  // Add tip field
  embed.addFields({
    name: '💡 Management Commands',
    value: [
      '`/settings apikey set <provider>` - Add or update a key',
      '`/settings apikey test <provider>` - Verify a key works',
      '`/settings apikey remove <provider>` - Delete a key',
    ].join('\n'),
    inline: false,
  });

  return embed;
}

/**
 * Handle /settings apikey browse subcommand
 * Displays configured API keys in a browsable format
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<WalletListResponse>('/wallet/list', { userId });

    if (!result.ok) {
      await context.editReply({ content: `❌ Failed to retrieve wallet info: ${result.error}` });
      return;
    }

    const embed = buildBrowseEmbed(result.data.keys);
    await context.editReply({ embeds: [embed] });

    logger.info({ userId, keyCount: result.data.keys.length }, '[Wallet Browse] Listed keys');
  } catch (error) {
    logger.error({ err: error, userId }, '[Wallet Browse] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
