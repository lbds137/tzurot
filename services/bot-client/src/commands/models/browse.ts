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

const browseHelpers = createBrowseCustomIdHelpers<CapabilityFilter>({
  prefix: 'models',
  validFilters: VALID_FILTERS,
  includeSort: false,
});

export function isModelsBrowseInteraction(customId: string): boolean {
  return browseHelpers.isBrowse(customId);
}

export function isModelsBrowseSelectInteraction(customId: string): boolean {
  return browseHelpers.isBrowseSelect(customId);
}

/** Usable-first, then alphabetical by name. */
function compareModels(a: UsableCatalogModel, b: UsableCatalogModel): number {
  if (a.canUse !== b.canUse) {
    return a.canUse ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
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
  search: string | null;
  capped: boolean;
}

function buildBrowseEmbed(view: BrowseView, pageItems: UsableCatalogModel[]): EmbedBuilder {
  const { items, page, capability, search, capped } = view;
  const startIdx = page * MODELS_PER_PAGE;

  const lines: string[] = [];
  if (search !== null || capability !== 'all') {
    const filterBits = [
      capability !== 'all' ? `capability: ${capability}` : '',
      search !== null ? `search: "${search}"` : '',
    ].filter(Boolean);
    lines.push(`_Filters — ${filterBits.join(', ')}_`);
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
  const { page, capability, search } = view;
  const startIdx = page * MODELS_PER_PAGE;
  const components: BrowseActionRow[] = [];

  const selectRow = buildBrowseSelectMenu<UsableCatalogModel>({
    items: pageItems,
    customId: browseHelpers.buildSelect(page, capability, 'name', search),
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
        currentSort: 'name',
        query: search,
        buildCustomId: browseHelpers.build,
        buildInfoId: browseHelpers.buildInfo,
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
  search: string | null
): Promise<UsableCatalogModel[]> {
  const { userClient } = clientsFor(interaction);
  const [catalog, walletResult] = await Promise.all([
    fetchModelCatalog({ capability, search: search ?? undefined, limit: BROWSE_FETCH_LIMIT }),
    userClient.listWalletKeys(),
  ]);
  const activeProviders = new Set(
    walletResult.ok ? walletResult.data.keys.filter(k => k.isActive).map(k => k.provider) : []
  );
  return annotateUsability(catalog, activeProviders).sort(compareModels);
}

/**
 * Handle /models browse
 */
export async function handleBrowse(context: DeferredCommandContext): Promise<void> {
  const options = modelsBrowseOptions(context.interaction);
  const capability = (options.capability() ?? 'all') as CapabilityFilter;
  const search = options.search();

  try {
    const models = await loadAnnotatedModels(context.interaction, capability, search);
    const { embed, components } = buildBrowsePage({
      items: models,
      page: 0,
      capability,
      search,
      capped: models.length >= BROWSE_FETCH_LIMIT,
    });
    await context.editReply({ embeds: [embed], components });
    logger.info({ count: models.length, capability, search }, 'Browse models');
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
    const models = await loadAnnotatedModels(interaction, parsed.filter, parsed.query);
    const { embed, components } = buildBrowsePage({
      items: models,
      page: parsed.page,
      capability: parsed.filter,
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
