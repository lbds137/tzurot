/**
 * Memory Facts Browser (memory Phase 2 correction slice)
 *
 * /memory facts <character> — paginated list of the durable facts a character
 * has auto-learned about the user, with a select menu into the detail view
 * (Correct / Forget / Lock). Mirrors the episode browse router pattern:
 * state lives in a messageId-keyed dashboard session, no inline collectors.
 */

import {
  escapeMarkdown,
  MessageFlags,
  type ButtonInteraction,
  type EmbedBuilder,
} from 'discord.js';
import { memoryFactsOptions } from '@tzurot/common-types/generated/commandOptions';
import { ENTITY_EMOJI, buildBadgeLegend } from '@tzurot/common-types/constants/uxVocabulary';
import { AUTOCOMPLETE_BADGES } from '@tzurot/common-types/utils/autocompleteFormat';
import { formatDateShort, formatDiscordTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { getSessionManager } from '../../utils/dashboard/index.js';
import type { DashboardSession } from '../../utils/dashboard/types.js';
import {
  createBrowseCustomIdHelpers,
  buildBrowseButtons,
  buildBrowseListEmbed,
  buildBrowseSelectMenu,
  calculatePaginationState,
  pluralize,
  type BrowseActionRow,
} from '../../utils/browse/index.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';
import { truncateContent } from './formatters.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { fetchPageWithEmptyFallback } from './browseSession.js';
import { buildFactActionId } from './factsDetail.js';
import { fetchFacts, type FactItem } from './factsApi.js';
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('memory-facts-browse');

/** Items per page */
const FACTS_PER_PAGE = 10;

/**
 * One string, two roles: the customId prefix (componentPrefixes registration,
 * pagination ids) AND the dashboard-session entity type — the browse message
 * is the session's entity, so sharing the identifier keeps them in lockstep.
 */
export const FACT_BROWSE_PREFIX = 'memory-fact-browse';

/** Facts session — personality scope lives here (UUIDs don't fit customIds). */
export interface FactBrowseSession {
  personalityId: string;
  currentPage: number;
}

/** Browse customId helpers — filter slot unused (personality lives in session). */
export const factBrowseHelpers = createBrowseCustomIdHelpers<'all'>({
  prefix: FACT_BROWSE_PREFIX,
  validFilters: ['all'],
  includeSort: false,
});

/** Guard for pagination buttons (memory-fact-browse::browse::...). */
export function isFactBrowsePagination(customId: string): boolean {
  return factBrowseHelpers.isBrowse(customId);
}

async function findFactBrowseSession(
  messageId: string
): Promise<DashboardSession<FactBrowseSession> | null> {
  return getSessionManager().findByMessageId<FactBrowseSession>(messageId);
}

function buildFactsEmbed(options: {
  facts: FactItem[];
  total: number;
  page: number;
}): EmbedBuilder {
  const { facts, total, page } = options;

  // Server-paginated: `facts` is the fetched page; `total` drives the math.
  const { embed } = buildBrowseListEmbed<FactItem>({
    // §2.1: facts are a view of the memory entity — the title words carry
    // the view kind, the glyph stays the entity's.
    entityEmoji: ENTITY_EMOJI.memory,
    titleNoun: 'Known Facts',
    items: facts,
    page,
    itemsPerPage: FACTS_PER_PAGE,
    serverPage: { totalItems: total },
    formatRow: fact => ({
      // 🔐 LOCKED (protection) + 📝 CORRECTED (correction row — ✏️ is the
      // editable-by-you badge, a different concept).
      badges:
        `${fact.isLocked ? AUTOCOMPLETE_BADGES.LOCKED : ''}${fact.tier === 'corrected' ? AUTOCOMPLETE_BADGES.CORRECTED : ''}` ||
        undefined,
      name: '', // unused — nameMarkup below overrides it
      // Statements are sentences, not entity names — bolding whole
      // sentences makes rows shout, so override the bold-name default.
      nameMarkup: truncateContent(escapeMarkdown(fact.statement)),
      metadata: [formatDiscordTimestamp(fact.validFrom, 'D')],
    }),
    empty: {
      noItems:
        "This character hasn't learned any facts about you yet — facts are " +
        'distilled automatically from your conversations.',
    },
    footerSegments: [pluralize(total, { singular: 'fact', plural: 'facts' })],
    badgeLegend: buildBadgeLegend(['LOCKED', 'CORRECTED']),
  });

  return embed;
}

function buildFactsComponents(
  facts: FactItem[],
  page: number,
  totalPages: number
): BrowseActionRow[] {
  const selectRow = buildBrowseSelectMenu<FactItem>({
    items: facts,
    customId: buildFactActionId('select'),
    placeholder: 'Select a fact to manage...',
    startIndex: page * FACTS_PER_PAGE,
    formatItem: fact => ({
      label: `${fact.isLocked ? `${AUTOCOMPLETE_BADGES.LOCKED} ` : ''}${fact.statement}`,
      value: fact.id,
      // Select descriptions render no markdown — the date stays static text.
      description: formatDateShort(fact.validFrom),
    }),
  });
  if (selectRow === null) {
    return [];
  }

  return [
    selectRow,
    buildBrowseButtons({
      currentPage: page,
      totalPages,
      filter: 'all',
      currentSort: 'date',
      query: null,
      buildCustomId: factBrowseHelpers.build,
      buildInfoId: factBrowseHelpers.buildInfo,
    }),
  ];
}

/** Handle /memory facts <character> */
export async function handleFacts(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryFactsOptions(context.interaction);
  const personalityInput = options.character();

  try {
    // Contract: null means the helper already sent the error reply.
    const personalityId = await resolveRequiredPersonality(context, userClient, personalityInput);
    if (personalityId === null) {
      return;
    }

    const data = await fetchFacts(userClient, personalityId, 0, FACTS_PER_PAGE);
    if (data === null) {
      logger.warn({ userId }, 'Facts browse failed');
      await context.editReply({
        content: renderSpec(CATALOG.error.transient("Couldn't load the facts right now.")),
      });
      return;
    }

    const { totalPages } = calculatePaginationState(data.total, FACTS_PER_PAGE, 0);
    const embed = buildFactsEmbed({ facts: data.facts, total: data.total, page: 0 });
    const components = buildFactsComponents(data.facts, 0, totalPages);

    const response = await context.editReply({ embeds: [embed], components });

    await getSessionManager().set<FactBrowseSession>({
      userId,
      entityType: FACT_BROWSE_PREFIX,
      entityId: response.id,
      data: { personalityId, currentPage: 0 },
      messageId: response.id,
      channelId: response.channelId,
    });

    logger.info({ userId, total: data.total, personalityId }, 'Facts browse displayed');
  } catch (error) {
    logger.error({ err: error, userId }, 'Facts browse error');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'facts', { operation: 'read' })),
    });
  }
}

