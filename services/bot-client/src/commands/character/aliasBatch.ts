/**
 * Character Alias Batch Flow ("Select several") — entry, pick, and cancel.
 *
 * Multi-select batch removal over `/character alias browse`: swap the current
 * page into multi-select mode, render the single-verb confirmation view, or
 * cancel back to the browse list. The confirm execution and outcome report
 * live in `aliasBatchConfirm.ts`.
 *
 * State channel:
 * - Return coordinates `{page}::{filter}::{query}` ride the `batch-select`,
 *   `batch-confirm`, and `batch-cancel` customIds.
 * - Selected option values (`{scope}:{aliasKey}`) ride the confirm embed's
 *   footer with minimal percent-escaping (`%` → `%25`, `\r` → `%0D`,
 *   `\n` → `%0A`) per id around the shared newline-delimited footer codec so
 *   aliases containing newlines round-trip without splitting or inflating
 *   non-ASCII text.
 */

import {
  escapeMarkdown,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { ENTITY_EMOJI } from '@tzurot/common-types/constants/uxVocabulary';
import type { AliasScope } from '@tzurot/common-types/schemas/api/personality';
import { clientsFor } from '../../utils/gatewayClients.js';
import { buildBrowseSelectMenu } from '../../utils/browse/selectMenuBuilder.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import {
  buildBatchModeRows,
  buildBatchConfirmView,
  clampBatchConfirmDescription,
  encodeBatchFooterIds,
  formatFallbackIdLabel,
  parseBatchFooterIds,
  readSelectOptionLabels,
  PAGE_FETCH_FAILED_COPY,
} from '../../utils/browse/multiSelectBatch.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { followUpSpec, ackUpdate } from '../../ux/render/reply.js';
import { applyFilter, fetchAliasRows, type AliasRow } from './aliasData.js';
import {
  BROWSE_COMMAND_HINT,
  CLEARED_RENDER_CONTENT,
  parseRemoveCustomId,
  renderAliasBrowse,
} from './aliasBrowse.js';
import {
  ALIAS_ITEMS_PER_PAGE,
  BATCH_SELECT_PREFIX,
  buildAliasListEmbed,
  buildRemoveCustomId,
  formatAliasSelectOption,
  type BrowseCoords,
} from './aliasBrowseView.js';

export const BATCH_CONFIRM_PREFIX = 'character-alias::batch-confirm::';
export const BATCH_CANCEL_PREFIX = 'character-alias::batch-cancel::';

/** Guard below Discord's 2048-char embed footer ceiling. */
export const MAX_BATCH_FOOTER_LENGTH = 1900;

export const SELECTION_TOO_LARGE_COPY =
  'That selection is too large to confirm. Unselect a few aliases and try again.';

/** Predicate for the batch-select toggle button and multi-select menu. */
export function isCharacterAliasBatchSelect(customId: string): boolean {
  return customId.startsWith(BATCH_SELECT_PREFIX);
}

/** Predicate for the batch-confirm button. */
export function isCharacterAliasBatchConfirm(customId: string): boolean {
  return customId.startsWith(BATCH_CONFIRM_PREFIX);
}

/** Predicate for the batch-cancel button. */
export function isCharacterAliasBatchCancel(customId: string): boolean {
  return customId.startsWith(BATCH_CANCEL_PREFIX);
}

/**
 * Wrap the shared newline-joined footer codec with the minimal per-id escape
 * (`%` → `%25`, `\r` → `%0D`, `\n` → `%0A`) so embedded newlines survive
 * splitting without inflating non-ASCII alias text.
 */
