/**
 * Voice Browse Handler
 * Lists tzurot-prefixed cloned voices across all configured audio
 * providers (ElevenLabs, Mistral) with paginated slot summary.
 */

import {
  escapeMarkdown,
  type EmbedBuilder,
  type ButtonInteraction,
  type ActionRowBuilder,
  type ButtonBuilder,
} from 'discord.js';
import { ENTITY_EMOJI } from '@tzurot/common-types/constants/uxVocabulary';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import {
  ITEMS_PER_PAGE,
  createBrowseCustomIdHelpers,
  buildBrowseButtons,
  buildBrowseListEmbed,
  pluralize,
} from '../../../utils/browse/index.js';
import type { VoicesListResponse } from './types.js';

/**
 * Display names for audio providers in user-facing warning messages.
 * Typed as `Record<AudioProviderId, …>` so adding a new provider value
 * surfaces a TS error here — the `?? w.provider` fallback below is a
 * cosmetic safety net; the real enforcement is the type error.
 */
const PROVIDER_DISPLAY_NAMES: Record<AudioProviderId, string> = {
  elevenlabs: 'ElevenLabs',
  mistral: 'Mistral',
};

const logger = createLogger('voice-voices-browse');

type VoiceBrowseFilter = 'all';

const browseHelpers = createBrowseCustomIdHelpers<VoiceBrowseFilter>({
  prefix: 'voice-voices',
  validFilters: ['all'] as const,
  includeSort: false,
});

/** Check if a custom ID is a voice browse pagination button */
export function isVoiceBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

/**
 * Render a per-provider warnings field. Omitted when no warnings — caller
 * checks length before calling.
 */
function renderWarningsField(warnings: NonNullable<VoicesListResponse['warnings']>): {
  name: string;
  value: string;
  inline: boolean;
} {
  const lines = warnings.map(w => {
    const providerName = PROVIDER_DISPLAY_NAMES[w.provider] ?? w.provider;
    return `• **${providerName}**: ${w.message}`;
  });
  return {
    name: "⚠️ Some providers couldn't be loaded",
    value: lines.join('\n'),
    inline: false,
  };
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
  const { voices, totalVoices, tzurotCount, warnings } = data;

  const hasWarnings = warnings !== undefined && warnings.length > 0;

  const { embed, totalPages, safePage } = buildBrowseListEmbed<
    VoicesListResponse['voices'][number]
  >({
    entityEmoji: ENTITY_EMOJI.voice,
    titleNoun: 'Cloned Voices',
    items: voices,
    page,
    itemsPerPage: ITEMS_PER_PAGE,
    formatRow: voice => ({
      // Slugs are read back from the provider account, where names can be
      // hand-edited — not guaranteed markdown-safe.
      name: escapeMarkdown(voice.slug),
      // Provider tag disambiguates same-slug voices across BYOK accounts;
      // the provider-side voice id supports dashboard cross-referencing.
      // Same trust tier as the slug: backticks can't be escaped inside a
      // code span, so strip them (mirrors the builder's techId guard).
      metadata: [voice.provider, `\`${voice.voiceId.replaceAll('`', '')}\``],
    }),
    empty: {
      noItems:
        'No Tzurot-cloned voices found. Voices are auto-cloned when you talk ' +
        `to a character with voice enabled — your audio provider account(s) have **${totalVoices}** voices total.`,
    },
    footerSegments: [
      `${pluralize(tzurotCount, { singular: 'Tzurot voice', plural: 'Tzurot voices' })} / ${totalVoices} total across audio providers`,
    ],
    // Browse stays BLURPLE even with provider warnings (§2.3 — color encodes
    // surface kind, not state); the ⚠️ warnings field is the signal.
  });

  if (hasWarnings) {
    embed.addFields(renderWarningsField(warnings));
  }

  if (voices.length === 0) {
    return { embed, components: [] };
  }

  // Show management hints only on first page to avoid clutter
  if (safePage === 0) {
    embed.addFields({
      name: '💡 Management',
      value: [
        '`/voice voices delete <voice>` - Remove a single voice',
        '`/voice voices purge` - Permanently delete all Tzurot voices',
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
 * Handle /voice voices browse
 * Lists all tzurot-prefixed cloned voices from ElevenLabs.
 *
 * Intentionally does NOT use the voiceCache (autocomplete cache) — browse
 * should always show fresh data since users invoke it to verify state after
 * mutations. The cache is designed for autocomplete keystroke dedup only.
 */
export async function handleBrowseVoices(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listVoices();

    if (!result.ok) {
      await context.editReply({
        content: renderSpec(classifyGatewayFailure(result, 'voices', { operation: 'read' })),
      });
      return;
    }

    const { embed, components } = buildVoiceBrowsePage(result.data, 0);
    await context.editReply({ embeds: [embed], components });

    logger.info({ userId, voiceCount: result.data.voices.length }, 'Listed voices');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'voices', { operation: 'read' })),
    });
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
    const { userClient } = clientsFor(interaction);
    const result = await userClient.listVoices();

    if (!result.ok) {
      await interaction.editReply({
        content: renderSpec(classifyGatewayFailure(result, 'voices', { operation: 'read' })),
        embeds: [],
        components: [],
      });
      return;
    }

    const { embed, components } = buildVoiceBrowsePage(result.data, parsed.page);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, userId, page: parsed.page }, 'Failed to load browse page');
    // Keep existing content on error (same pattern as character browse)
  }
}
