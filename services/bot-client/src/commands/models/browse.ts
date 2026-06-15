/**
 * Models Browse Handler
 *
 * `/models browse [capability?] [search?]` — paginated, user-aware list of
 * models. Selecting one opens its detail card. Filtering (capability + search)
 * is applied at fetch time; the customId encodes capability (as the browse
 * "filter") + search (as the "query") + page so pagination can rebuild the
 * same view statelessly.
 */

import {
  EmbedBuilder,
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger, DISCORD_COLORS, modelsBrowseOptions } from '@tzurot/common-types';
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

/** Price rank for the `price` sort: free/cheapest first, no-$ (z.ai/router) last. */
function priceRank(model: UsableCatalogModel): number {
  return model.hasPricing ? model.promptPricePerMillion : Number.POSITIVE_INFINITY;
}

/** Sort the annotated models by the active sort mode (stable, name tie-break). */
function sortModels(models: UsableCatalogModel[], sort: ModelSort): UsableCatalogModel[] {
  const byName = (a: UsableCatalogModel, b: UsableCatalogModel): number =>
    a.name.localeCompare(b.name);
  if (sort === 'price') {
    return [...models].sort((a, b) => priceRank(a) - priceRank(b) || byName(a, b));
  }
  if (sort === 'recent') {
    // Newest first; models without a `created` timestamp (z.ai-catalog-only) last.
    const at = (m: UsableCatalogModel): number => m.created ?? Number.NEGATIVE_INFINITY;
    return [...models].sort((a, b) => at(b) - at(a) || byName(a, b));
  }
  // default: usable-first, then alphabetical.
  return [...models].sort((a, b) => (a.canUse === b.canUse ? byName(a, b) : a.canUse ? -1 : 1));
}

/** Per-model usability marker for the list/select. */
function usabilityIcon(model: UsableCatalogModel): string {
  if (model.usability === 'free') {
    return '🆓';
  }
  return model.canUse ? '✅' : '🔒';
}

/** A single description line for a model in the browse list. */
function formatModelLine(model: UsableCatalogModel, displayIndex: number): string {
  const zai = model.isZaiCoding ? ' ⚡' : '';
  const caps = [model.supportsVision ? '👁️' : '', model.supportsImageGeneration ? '🎨' : '']
    .filter(Boolean)
    .join('');
  const capsSuffix = caps.length > 0 ? ` ${caps}` : '';
  return (
    `**${displayIndex}.** ${usabilityIcon(model)} ${model.name}${zai}${capsSuffix}\n` +
    `   └ \`${model.id}\` • ${formatContextLength(model.contextLength)}`
  );
}

interface BrowseView {
  items: UsableCatalogModel[];
  page: number;
  capability: CapabilityFilter;
  sort: ModelSort;
  search: string | null;
  capped: boolean;
}

/** Human label for the currently-active sort (shown in the embed). */
const ACTIVE_SORT_LABEL: Record<ModelSort, string> = {
  default: 'usable first',
  price: 'cheapest first',
  recent: 'newest first',
};

function buildBrowseEmbed(view: BrowseView, pageItems: UsableCatalogModel[]): EmbedBuilder {
  const { items, page, capability, sort, search, capped } = view;
  const startIdx = page * MODELS_PER_PAGE;

  const lines: string[] = [];
  const filterBits = [
    capability !== 'all' ? `capability: ${capability}` : '',
    search !== null ? `search: "${search}"` : '',
    `sorted: ${ACTIVE_SORT_LABEL[sort]}`,
  ].filter(Boolean);
  lines.push(`_${filterBits.join(' · ')}_`);
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
      capped && `first ${BROWSE_FETCH_LIMIT} — refine with search for more`,
      '🆓 free  ✅ you can use  🔒 needs a key  ⚡ z.ai'
    ),
  });
  return embed;
}

function buildBrowseComponents(
  view: BrowseView,
  pageItems: UsableCatalogModel[],
  totalPages: number
): BrowseActionRow[] {
  const { page, capability, sort, search } = view;
  const startIdx = page * MODELS_PER_PAGE;
  const components: BrowseActionRow[] = [];

  const selectRow = buildBrowseSelectMenu<UsableCatalogModel>({
    items: pageItems,
    customId: browseHelpers.buildSelect(page, capability, sort, search),
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
        query: search,
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

/** Fetch the merged catalog + the user's active key providers, then annotate + sort. */
async function loadAnnotatedModels(
  interaction: ClientCarryingInteraction,
  capability: CapabilityFilter,
  search: string | null,
  sort: ModelSort
): Promise<UsableCatalogModel[]> {
  const { userClient } = clientsFor(interaction);
  const [catalog, walletResult] = await Promise.all([
    fetchModelCatalog({ capability, search: search ?? undefined, limit: BROWSE_FETCH_LIMIT }),
    userClient.listWalletKeys(),
  ]);
  const activeProviders = new Set(
    walletResult.ok ? walletResult.data.keys.filter(k => k.isActive).map(k => k.provider) : []
  );
  return sortModels(annotateUsability(catalog, activeProviders), sort);
}

/**
 * Handle /models browse
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const options = modelsBrowseOptions(context.interaction);
  const capability = (options.capability() ?? 'all') as CapabilityFilter;
  const search = options.search();
  const sort: ModelSort = 'default';

  try {
    const models = await loadAnnotatedModels(context.interaction, capability, search, sort);
    const { embed, components } = buildBrowsePage({
      items: models,
      page: 0,
      capability,
      sort,
      search,
      capped: models.length >= BROWSE_FETCH_LIMIT,
    });
    await context.editReply({ embeds: [embed], components });
    logger.info({ count: models.length, capability, search, sort }, 'Browse models');
  } catch (error) {
    logger.error({ err: error }, 'Failed to browse models');
    await context.editReply('❌ Failed to load models. Please try again.');
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
      search: parsed.query,
      capped: models.length >= BROWSE_FETCH_LIMIT,
    });
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, ...parsed }, 'Failed to load model browse page');
    await interaction.followUp({
      content: '❌ Failed to load that page. Please try again.',
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
    const [model, walletResult] = await Promise.all([
      fetchCatalogModelById(modelId),
      userClient.listWalletKeys(),
    ]);
    if (model === null) {
      await interaction.followUp({
        content: `❌ Model \`${escapeMarkdown(modelId)}\` not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const activeProviders = new Set(
      walletResult.ok ? walletResult.data.keys.filter(k => k.isActive).map(k => k.provider) : []
    );
    const [annotated] = annotateUsability([model], activeProviders);
    await interaction.followUp({
      embeds: [buildModelCard(annotated)],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error({ err: error, modelId }, 'Failed to render model card from browse');
    await interaction.followUp({
      content: '❌ Failed to load that model.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
