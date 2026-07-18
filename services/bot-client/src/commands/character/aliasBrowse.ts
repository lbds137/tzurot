/**
 * /character alias browse — the design-system pilot surface.
 *
 * Two modes over the tiered alias model:
 * - `character` given → that character's aliases (global rows + YOUR own).
 * - omitted → your aliases across all characters (my-aliases endpoint; the
 *   bot owner also sees every global row, with ⚠️ shadowed marking).
 *
 * Composition: the shared list-embed builder + browse customId factory
 * (`character-alias` prefix, sortless — the QUERY coordinate carries the
 * character slug, empty = my-aliases mode) + the design system's FIRST
 * in-place filter toggle (all → mine → global, the sort-toggle mechanism
 * applied to the filter field) + select-driven remove with a Tier-A
 * confirm. Remove-confirm state (scope/slug/alias) rides the confirmation
 * embed's footer (newline-delimited, alias LAST so its text is verbatim) —
 * alias text can approach 100 chars, which no customId budget survives;
 * the shapes import-confirm footer is the in-repo precedent.
 */

import {
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  MessageFlags,
  type ButtonInteraction,
  type EmbedBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { AliasScope } from '@tzurot/common-types/schemas/api/personality';
import {
  ALIAS_FILTERS,
  applyFilter,
  fetchAliasRows,
  nextAliasFilter,
  type AliasFilter,
  type AliasRow,
} from './aliasData.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  buildSimplePaginationButtons,
  createBrowseCustomIdHelpers,
  truncateForSelect,
  pluralize,
  formatFilterLabeled,
  type BrowseActionRow,
} from '../../utils/browse/index.js';
import { buildConfirmAction } from '../../utils/confirmation/confirmAction.js';
import { createComponentRouter, type ComponentRouter } from '../../utils/componentRouter.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('character-alias-browse');

/** Re-run hint for expired/unparseable component state. */
const BROWSE_COMMAND_HINT = '/character alias browse';

const ITEMS_PER_PAGE = 15;

/** Select values must fit Discord's 100-char cap: `{scope}:{aliasKey}`. */
const SELECT_ALIAS_KEY_LENGTH = 92;

const aliasHelpers = createBrowseCustomIdHelpers<AliasFilter>({
  prefix: 'character-alias',
  validFilters: ALIAS_FILTERS,
  includeSort: false,
});

/** The remove-confirm buttons carry the browse RETURN coordinates. */
const RM_YES_PREFIX = 'character-alias::rm-yes::';
const RM_NO_PREFIX = 'character-alias::rm-no::';

function buildRemoveCustomId(
  prefix: string,
  page: number,
  filter: AliasFilter,
  query: string | null
): string {
  // Same segment shape as the factory's coords: {page}::{filter}::{query}.
  return `${prefix}${page}::${filter}::${query ?? ''}`;
}

function parseRemoveCustomId(
  customId: string,
  prefix: string
): { page: number; filter: AliasFilter; query: string | null } | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const [pageRaw, filterRaw, ...queryParts] = customId.slice(prefix.length).split('::');
  const page = Number.parseInt(pageRaw, 10);
  if (Number.isNaN(page) || !ALIAS_FILTERS.includes(filterRaw as AliasFilter)) {
    return null;
  }
  const query = queryParts.join('::');
  return { page, filter: filterRaw as AliasFilter, query: query === '' ? null : query };
}

const FILTER_TOGGLE_DISPLAY: Record<AliasFilter, { label: string; emoji: string }> = {
  all: { label: 'Filter: All', emoji: '📋' },
  mine: { label: 'Filter: Mine', emoji: '🔒' },
  global: { label: 'Filter: Global', emoji: '🌐' },
};

function scopeBadge(row: AliasRow): string {
  const base = row.scope === 'global' ? '🌐' : '🔒';
  return row.shadowed ? `${base}⚠️` : base;
}

interface BrowseCoords {
  page: number;
  filter: AliasFilter;
  /** The character slug coordinate; null = my-aliases mode. */
  query: string | null;
}

/** Payload every render produces; `content: ''` clears prior error text. */
interface BrowseRenderPayload {
  content: string;
  embeds: EmbedBuilder[];
  components: BrowseActionRow[];
}

/** Anything that can receive the rendered browse (context or interaction). */
interface EditReplyTarget {
  editReply: (options: BrowseRenderPayload) => Promise<unknown>;
}

/**
 * Render the browse at the given coordinates. `banner` is a one-line
 * post-action confirmation rendered above the list (e.g. after a remove).
 */
