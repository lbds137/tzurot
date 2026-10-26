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
 * applied to the filter field) + single-select remove with a Tier-A
 * confirm (multi-select batch removal lives in `aliasBatch.ts`, with
 * `batch-select`, `batch-confirm`, and `batch-cancel` routed in
 * `interactionRouting.ts` ahead of the `isCharacterAliasInteraction`
 * catch-all). Remove-confirm state (scope/slug/alias) rides the confirmation
 * embed's footer (newline-delimited, alias LAST so its text is verbatim) —
 * alias text can approach 100 chars, which no customId budget survives;
 * the shapes import-confirm footer is the in-repo precedent.
 */

import {
  escapeMarkdown,
  MessageFlags,
  type ButtonInteraction,
  type EmbedBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { AliasScope } from '@tzurot/common-types/schemas/api/personality';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import { ENTITY_EMOJI } from '@tzurot/common-types/constants/uxVocabulary';
import {
  ALIAS_FILTERS,
  applyFilter,
  fetchAliasRows,
  type AliasFilter,
  type AliasRow,
} from './aliasData.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import type { BrowseActionRow } from '../../utils/browse/types.js';
import { buildConfirmAction } from '../../utils/confirmation/confirmAction.js';
import { createComponentRouter, type ComponentRouter } from '../../utils/componentRouter.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import type { MessageSpec } from '../../ux/catalog/types.js';
import { renderSpec } from '../../ux/render/render.js';
import { ackUpdate } from '../../ux/render/reply.js';
import {
  aliasHelpers,
  buildAliasBrowseComponents,
  buildAliasListEmbed,
  buildRemoveCustomId,
  type BrowseCoords,
} from './aliasBrowseView.js';

const logger = createLogger('character-alias-browse');

/** Re-run hint for expired/unparseable component state. */
export const BROWSE_COMMAND_HINT = '/character alias browse';

/** The remove-confirm buttons carry the browse RETURN coordinates. */
const RM_YES_PREFIX = 'character-alias::rm-yes::';
const RM_NO_PREFIX = 'character-alias::rm-no::';

export function parseRemoveCustomId(
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

/** Payload every render produces; `content: ''` clears prior error text. */
interface BrowseRenderPayload {
  content: string;
  embeds: EmbedBuilder[];
  components: BrowseActionRow[];
}

/**
 * The cleared-content value every browse render sends (an empty string clears
 * prior error text on the message). Exported so sibling render sites share
 * the exact payload shape by name — the per-file raw-content budget counts
 * even an empty literal at a Discord content position, so the marker is
 * spelled once here and imported, never re-spelled per call site.
 */
export const CLEARED_RENDER_CONTENT = '';

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
  const fetched = await fetchAliasRows(userClient, coords.query);
  if (!fetched.ok) {
    await target.editReply({
      content: describeAliasFailure(fetched.status, fetched.error),
      embeds: [],
      components: [],
    });
    return;
  }

  const filtered = applyFilter(fetched.data.rows, coords.filter);
  const { embed, pageItems, startIndex, totalPages, safePage } = buildAliasListEmbed({
    rows: filtered,
    truncated: fetched.data.truncated,
    coords,
    banner,
  });
  const safeCoords: BrowseCoords = { page: safePage, filter: coords.filter, query: coords.query };
  const components = buildAliasBrowseComponents(pageItems, startIndex, totalPages, safeCoords);

  await target.editReply({ content: CLEARED_RENDER_CONTENT, embeds: [embed], components });
}

/**
 * Classify a gateway failure status into its catalog spec — no severity
 * glyph; the renderer adds it. Content consumers render the result via
 * {@link describeAliasFailure}; plain-text consumers (a note that renders
 * under another glyph, e.g. a batch result line) read `.text` directly.
 */
export function aliasFailureSpec(status: number, error: string): MessageSpec {
  if (status === 400 || status === 409) {
    // Gateway rejection prose interpolates the user's own alias text —
    // escape before Discord renders it.
    return CATALOG.error.gatewayRejection(escapeMarkdown(error));
  }
  if (status === 403) {
    return CATALOG.error.permissionDenied('manage aliases for this character');
  }
  if (status === 404) {
    return CATALOG.error.notFound('Character or alias');
  }
  return CATALOG.error.operationFailed('manage aliases');
}

export function describeAliasFailure(status: number, error: string): string {
  return renderSpec(aliasFailureSpec(status, error));
}

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

/**
 * Resolve a select value back to its row against a fresh fetch.
 *
 * The `startsWith` prefix fallback is a deliberate divergence from the batch
 * path: this flow's confirm embed shows the resolved full alias before the
 * user commits (that confirm is the safety net), while the batch path has no
 * per-item confirm and fails closed on ambiguous boundary keys instead — see
 * `resolveAliasBatchItems` in aliasBatchConfirm.ts.
 */
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
  await ackUpdate(interaction);
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
    title: `${ENTITY_EMOJI.alias} Remove Alias?`,
    description: `Remove ${row.scope === 'global' ? AUTOCOMPLETE_BADGES.GLOBAL : AUTOCOMPLETE_BADGES.OWNED} \`@${escapeMarkdown(row.alias)}\` from **${escapeMarkdown(characterDisplay)}**?\n${scopeNote}`,
    confirmCustomId: buildRemoveCustomId(RM_YES_PREFIX, coords.page, coords.filter, coords.query),
    cancelCustomId: buildRemoveCustomId(RM_NO_PREFIX, coords.page, coords.filter, coords.query),
    confirmLabel: 'Remove Alias',
    confirmEmoji: '🗑️',
  });
  // Machine state for the confirm step (parsed back on the yes-click).
  embed.setFooter({ text: buildConfirmFooterState(row.scope, row.character.slug, row.alias) });

  await interaction.editReply({ content: CLEARED_RENDER_CONTENT, embeds: [embed], components });
}

async function handleRemoveConfirm(interaction: ButtonInteraction): Promise<void> {
  await ackUpdate(interaction);
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
  await ackUpdate(interaction);
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
  await ackUpdate(interaction);
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
 * Declarative dispatch for the single-pick `character-alias::` family
 * (browse pagination + filter toggle, single-remove select, `rm-yes`/`rm-no`
 * confirm/cancel buttons). The `batch-select`, `batch-confirm`, and
 * `batch-cancel` routes live in `interactionRouting.ts` ahead of the
 * `isCharacterAliasInteraction` catch-all.
 */
export const aliasComponentRouter: ComponentRouter = createComponentRouter({
  routes: [
    { matches: id => id.startsWith(RM_YES_PREFIX), onButton: handleRemoveConfirm },
    { matches: id => id.startsWith(RM_NO_PREFIX), onButton: handleRemoveCancel },
    { matches: aliasHelpers.isBrowseSelect, onSelect: handleAliasSelect },
    { matches: aliasHelpers.isBrowse, onButton: handleAliasPagination },
  ],
});
