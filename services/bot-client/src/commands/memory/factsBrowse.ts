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
  type BrowseSelectOption,
} from '../../utils/browse/index.js';
import {
  PAGE_FETCH_FAILED_COPY,
  buildSelectSeveralToggleRow,
} from '../../utils/browse/multiSelectBatch.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';
import { truncateContent } from './formatters.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { fetchPageWithEmptyFallback } from './browseSession.js';
import { buildFactActionId } from './factsDetail.js';
import { fetchFacts, type FactItem, type FactListResponse } from './factsApi.js';
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('memory-facts-browse');

/** Items per page */
export const FACTS_PER_PAGE = 10;

/** Shared expiry copy for interactions whose dashboard session is gone. */
export const FACTS_SESSION_EXPIRED =
  '⏰ This interaction has expired. Please run `/memory facts` again.';

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
  /** Active entity-tag filter (e.g. `commitment:promise`); absent = unfiltered. */
  tag?: string;
  /** Active statement query filter; absent = unfiltered. */
  query?: string;
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

/** Find the browse session behind a facts message (null when expired). */
export async function findFactBrowseSession(
  messageId: string
): Promise<DashboardSession<FactBrowseSession> | null> {
  return getSessionManager().findByMessageId<FactBrowseSession>(messageId);
}

/** Why {@link fetchCurrentFactsPage} could not produce a page. */
export type FactsPageRefusal = 'session-gone' | 'fetch-failed';

const FACTS_PAGE_REFUSAL = {
  SESSION_GONE: 'session-gone',
  FETCH_FAILED: 'fetch-failed',
} as const satisfies Record<string, FactsPageRefusal>;

/**
 * Notify the user ephemerally when a facts list page cannot be shown (expired
 * session vs transient page-fetch failure). Logs the failed-fetch case with
 * ids only and swallows a rejected followUp so callers do not crash on an
 * expired interaction token.
 */
export async function followUpFactsRefusal(
  interaction: ButtonInteraction,
  reason: FactsPageRefusal
): Promise<void> {
  if (reason === FACTS_PAGE_REFUSAL.FETCH_FAILED) {
    logger.warn(
      { userId: interaction.user.id, messageId: interaction.message.id },
      'Facts list could not be shown: page fetch failed'
    );
  }
  try {
    await interaction.followUp({
      content:
        reason === FACTS_PAGE_REFUSAL.SESSION_GONE
          ? FACTS_SESSION_EXPIRED
          : renderSpec(CATALOG.error.transient(PAGE_FETCH_FAILED_COPY)),
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.warn(
      { err, userId: interaction.user.id },
      'Could not notify the user of the facts refusal'
    );
  }
}

/** Result of {@link fetchCurrentFactsPage}: the session + page, or why not. */
export type CurrentFactsPage =
  | { ok: true; session: DashboardSession<FactBrowseSession>; data: FactListResponse }
  | { ok: false; reason: FactsPageRefusal };

/**
 * The find-session → destructure → page-fetch sequence shared by the batch
 * entry handler, the confirm handler's label resolution, and pagination:
 * one shape for the sibling batch flows to copy. `page` defaults to the
 * session's current page; pagination passes the button's target page. The
 * refusal reason is preserved so callers can quote the honest copy — a gone
 * session is an expiry message, a failed fetch is the transient one.
 */
export async function fetchCurrentFactsPage(
  interaction: ButtonInteraction,
  page?: number
): Promise<CurrentFactsPage> {
  const session = await findFactBrowseSession(interaction.message.id);
  if (session === null) {
    return { ok: false, reason: FACTS_PAGE_REFUSAL.SESSION_GONE };
  }
  const { personalityId, tag, query } = session.data;
  const { userClient } = clientsFor(interaction);
  const data = await fetchFacts(
    userClient,
    personalityId,
    (page ?? session.data.currentPage) * FACTS_PER_PAGE,
    FACTS_PER_PAGE,
    { tag, query }
  );
  if (data === null) {
    return { ok: false, reason: FACTS_PAGE_REFUSAL.FETCH_FAILED };
  }
  return { ok: true, session, data };
}

/** Build the browse list embed for a page of facts. */
export function buildFactsEmbed(options: {
  facts: FactItem[];
  total: number;
  page: number;
  tag?: string;
  query?: string;
}): EmbedBuilder {
  const { facts, total, page, tag, query } = options;
  const tagActive = tag !== undefined && tag.length > 0;
  const queryActive = query !== undefined && query.length > 0;
  const filterActive = tagActive || queryActive;

  let noMatch: string;
  if (queryActive && tagActive) {
    noMatch = 'No facts match that query and carry that tag — try browsing without a filter.';
  } else if (queryActive) {
    noMatch = 'No facts match that query — try browsing without a filter.';
  } else {
    noMatch = 'No facts carry that tag — try browsing without a filter.';
  }

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
      noMatch,
    },
    filterActive,
    footerSegments: [
      pluralize(total, { singular: 'fact', plural: 'facts' }),
      tagActive ? `tag: ${tag}` : false,
      queryActive ? `query: "${query}"` : false,
    ],
    badgeLegend: buildBadgeLegend(['LOCKED', 'CORRECTED']),
    footerOnEmpty: filterActive ? true : undefined,
  });

  return embed;
}

/**
 * Option fields for one fact in the select menu — shared by the one-pick
 * select and the batch multi-select so both present identical rows.
 */
