/**
 * Voice Browse Handler
 * Lists ElevenLabs cloned voices (tzurot-prefixed) with paginated slot summary
 */

import { EmbedBuilder } from 'discord.js';
import type { ButtonInteraction, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS, toGatewayUser } from '../../../utils/userGatewayClient.js';
import {
  ITEMS_PER_PAGE,
  createBrowseCustomIdHelpers,
  buildBrowseButtons,
  pluralize,
} from '../../../utils/browse/index.js';
import type { VoicesListResponse } from './types.js';

const logger = createLogger('settings-voices-browse');

type VoiceBrowseFilter = 'all';

const browseHelpers = createBrowseCustomIdHelpers<VoiceBrowseFilter>({
  prefix: 'settings-voices',
  validFilters: ['all'] as const,
  includeSort: false,
});

/** Check if a custom ID is a voice browse pagination button */
export function isVoiceBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/**
 * Build the paginated browse response for voice listing.
 *
 * Paginates client-side since the gateway returns all voices at once
 * (max ~30 for ElevenLabs Creator plan — no server-side pagination needed).
 */
function buildVoiceBrowsePage(
  data: VoicesListResponse,
  page: number
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
  const { voices, totalVoices, tzurotCount } = data;

  const embed = new EmbedBuilder()
    .setTitle('🎤 Cloned Voices')
    .setColor(voices.length > 0 ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  if (voices.length === 0) {
    embed.setDescription(
      'No Tzurot-cloned voices found.\n\n' +
        'Voices are auto-cloned when you talk to a character with voice enabled.\n' +
        `Your ElevenLabs account has **${totalVoices}** voices.`
    );
    return { embed, components: [] };
  }

  const totalPages = Math.max(1, Math.ceil(voices.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const startIdx = safePage * ITEMS_PER_PAGE;
  const pageVoices = voices.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  const voiceLines = pageVoices.map(
    (v, i) => `**${startIdx + i + 1}.** \`${v.slug}\` — \`${v.voiceId}\``
  );

  embed.setDescription(voiceLines.join('\n'));
  embed.setFooter({
    text: `${pluralize(tzurotCount, { singular: 'Tzurot voice', plural: 'Tzurot voices' })} / ${totalVoices} total in ElevenLabs account`,
  });

  // Show management hints only on first page to avoid clutter
  if (safePage === 0) {
    embed.addFields({
      name: '💡 Management',
      value: [
        '`/settings voices delete <voice>` - Remove a single voice',
        '`/settings voices clear` - Remove all Tzurot voices',
      ].join('\n'),
      inline: false,
    });
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (totalPages > 1) {
    components.push(
      buildBrowseButtons<VoiceBrowseFilter>({
        currentPage: safePage,
        totalPages,
        filter: 'all',
        currentSort: 'name', // Unused — sort toggle disabled
        query: null,
        buildCustomId: browseHelpers.build,
        buildInfoId: browseHelpers.buildInfo,
        showSortToggle: false,
      })
    );
  }

  return { embed, components };
}

/**
 * Handle /settings voices browse
 * Lists all tzurot-prefixed cloned voices from ElevenLabs.
 *
 * Intentionally does NOT use the voiceCache (autocomplete cache) — browse
 * should always show fresh data since users invoke it to verify state after
 * mutations. The cache is designed for autocomplete keystroke dedup only.
 */
export async function handleBrowseVoices(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<VoicesListResponse>('/user/voices', {
      user: toGatewayUser(context.user),
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      await context.editReply({ content: `❌ ${result.error}` });
      return;
    }

    const { embed, components } = buildVoiceBrowsePage(result.data, 0);
    await context.editReply({ embeds: [embed], components });

    logger.info({ userId, voiceCount: result.data.voices.length }, '[Voices Browse] Listed voices');
  } catch (error) {
    logger.error({ err: error, userId }, '[Voices Browse] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Handle pagination button clicks for voice browse.
 *
 * Re-fetches from gateway on each page turn — browse intentionally shows
 * fresh data (not the autocomplete cache) so users can verify state after
 * voice mutations.
 */
export async function handleVoiceBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferUpdate();

  const userId = interaction.user.id;

  try {
    const result = await callGatewayApi<VoicesListResponse>('/user/voices', {
      user: toGatewayUser(interaction.user),
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      await interaction.editReply({ content: `❌ ${result.error}`, embeds: [], components: [] });
      return;
    }

    const { embed, components } = buildVoiceBrowsePage(result.data, parsed.page);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error(
      { err: error, userId, page: parsed.page },
      '[Voices Browse] Failed to load browse page'
    );
    // Keep existing content on error (same pattern as character browse)
  }
}
