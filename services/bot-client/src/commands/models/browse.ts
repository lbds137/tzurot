/**
 * Models Browse Handler
 *
 * `/models browse [capability?] [query?]` — paginated, user-aware list of
 * models. Selecting one opens its detail card. Filtering (capability + query)
 * is applied at fetch time; the customId encodes capability (as the browse
 * "filter") + query + page so pagination can rebuild the
 * same view statelessly.
 */

import {
  MessageFlags,
  escapeMarkdown,
  type EmbedBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { modelsBrowseOptions } from '@tzurot/common-types/generated/commandOptions';
import { ENTITY_EMOJI, buildBadgeLegend } from '@tzurot/common-types/constants/uxVocabulary';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { type ClientCarryingInteraction, clientsFor } from '../../utils/gatewayClients.js';
import {
  buildBrowseButtons,
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  createBrowseCustomIdHelpers,
  pluralize,
  type BrowseActionRow,
  type BrowseSortToggle,
} from '../../utils/browse/index.js';
import { formatContextLength } from '../../utils/modelAutocomplete.js';
import {
  fetchModelCatalog,
  fetchCatalogModelById,
  annotateUsability,
  type CapabilityFilter,
  type UsableCatalogModel,
} from '../../utils/modelCatalog.js';
import { buildModelCard } from './card.js';
import { getActiveProviders, getGlobalPresetModelIds } from './browseUserCache.js';
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('models-browse');

/** Models per page. Discord select menus cap at 25 options. */
const MODELS_PER_PAGE = 20;

/**
 * How many models to fetch for browse. High enough for the whole catalog
 * (~340 + the z.ai entries); the footer flags it only in the unlikely event
 * the catalog ever outgrows this ceiling.
 */
const BROWSE_FETCH_LIMIT = 1000;

const VALID_FILTERS: readonly CapabilityFilter[] = ['all', 'text', 'vision', 'image-gen'];

/** Sort modes for `/models browse`, cycled by the toggle button. */
type ModelSort = 'default' | 'price' | 'recent';
const VALID_SORTS: readonly ModelSort[] = ['default', 'price', 'recent'];

/** Button label + emoji per sort (shown for the sort you'd switch TO). */
const SORT_DISPLAY: Record<ModelSort, { label: string; emoji: string }> = {
  default: { label: 'Sort: usable first', emoji: '🔀' },
  price: { label: 'Sort: cheapest', emoji: '💰' },
  recent: { label: 'Sort: newest', emoji: '🆕' },
};

/** Cycle default → price → recent → default. */
const sortToggle: BrowseSortToggle<ModelSort> = {
  next: current => (current === 'default' ? 'price' : current === 'price' ? 'recent' : 'default'),
  labelFor: sort => SORT_DISPLAY[sort],
};

const browseHelpers = createBrowseCustomIdHelpers<CapabilityFilter, ModelSort>({
  prefix: 'models',
  validFilters: VALID_FILTERS,
  validSorts: VALID_SORTS,
});

export function isModelsBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

export function isModelsBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/**
 * A catalog model annotated for the browse list. `isGlobalPreset` flags models
 * used by one of Tzurot's global presets — these pin to the top of every sort.
 */
type BrowseModel = UsableCatalogModel & { isGlobalPreset: boolean };

/** Price rank for the `price` sort: free/cheapest first, no-$ (z.ai/router) last. */
function priceRank(model: UsableCatalogModel): number {
  return model.hasPricing ? model.promptPricePerMillion : Number.POSITIVE_INFINITY;
}

/** Sort the annotated models by the active sort mode (stable, name tie-break). */
function sortModels<T extends UsableCatalogModel>(models: T[], sort: ModelSort): T[] {
  const byName = (a: T, b: T): number => a.name.localeCompare(b.name);
  if (sort === 'price') {
    return [...models].sort((a, b) => priceRank(a) - priceRank(b) || byName(a, b));
  }
  if (sort === 'recent') {
    // Newest first; models without a `created` timestamp (z.ai-catalog-only) last.
    const at = (m: T): number => m.created ?? Number.NEGATIVE_INFINITY;
    return [...models].sort((a, b) => at(b) - at(a) || byName(a, b));
  }
  // default: usable-first, then alphabetical.
  return [...models].sort((a, b) => (a.canUse === b.canUse ? byName(a, b) : a.canUse ? -1 : 1));
}

/**
 * Two-tier sort: global-preset models first, the rest after — with the active
 * sort applied independently WITHIN each tier (per product spec). With no
 * pinned models this collapses to a plain `sortModels`.
 */
function sortModelsPinned(models: BrowseModel[], sort: ModelSort): BrowseModel[] {
  const pinned: BrowseModel[] = [];
  const rest: BrowseModel[] = [];
  for (const m of models) {
    (m.isGlobalPreset ? pinned : rest).push(m);
  }
  return [...sortModels(pinned, sort), ...sortModels(rest, sort)];
}

/** Per-model usability marker for the list/select. */
function usabilityIcon(model: UsableCatalogModel): string {
  if (model.usability === 'free') {
    return AUTOCOMPLETE_BADGES.FREE;
  }
  if (model.usability === 'unknown') {
    return AUTOCOMPLETE_BADGES.UNVERIFIED;
  }
  // 🔑 NEEDS_KEY (add your own key to use) — 🔒 is the private-visibility
  // badge and doesn't apply to catalog models.
  return model.canUse ? AUTOCOMPLETE_BADGES.ACTIVE : AUTOCOMPLETE_BADGES.NEEDS_KEY;
}

/** Badge glyph run for a model row: usability first, then features (§2.2). */
function modelBadges(model: BrowseModel): string {
  return [
    usabilityIcon(model),
    // 🌐 GLOBAL — the model backs a global preset (📌 retired; "pinned" is
    // the sort behavior, the badge names the reason).
    model.isGlobalPreset ? AUTOCOMPLETE_BADGES.GLOBAL : '',
    model.isRouter === true ? AUTOCOMPLETE_BADGES.ROUTER : '',
    model.isZaiCoding ? AUTOCOMPLETE_BADGES.ZAI_CODING : '',
    model.supportsVision ? AUTOCOMPLETE_BADGES.VISION : '',
    model.supportsImageGeneration ? AUTOCOMPLETE_BADGES.IMAGE_GEN : '',
  ]
    .filter(Boolean)
    .join(' ');
}

interface BrowseView {
  items: BrowseModel[];
  page: number;
  capability: CapabilityFilter;
  sort: ModelSort;
  query: string | null;
  capped: boolean;
}

/** Human label for the currently-active sort (shown in the embed). */
const ACTIVE_SORT_LABEL: Record<ModelSort, string> = {
  default: 'usable first',
  price: 'cheapest first',
  recent: 'newest first',
};

function buildBrowseComponents(
  view: BrowseView,
  pageItems: BrowseModel[],
  startIndex: number,
  totalPages: number
): BrowseActionRow[] {
  const { page, capability, sort, query } = view;
  const components: BrowseActionRow[] = [];

  const selectRow = buildBrowseSelectMenu<BrowseModel>({
    items: pageItems,
    customId: browseHelpers.buildSelect(page, capability, sort, query),
    placeholder: 'Select a model to view its card...',
    startIndex,
    formatItem: model => ({
      label: `${usabilityIcon(model)} ${model.name}`,
      value: model.id,
      description: model.id,
    }),
  });
  if (selectRow !== null) {
    components.push(selectRow);
  }

  if (totalPages > 1 || view.items.length > 0) {
    components.push(
      buildBrowseButtons({
        currentPage: page,
        totalPages,
        filter: capability,
        currentSort: sort,
        query,
        buildCustomId: browseHelpers.build,
        buildInfoId: browseHelpers.buildInfo,
        sortToggle,
      })
    );
  }
  return components;
}

function buildBrowsePage(view: BrowseView): { embed: EmbedBuilder; components: BrowseActionRow[] } {
  const preamble: string[] = [];
  const filterBits = [
    view.capability !== 'all' ? `capability: ${view.capability}` : '',
    view.query !== null ? `query: "${view.query}"` : '',
    `sorted: ${ACTIVE_SORT_LABEL[view.sort]}`,
  ].filter(Boolean);
  preamble.push(`_${filterBits.join(' · ')}_`);
  // When the wallet fetch failed, every non-free model is `unknown` — explain
  // the ❔ rather than leaving the user guessing why nothing shows ✅/🔑.
  if (view.items.some(m => m.usability === 'unknown')) {
    preamble.push(
      `⚠️ _Couldn't verify your API keys right now — usability shown as ${AUTOCOMPLETE_BADGES.UNVERIFIED}. Try again shortly._`
    );
  }

  const { embed, pageItems, startIndex, totalPages, safePage } = buildBrowseListEmbed<BrowseModel>({
    entityEmoji: ENTITY_EMOJI.model,
    titleNoun: 'Models',
    items: view.items,
    page: view.page,
    itemsPerPage: MODELS_PER_PAGE,
    formatRow: model => ({
      badges: modelBadges(model),
      name: escapeMarkdown(model.name),
      // Model ids are what users type in preset/override model fields.
      techId: model.id,
      metadata: [formatContextLength(model.contextLength)],
    }),
    preamble,
    empty: {
      noItems: 'No models found — the catalog may be temporarily unavailable.',
      noMatch: 'No models match your filters — clear the query or capability to see more.',
    },
    filterActive: view.capability !== 'all' || view.query !== null,
    footerSegments: [
      pluralize(view.items.length, { singular: 'model', plural: 'models' }),
      view.capped && `first ${BROWSE_FETCH_LIMIT} — refine with a query for more`,
    ],
    badgeLegend: buildBadgeLegend([
      'FREE',
      { key: 'ACTIVE', word: 'Usable' },
      'NEEDS_KEY',
      'UNVERIFIED',
      { key: 'GLOBAL', word: 'Global preset' },
      'ROUTER',
      'ZAI_CODING',
      'VISION',
      'IMAGE_GEN',
    ]),
  });

  const safeView: BrowseView = { ...view, page: safePage };
  return {
    embed,
    components: buildBrowseComponents(safeView, pageItems, startIndex, totalPages),
  };
}

/**
 * Fetch the merged catalog + the user's active key providers + the global
 * presets, then annotate usability, flag global-preset models, and apply the
 * pinned two-tier sort. All three reads run concurrently; the wallet + preset
 * reads are short-TTL cached (see `browseUserCache`) so paging doesn't re-hit
 * the gateway every press. A failed WALLET read yields `null` providers →
 * non-free models render `unknown` (❔), not a false "needs a key"; a failed
 * PRESET read degrades to no pinning. Neither fails the browse.
 */
async function loadAnnotatedModels(
  interaction: ClientCarryingInteraction,
  capability: CapabilityFilter,
  query: string | null,
  sort: ModelSort
): Promise<BrowseModel[]> {
  const { userClient } = clientsFor(interaction);
  const [catalog, activeProviders, globalPresetModelIds] = await Promise.all([
    fetchModelCatalog({ capability, search: query ?? undefined, limit: BROWSE_FETCH_LIMIT }),
    getActiveProviders(userClient, interaction.user.id),
    getGlobalPresetModelIds(userClient),
  ]);
  const annotated = annotateUsability(catalog, activeProviders).map<BrowseModel>(m => ({
    ...m,
    isGlobalPreset: globalPresetModelIds.has(m.id.toLowerCase()),
  }));
  return sortModelsPinned(annotated, sort);
}

/**
 * Handle /models browse
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const options = modelsBrowseOptions(context.interaction);
  const capability = (options.capability() ?? 'all') as CapabilityFilter;
  const query = options.query();
  const sort: ModelSort = 'default';

  try {
    const models = await loadAnnotatedModels(context.interaction, capability, query, sort);
    const { embed, components } = buildBrowsePage({
      items: models,
      page: 0,
      capability,
      sort,
      query,
      capped: models.length >= BROWSE_FETCH_LIMIT,
    });
    await context.editReply({ embeds: [embed], components });
    logger.info({ count: models.length, capability, query, sort }, 'Browse models');
  } catch (error) {
    logger.error({ err: error }, 'Failed to browse models');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'models', { operation: 'read' }))
    );
  }
}

/**
 * Handle browse pagination button clicks.
 */
export async function handleBrowsePagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = browseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }
  await ackUpdate(interaction);
  try {
    const models = await loadAnnotatedModels(interaction, parsed.filter, parsed.query, parsed.sort);
    const { embed, components } = buildBrowsePage({
      items: models,
      page: parsed.page,
      capability: parsed.filter,
      sort: parsed.sort,
      query: parsed.query,
      capped: models.length >= BROWSE_FETCH_LIMIT,
    });
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, ...parsed }, 'Failed to load model browse page');
    await interaction.followUp({
      content: renderSpec(classifyGatewayFailure(error, 'page', { operation: 'read' })),
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle browse select — render the chosen model's card.
 */
export async function handleBrowseSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const modelId = interaction.values[0];
  await ackUpdate(interaction);
  try {
    const { userClient } = clientsFor(interaction);
    const [model, activeProviders] = await Promise.all([
      fetchCatalogModelById(modelId),
      getActiveProviders(userClient, interaction.user.id),
    ]);
    if (model === null) {
      await interaction.followUp({
        content: renderSpec(CATALOG.error.notFound('Model', { name: escapeMarkdown(modelId) })),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // activeProviders === null = wallet fetch failed → card shows 'unknown'
    // (❔) rather than a false "needs key".
    const [annotated] = annotateUsability([model], activeProviders);
    await interaction.followUp({
      embeds: [buildModelCard(annotated)],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error({ err: error, modelId }, 'Failed to render model card from browse');
    await interaction.followUp({
      content: renderSpec(classifyGatewayFailure(error, 'model', { operation: 'read' })),
      flags: MessageFlags.Ephemeral,
    });
  }
}