export function formatFactSelectOption(fact: FactItem): BrowseSelectOption {
  return {
    label: `${fact.isLocked ? `${AUTOCOMPLETE_BADGES.LOCKED} ` : ''}${fact.statement}`,
    value: fact.id,
    // Select descriptions render no markdown — the date stays static text.
    description: formatDateShort(fact.validFrom),
  };
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
    formatItem: formatFactSelectOption,
  });
  if (selectRow === null) {
    return [];
  }

  const toggleRow = buildSelectSeveralToggleRow(buildFactActionId('batch-select'));

  return [
    selectRow,
    toggleRow,
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
  const rawTag = options.tag();
  const tag = rawTag !== null && rawTag.trim().length > 0 ? rawTag.trim() : undefined;
  const rawQuery = options.query();
  const query = rawQuery !== null && rawQuery.trim().length > 0 ? rawQuery.trim() : undefined;

  try {
    // Contract: null means the helper already sent the error reply.
    const personalityId = await resolveRequiredPersonality(context, userClient, personalityInput);
    if (personalityId === null) {
      return;
    }

    const data = await fetchFacts(userClient, personalityId, 0, FACTS_PER_PAGE, { tag, query });
    if (data === null) {
      logger.warn({ userId }, 'Facts browse failed');
      await context.editReply({
        content: renderSpec(CATALOG.error.transient("Couldn't load the facts right now.")),
      });
      return;
    }

    const { totalPages } = calculatePaginationState(data.total, FACTS_PER_PAGE, 0);
    const embed = buildFactsEmbed({ facts: data.facts, total: data.total, page: 0, tag, query });
    const components = buildFactsComponents(data.facts, 0, totalPages);

    const response = await context.editReply({ embeds: [embed], components });

    await getSessionManager().set<FactBrowseSession>({
      userId,
      entityType: FACT_BROWSE_PREFIX,
      entityId: response.id,
      data: { personalityId, currentPage: 0, tag, query },
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
  const result = await fetchCurrentFactsPage(interaction, parsed.page);
  if (!result.ok) {
    await followUpFactsRefusal(interaction, result.reason);
    return;
  }

  const { tag, query } = result.session.data;
  const data = result.data;

  const { totalPages, safePage } = calculatePaginationState(
    data.total,
    FACTS_PER_PAGE,
    parsed.page
  );
  const embed = buildFactsEmbed({
    facts: data.facts,
    total: data.total,
    page: safePage,
    tag,
    query,
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

/** Outcome of {@link buildRefreshedFactsOutcome}: the rebuilt view, or why not. */
export type RefreshedFactsOutcome =
  | { kind: 'view'; view: { embed: EmbedBuilder; components: BrowseActionRow[] } }
  | { kind: FactsPageRefusal };

/**
 * Build the refreshed list outcome for the message an interaction came from,
 * stepping back a page when the current one emptied. Distinguishes a gone
 * session from a failed fetch so callers can deliver reason-honest feedback.
 */
export async function buildRefreshedFactsOutcome(
  interaction: ButtonInteraction
): Promise<RefreshedFactsOutcome> {
  const messageId = interaction.message.id;
  const session = await findFactBrowseSession(messageId);
  if (session === null) {
    return { kind: FACTS_PAGE_REFUSAL.SESSION_GONE };
  }

  const { personalityId, tag, query } = session.data;
  const { userClient } = clientsFor(interaction);

  const result = await fetchPageWithEmptyFallback({
    currentPage: session.data.currentPage,
    fetchPage: page =>
      fetchFacts(userClient, personalityId, page * FACTS_PER_PAGE, FACTS_PER_PAGE, { tag, query }),
    isEmpty: d => d.facts.length === 0,
  });
  if (result === null) {
    return { kind: FACTS_PAGE_REFUSAL.FETCH_FAILED };
  }

  if (result.steppedBack) {
    await updateFactSessionPage(interaction.user.id, messageId, result.page);
  }

  const { totalPages } = calculatePaginationState(result.data.total, FACTS_PER_PAGE, result.page);
  return {
    kind: 'view',
    view: {
      embed: buildFactsEmbed({
        facts: result.data.facts,
        total: result.data.total,
        page: result.page,
        tag,
        query,
      }),
      components: buildFactsComponents(result.data.facts, result.page, totalPages),
    },
  };
}

/**
 * Build the refreshed list view (embed + components) for the message an
 * interaction came from, stepping back a page when the current one emptied.
 * Null when the session is gone or the fetch failed — the caller keeps the
 * message untouched in that case.
 */
export async function buildRefreshedFactsView(
  interaction: ButtonInteraction
): Promise<{ embed: EmbedBuilder; components: BrowseActionRow[] } | null> {
  const outcome = await buildRefreshedFactsOutcome(interaction);
  return outcome.kind === 'view' ? outcome.view : null;
}

/**
 * Refresh the list view — called after "back" from detail, batch cancel, and
 * after a forget. Steps back a page when a forget empties the current one;
 * answers a gone session or failed fetch with an ephemeral followUp.
 */
export async function refreshFactsList(interaction: ButtonInteraction): Promise<void> {
  const outcome = await buildRefreshedFactsOutcome(interaction);
  if (outcome.kind !== 'view') {
    await followUpFactsRefusal(interaction, outcome.kind);
    return;
  }
  await interaction.editReply({
    embeds: [outcome.view.embed],
    components: outcome.view.components,
  });
}
