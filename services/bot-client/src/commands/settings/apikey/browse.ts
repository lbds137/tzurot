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

import type { EmbedBuilder } from 'discord.js';
import { type WalletKey } from '@tzurot/common-types/schemas/api/wallet';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { getProviderDisplayName } from '../../../utils/providers.js';
import { buildBrowseListEmbed, ITEMS_PER_PAGE, pluralize } from '../../../utils/browse/index.js';

const logger = createLogger('settings-apikey-browse');

/** Render a Discord timestamp for a key's last-used / created dates. */
function discordTimestamp(iso: string, style: 'R' | 'D'): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;
}

/**
 * Build the browse embed on the shared list builder.
 *
 * Renders page 0 only, with no pagination components: the list is bounded
 * by the AIProvider enum (one key per provider), which is far below one
 * page. If the enum ever outgrows ITEMS_PER_PAGE, this needs a pager.
 */
function buildBrowseEmbed(keys: WalletKey[]): EmbedBuilder {
  const activeCount = keys.filter(k => k.isActive).length;

  const { embed } = buildBrowseListEmbed<WalletKey>({
    entityEmoji: '💳',
    titleNoun: 'API Keys',
    items: keys,
    page: 0,
    itemsPerPage: ITEMS_PER_PAGE,
    formatRow: key => ({
      badges: key.isActive ? AUTOCOMPLETE_BADGES.DEFAULT : undefined,
      name: getProviderDisplayName(key.provider),
      // The provider slug is what users type in set/test/remove.
      techId: key.provider,
      metadata: [
        key.isActive ? 'Active' : 'Inactive',
        `Last used ${key.lastUsedAt !== null ? discordTimestamp(key.lastUsedAt, 'R') : 'never'}`,
        `Added ${discordTimestamp(key.createdAt, 'D')}`,
      ],
    }),
    empty: {
      noItems:
        'You have no API keys configured yet (BYOK = Bring Your Own Key). ' +
        'Add one with `/settings apikey set` — get an OpenRouter key at <https://openrouter.ai/keys>.',
    },
    footerSegments: [
      pluralize(keys.length, { singular: 'key', plural: 'keys' }),
      `${activeCount} active`,
    ],
    badgeLegend: `Active ${AUTOCOMPLETE_BADGES.DEFAULT}`,
  });

  // Management tip stays list-adjacent (there is no detail view for keys).
  if (keys.length > 0) {
    embed.addFields({
      name: '💡 Management Commands',
      value: [
        '`/settings apikey set <provider>` - Add or update a key',
        '`/settings apikey test <provider>` - Verify a key works',
        '`/settings apikey remove <provider>` - Delete a key',
      ].join('\n'),
      inline: false,
    });
  }

  return embed;
}

/**
 * Handle /settings apikey browse subcommand
 * Displays configured API keys in a browsable format
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listWalletKeys();

    if (!result.ok) {
      await context.editReply({ content: `❌ Failed to retrieve wallet info: ${result.error}` });
      return;
    }

    const embed = buildBrowseEmbed(result.data.keys);
    await context.editReply({ embeds: [embed] });

    logger.info({ userId, keyCount: result.data.keys.length }, 'Listed keys');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