/** Pagination button handler. Ack-first; session carries the personality scope. */
export async function handleFactsPagination(interaction: ButtonInteraction): Promise<void> {
  const parsed = factBrowseHelpers.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  // Ephemeral deferral means only the invoker can click — no user check needed
  // (same reasoning as episode browse; revisit if deferral mode ever changes).
  await ackUpdate(interaction);

  const messageId = interaction.message.id;
  const session = await findFactBrowseSession(messageId);
  if (session === null) {
    await interaction.followUp({
      content: '⏰ This interaction has expired. Please run `/memory facts` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { personalityId } = session.data;
  const { userClient } = clientsFor(interaction);
  const data = await fetchFacts(
    userClient,
    personalityId,
    parsed.page * FACTS_PER_PAGE,
    FACTS_PER_PAGE
  );
  if (data === null) {
    await interaction.followUp({
      content: renderSpec(CATALOG.error.transient("Couldn't load that page right now.")),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { totalPages, safePage } = calculatePaginationState(
    data.total,
    FACTS_PER_PAGE,
    parsed.page
  );
  const embed = buildFactsEmbed({
    facts: data.facts,
    total: data.total,
    page: safePage,
  });
  await interaction.editReply({
    embeds: [embed],
    components: buildFactsComponents(data.facts, safePage, totalPages),
  });

  await updateFactSessionPage(interaction.user.id, messageId, safePage);
}

async function updateFactSessionPage(
  userId: string,
  messageId: string,
  newPage: number
): Promise<void> {
  const sessionManager = getSessionManager();
  const existing = await sessionManager.get<FactBrowseSession>(
    userId,
    FACT_BROWSE_PREFIX,
    messageId
  );
  if (existing === null) {
    return;
  }
  await sessionManager.update<FactBrowseSession>(userId, FACT_BROWSE_PREFIX, messageId, {
    ...existing.data,
    currentPage: newPage,
  });
}

/**
 * Refresh the list view — called after "back" from detail and after a forget.
 * Steps back a page when a forget empties the current one.
 */
export async function refreshFactsList(interaction: ButtonInteraction): Promise<void> {
  const messageId = interaction.message.id;
  const session = await findFactBrowseSession(messageId);
  if (session === null) {
    return;
  }

  const { personalityId } = session.data;
  const { userClient } = clientsFor(interaction);

  const result = await fetchPageWithEmptyFallback({
    currentPage: session.data.currentPage,
    fetchPage: page => fetchFacts(userClient, personalityId, page * FACTS_PER_PAGE, FACTS_PER_PAGE),
    isEmpty: d => d.facts.length === 0,
  });
  if (result === null) {
    return;
  }

  if (result.steppedBack) {
    await updateFactSessionPage(interaction.user.id, messageId, result.page);
  }

  const { totalPages } = calculatePaginationState(result.data.total, FACTS_PER_PAGE, result.page);
  const embed = buildFactsEmbed({
    facts: result.data.facts,
    total: result.data.total,
    page: result.page,
  });
  await interaction.editReply({
    embeds: [embed],
    components: buildFactsComponents(result.data.facts, result.page, totalPages),
  });
}