export function encodeAliasBatchFooterIds(ids: readonly string[]): string {
  return encodeBatchFooterIds(
    ids.map(id => id.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'))
  );
}

/**
 * Split the confirm footer via the shared codec and reverse the minimal
 * per-id escape in LAST-to-FIRST order (`%0D` → `\r`, `%0A` → `\n`, then
 * `%25` → `%`) so `%25` never un-escapes a literal `%0A`/`%0D` from the
 * original alias text.
 */
export function parseAliasBatchFooterIds(footerText: string | undefined): string[] | null {
  const encoded = parseBatchFooterIds(footerText);
  if (encoded === null) {
    return null;
  }
  try {
    const decoded = encoded
      .map(part => {
        if (/%(?!(?:25|0A|0D))/i.test(part)) {
          throw new URIError('Malformed footer escape');
        }
        return part.replace(/%0D/gi, '\r').replace(/%0A/gi, '\n').replace(/%25/g, '%');
      })
      .filter(part => part.length > 0);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/** Check whether an encoded footer exceeds the 1900-char guard. */
export function exceedsBatchFooterBudget(footerText: string): boolean {
  return footerText.length > MAX_BATCH_FOOTER_LENGTH;
}

export function fallbackAliasLabel(id: string): string {
  const parsed = parseSelectValueId(id);
  return parsed !== null
    ? truncateForSelect(`@${parsed.aliasKey}`, { stripNewlines: true })
    : formatFallbackIdLabel(id, 'Alias');
}

export function parseSelectValueId(id: string): { scope: AliasScope; aliasKey: string } | null {
  const separator = id.indexOf(':');
  if (separator === -1) {
    return null;
  }
  const scopeRaw = id.slice(0, separator);
  const aliasKey = id.slice(separator + 1);
  if ((scopeRaw !== 'global' && scopeRaw !== 'user') || aliasKey.length === 0) {
    return null;
  }
  return { scope: scopeRaw, aliasKey };
}

/** Swap-render components: the multi-select menu plus a Cancel button row. */
export function buildAliasBatchSelectComponents(
  items: AliasRow[],
  coords: BrowseCoords,
  startIndex = coords.page * ALIAS_ITEMS_PER_PAGE
): ReturnType<typeof buildBatchModeRows> {
  const selectRow = buildBrowseSelectMenu<AliasRow>({
    items,
    customId: buildRemoveCustomId(BATCH_SELECT_PREFIX, coords.page, coords.filter, coords.query),
    placeholder: 'Select several aliases to remove...',
    startIndex,
    maxValues: ALIAS_ITEMS_PER_PAGE,
    formatItem: formatAliasSelectOption,
  });
  const cancelCustomId = buildRemoveCustomId(
    BATCH_CANCEL_PREFIX,
    coords.page,
    coords.filter,
    coords.query
  );
  return buildBatchModeRows({ selectRow, cancelCustomId });
}

/**
 * "Select several" entry — re-fetch the page for the carried coords and swap
 * the browse view into multi-select mode without pagination buttons.
 */
export async function handleAliasBatchSelectEntry(interaction: ButtonInteraction): Promise<void> {
  await ackUpdate(interaction);

  const coords = parseRemoveCustomId(interaction.customId, BATCH_SELECT_PREFIX);
  if (coords === null) {
    await followUpSpec(interaction, CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT));
    return;
  }

  const { userClient } = clientsFor(interaction);
  const fetched = await fetchAliasRows(userClient, coords.query);
  if (!fetched.ok) {
    await followUpSpec(interaction, CATALOG.error.transient(PAGE_FETCH_FAILED_COPY));
    return;
  }

  const filtered = applyFilter(fetched.data.rows, coords.filter);
  const { embed, pageItems, startIndex, safePage } = buildAliasListEmbed({
    rows: filtered,
    truncated: fetched.data.truncated,
    coords,
  });
  const safeCoords: BrowseCoords = { page: safePage, filter: coords.filter, query: coords.query };

  // The cleared-content marker keeps the payload shape identical to
  // renderAliasBrowse's sibling render (it clears prior error text).
  await interaction.editReply({
    content: CLEARED_RENDER_CONTENT,
    embeds: [embed],
    components: buildAliasBatchSelectComponents(pageItems, safeCoords, startIndex),
  });
}

/**
 * Multi-select pick — build the single-verb batch confirmation view listing
 * every picked alias and storing minimally escaped option values in the footer.
 */
export async function handleAliasBatchPick(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  await ackUpdate(interaction);

  const coords = parseRemoveCustomId(interaction.customId, BATCH_SELECT_PREFIX);
  if (coords === null) {
    await followUpSpec(interaction, CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT));
    return;
  }

  const ids = interaction.values.filter(value => value.length > 0);
  if (ids.length === 0) {
    await followUpSpec(interaction, CATALOG.error.validation('No aliases were selected.'));
    return;
  }

  const footerText = encodeAliasBatchFooterIds(ids);
  if (exceedsBatchFooterBudget(footerText)) {
    await followUpSpec(interaction, CATALOG.error.validation(SELECTION_TOO_LARGE_COPY));
    return;
  }

  const labels = readSelectOptionLabels(interaction.message);
  const listing = ids
    .map(id => `• ${escapeMarkdown(labels.get(id) ?? fallbackAliasLabel(id))}`)
    .join('\n');
  const warning =
    `**This removes ${ids.length} ${ids.length === 1 ? 'alias' : 'aliases'} immediately.** ` +
    'Global aliases stop resolving for everyone; personal aliases only affect you.';

  const confirmCustomId = buildRemoveCustomId(
    BATCH_CONFIRM_PREFIX,
    coords.page,
    coords.filter,
    coords.query
  );
  const cancelCustomId = buildRemoveCustomId(
    BATCH_CANCEL_PREFIX,
    coords.page,
    coords.filter,
    coords.query
  );

  const { embed, components } = buildBatchConfirmView({
    title: `${ENTITY_EMOJI.alias} Remove Several Aliases?`,
    description: clampBatchConfirmDescription(listing, warning),
    footerText,
    confirm: { customId: confirmCustomId, label: `Remove (${ids.length})`, emoji: '🗑️' },
    cancelCustomId,
  });

  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Cancel from multi-select mode or the batch confirm view — return to the
 * normal browse render at the carried coordinates.
 */
export async function handleAliasBatchCancel(interaction: ButtonInteraction): Promise<void> {
  await ackUpdate(interaction);

  const coords = parseRemoveCustomId(interaction.customId, BATCH_CANCEL_PREFIX);
  if (coords === null) {
    await followUpSpec(interaction, CATALOG.progress.sessionExpired(BROWSE_COMMAND_HINT));
    return;
  }

  await renderAliasBrowse(interaction, clientsFor(interaction).userClient, coords);
}
