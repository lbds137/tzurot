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
  EmbedBuilder,
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { modelsBrowseOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { type ClientCarryingInteraction, clientsFor } from '../../utils/gatewayClients.js';
import {
  buildBrowseButtons,
  buildBrowseSelectMenu,
  createBrowseCustomIdHelpers,
  joinFooter,
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
    return '🆓';
  }
  if (model.usability === 'unknown') {
    return '❔';
  }
  return model.canUse ? '✅' : '🔒';
}

/** A single description line for a model in the browse list. */
function formatModelLine(model: BrowseModel, displayIndex: number): string {
  const badges = [
    model.isGlobalPreset ? '📌' : '',
    model.isRouter === true ? '🔀' : '',
    model.isZaiCoding ? '⚡' : '',
    model.supportsVision ? '👁️' : '',
    model.supportsImageGeneration ? '🎨' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const badgeSuffix = badges.length > 0 ? ` ${badges}` : '';
  return (
    `**${displayIndex}.** ${usabilityIcon(model)} ${model.name}${badgeSuffix}\n` +
    `   └ \`${model.id}\` • ${formatContextLength(model.contextLength)}`
  );
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

function buildBrowseEmbed(view: BrowseView, pageItems: BrowseModel[]): EmbedBuilder {
  const { items, page, capability, sort, query, capped } = view;
  const startIdx = page * MODELS_PER_PAGE;

  const lines: string[] = [];
  const filterBits = [
    capability !== 'all' ? `capability: ${capability}` : '',
    query !== null ? `query: "${query}"` : '',
    `sorted: ${ACTIVE_SORT_LABEL[sort]}`,
  ].filter(Boolean);
  lines.push(`_${filterBits.join(' · ')}_`);
  // When the wallet fetch failed, every non-free model is `unknown` — explain
  // the ❔ rather than leaving the user guessing why nothing shows ✅/🔒.
  if (items.some(m => m.usability === 'unknown')) {
    lines.push(
      "⚠️ _Couldn't verify your API keys right now — usability shown as ❔. Try again shortly._"
    );
  }
  if (items.length === 0) {
    lines.push('_No models match your filters._');
  } else {
    lines.push(...pageItems.map((m, i) => formatModelLine(m, startIdx + i + 1)));
  }

  const embed = new EmbedBuilder()
    .setTitle('🤖 Model Browser')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  embed.setFooter({
    text: joinFooter(
      pluralize(items.length, { singular: 'model', plural: 'models' }),
      capped && `first ${BROWSE_FETCH_LIMIT} — refine with a query for more`,
      '🆓 free  ✅ you can use  🔒 needs a key  ❔ unverified  📌 global preset  🔀 router  ⚡ z.ai'
    ),
  });
  return embed;
}

function buildBrowseComponents(
  view: BrowseView,
  pageItems: BrowseModel[],
  totalPages: number
): BrowseActionRow[] {
  const { page, capability, sort, query } = view;
  const startIdx = page * MODELS_PER_PAGE;
  const components: BrowseActionRow[] = [];

  const selectRow = buildBrowseSelectMenu<BrowseModel>({
    items: pageItems,
    customId: browseHelpers.buildSelect(page, capability, sort, query),
    placeholder: 'Select a model to view its card...',
    startIndex: startIdx,
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
  const totalPages = Math.max(1, Math.ceil(view.items.length / MODELS_PER_PAGE));
  const safePage = Math.min(Math.max(0, view.page), totalPages - 1);
  const startIdx = safePage * MODELS_PER_PAGE;
  const pageItems = view.items.slice(startIdx, startIdx + MODELS_PER_PAGE);
  const safeView: BrowseView = { ...view, page: safePage };
  return {
    embed: buildBrowseEmbed(safeView, pageItems),
    components: buildBrowseComponents(safeView, pageItems, totalPages),
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
  await interaction.deferUpdate();
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
  await interaction.deferUpdate();
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