export async function renderAliasBrowse(
  target: EditReplyTarget,
  userClient: UserClient,
  coords: BrowseCoords,
  banner?: string
): Promise<void> {
  const { filter, query } = coords;
  const slug = query;

  const fetched = await fetchAliasRows(userClient, slug);
  if (!fetched.ok) {
    await target.editReply({
      content: describeAliasFailure(fetched.status, fetched.error),
      embeds: [],
      components: [],
    });
    return;
  }

  const filtered = applyFilter(fetched.data.rows, filter);
  const myMode = slug === null;

  const preamble: string[] = [];
  if (banner !== undefined) {
    preamble.push(banner, '');
  }
  if (!myMode) {
    preamble.push(
      `Aliases for **${escapeMarkdown(slug)}** — they resolve @mentions like the name.`
    );
  }

  const { embed, pageItems, startIndex, totalPages, safePage } = buildBrowseListEmbed<AliasRow>({
    entityEmoji: '🏷️',
    titleNoun: 'Aliases',
    items: filtered,
    page: coords.page,
    itemsPerPage: ITEMS_PER_PAGE,
    preamble,
    formatRow: row => ({
      badges: scopeBadge(row),
      name: `@${escapeMarkdown(row.alias)}`,
      metadata: myMode
        ? [`${row.character.name ?? row.character.slug} (${row.character.slug})`]
        : undefined,
    }),
    empty: {
      noItems: myMode
        ? 'You have no personal aliases yet — add one with `/character alias add`.'
        : 'No aliases you can see here — add one with `/character alias add`.',
      noMatch: 'No aliases match this filter — toggle it to see the rest.',
    },
    filterActive: filter !== 'all',
    footerSegments: [
      pluralize(filtered.length, { singular: 'alias', plural: 'aliases' }),
      filter !== 'all' &&
        formatFilterLabeled(FILTER_TOGGLE_DISPLAY[filter].label.replace('Filter: ', '')),
      fetched.data.truncated && 'list truncated',
    ],
    badgeLegend: myMode ? 'Global 🌐 · Personal 🔒 · Shadowed ⚠️' : 'Global 🌐 · Personal 🔒',
  });

  const components: BrowseActionRow[] = [];

  const selectRow = buildBrowseSelectMenu<AliasRow>({
    items: pageItems,
    customId: aliasHelpers.buildSelect(safePage, filter, 'name', query),
    placeholder: 'Select an alias to remove...',
    startIndex,
    formatItem: row => ({
      label: truncateForSelect(`@${row.alias}`),
      value: `${row.scope}:${row.alias.slice(0, SELECT_ALIAS_KEY_LENGTH)}`,
      description: truncateForSelect(
        row.scope === 'global'
          ? `Global · ${row.character.slug}`
          : `Personal · ${row.character.slug}`
      ),
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
  }

  const buttonRow = buildSimplePaginationButtons<AliasFilter>({
    currentPage: safePage,
    totalPages,
    filter,
    currentSort: 'name',
    query,
    buildCustomId: aliasHelpers.build,
    buildInfoId: aliasHelpers.buildInfo,
  });
  // The first in-place FILTER toggle (owner-adopted design affordance):
  // one Primary button whose customId is the same pagination coordinate
  // set with only the filter advanced — and the page reset to 0, since a
  // narrower filter renumbers the list.
  const toggleDisplay = FILTER_TOGGLE_DISPLAY[nextAliasFilter(filter)];
  buttonRow.addComponents(
    buildFilterToggleButton(
      toggleDisplay,
      aliasHelpers.build(0, nextAliasFilter(filter), 'name', query)
    )
  );
  components.push(buttonRow);

  await target.editReply({ content: '', embeds: [embed], components });
}

function buildFilterToggleButton(
  display: { label: string; emoji: string },
  customId: string
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(display.label)
    .setEmoji(display.emoji)
    .setStyle(ButtonStyle.Primary);
}

function describeAliasFailure(status: number, error: string): string {
  if (status === 400 || status === 409) {
    // Gateway rejection prose interpolates the user's own alias text —
    // escape before Discord renders it.
    return renderSpec(CATALOG.error.gatewayRejection(escapeMarkdown(error)));
  }
  if (status === 403) {
    return renderSpec(CATALOG.error.permissionDenied('manage aliases for this character'));
  }
  if (status === 404) {
    return renderSpec(CATALOG.error.notFound('Character or alias'));
  }
  return renderSpec(CATALOG.error.operationFailed('managing aliases'));
}

export { describeAliasFailure };

// ---------------------------------------------------------------------------
// Component handlers
// ---------------------------------------------------------------------------

/** Footer state format: `{scope}\n{slug}\n{alias}` — alias LAST, verbatim. */
function buildConfirmFooterState(scope: AliasScope, slug: string, alias: string): string {
  return `${scope}\n${slug}\n${alias}`;
}

function parseConfirmFooterState(
  footerText: string | undefined
): { scope: AliasScope; slug: string; alias: string } | null {
  if (footerText === undefined) {
    return null;
  }
  const firstBreak = footerText.indexOf('\n');
  const secondBreak = footerText.indexOf('\n', firstBreak + 1);
  if (firstBreak === -1 || secondBreak === -1) {
    return null;
  }
  const scope = footerText.slice(0, firstBreak);
  if (scope !== 'global' && scope !== 'user') {
    return null;
  }
  return {
    scope,
    slug: footerText.slice(firstBreak + 1, secondBreak),
    alias: footerText.slice(secondBreak + 1),
  };
}

/** Resolve a select value back to its row against a fresh fetch. */
function findRowByValue(rows: AliasRow[], value: string): AliasRow | null {
  const separator = value.indexOf(':');
  if (separator === -1) {
    return null;
  }
  const scope = value.slice(0, separator);
  const aliasKey = value.slice(separator + 1).toLowerCase();
  const inScope = rows.filter(row => row.scope === scope);
  // Exact match first; prefix fallback covers the 92-char truncation edge.
  return (
    inScope.find(row => row.alias.toLowerCase() === aliasKey) ??
    inScope.find(row => row.alias.toLowerCase().startsWith(aliasKey)) ??
    null
  );
}

async function handleAliasSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferUpdate();
  const coords = aliasHelpers.parseSelect(interaction.customId);
  if (coords === null) {
    await interaction.followUp({
      content: renderSpec(CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT)),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { userClient } = clientsFor(interaction);

  const fetched = await fetchAliasRows(userClient, coords.query);
  const row = fetched.ok ? findRowByValue(fetched.data.rows, interaction.values[0]) : null;
  if (row === null) {
    // The row vanished between render and click — re-render the truth.
    await renderAliasBrowse(interaction, userClient, coords);
    return;
  }

  const characterDisplay = row.character.name ?? row.character.slug;
  const scopeNote =
    row.scope === 'global'
      ? 'This global alias resolves for everyone.'
      : 'This personal alias only affects you.';
  const { embed, components } = buildConfirmAction({
    title: '🏷️ Remove Alias?',
    description: `Remove ${row.scope === 'global' ? '🌐' : '🔒'} \`@${escapeMarkdown(row.alias)}\` from **${escapeMarkdown(characterDisplay)}**?\n${scopeNote}`,
    confirmCustomId: buildRemoveCustomId(RM_YES_PREFIX, coords.page, coords.filter, coords.query),
    cancelCustomId: buildRemoveCustomId(RM_NO_PREFIX, coords.page, coords.filter, coords.query),
    confirmLabel: 'Remove Alias',
    confirmEmoji: '🗑️',
  });
  // Machine state for the confirm step (parsed back on the yes-click).
  embed.setFooter({ text: buildConfirmFooterState(row.scope, row.character.slug, row.alias) });

  await interaction.editReply({ content: '', embeds: [embed], components });
}

async function handleRemoveConfirm(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  const coords = parseRemoveCustomId(interaction.customId, RM_YES_PREFIX);
  const state = parseConfirmFooterState(interaction.message.embeds[0]?.footer?.text);
  const { userClient } = clientsFor(interaction);
  if (coords === null || state === null) {
    await interaction.followUp({
      content: renderSpec(CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT)),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await userClient.removePersonalityAlias(state.slug, state.alias, {
    scope: state.scope,
  });
  if (!result.ok) {
    await interaction.followUp({
      content: describeAliasFailure(result.status, result.error ?? 'Unknown'),
      flags: MessageFlags.Ephemeral,
    });
    await renderAliasBrowse(interaction, userClient, coords);
    return;
  }

  logger.info({ slug: state.slug, scope: state.scope }, 'Alias removed via browse');
  await renderAliasBrowse(
    interaction,
    userClient,
    coords,
    renderSpec(
      CATALOG.success.banner('Removed alias', `\`@${escapeMarkdown(result.data.removedAlias)}\``)
    )
  );
}

async function handleRemoveCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  const coords = parseRemoveCustomId(interaction.customId, RM_NO_PREFIX);
  if (coords === null) {
    await interaction.followUp({
      content: renderSpec(CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT)),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await renderAliasBrowse(interaction, clientsFor(interaction).userClient, coords);
}

async function handleAliasPagination(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  const coords = aliasHelpers.parse(interaction.customId);
  if (coords === null) {
    await interaction.followUp({
      content: renderSpec(CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT)),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await renderAliasBrowse(interaction, clientsFor(interaction).userClient, coords);
}

/** Claim predicate for the character command's interaction routing chain. */
export function isCharacterAliasInteraction(customId: string): boolean {
  return customId.startsWith('character-alias::');
}

/**
 * Declarative dispatch for every `character-alias::` interaction (browse
 * pagination + filter toggle, remove select, confirm/cancel buttons) — no
 * new hand-rolled prefix chain.
 */
export const aliasComponentRouter: ComponentRouter = createComponentRouter({
  routes: [
    { matches: id => id.startsWith(RM_YES_PREFIX), onButton: handleRemoveConfirm },
    { matches: id => id.startsWith(RM_NO_PREFIX), onButton: handleRemoveCancel },
    { matches: aliasHelpers.isBrowseSelect, onSelect: handleAliasSelect },
    { matches: aliasHelpers.isBrowse, onButton: handleAliasPagination },
  ],
});
