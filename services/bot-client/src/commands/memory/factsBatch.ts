/**
 * Memory Facts Batch Flow ("Select several")
 *
 * Multi-select batch actions over the facts browse list: pick several facts
 * in one menu, confirm Lock or Forget for all of them in one view, then get
 * a per-item outcome listing (successes, gone items, locked skips and
 * failures). Execution loops the single-id gateway calls with per-item
 * isolation — no batch route.
 *
 * Component contract:
 * - `memory-fact::batch-select` — the "Select several" toggle button (swaps
 *   the page into multi-select mode) AND the multi-select menu itself; the
 *   router dispatches by interaction kind.
 * - `memory-fact::batch-confirm::<forget|lock>` — the verb buttons; the verb
 *   rides the factId slot of the action id.
 * - the selected fact ids ride the confirm embed's FOOTER, one per line.
 */

import {
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
  type Message,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { GatewayClientError, type UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { buildBrowseSelectMenu } from '../../utils/browse/selectMenuBuilder.js';
import {
  buildBatchModeRows,
  buildBatchConfirmView,
  buildBatchResultEmbed,
  encodeBatchFooterIds,
  parseBatchFooterIds,
  runBatchSequentially,
  formatBatchItemLines,
  type BatchResultLine,
} from '../../utils/browse/multiSelectBatch.js';
import { truncateForSelect } from '../../utils/browse/truncation.js';
import { clampEmbedText } from '../../utils/embedLimits.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { followUpSpec, ackUpdate } from '../../ux/render/reply.js';
import {
  FACTS_PER_PAGE,
  FACTS_SESSION_EXPIRED,
  findFactBrowseSession,
  buildFactsEmbed,
  formatFactSelectOption,
  buildRefreshedFactsView,
} from './factsBrowse.js';
import { buildFactActionId } from './factsDetail.js';
import { fetchFacts, forgetFact, setFactLock, type FactItem } from './factsApi.js';

const logger = createLogger('memory-facts-batch');

/** What a confirmed batch verb does per fact. */
export type BatchVerb = 'forget' | 'lock';

/** Outcome of one single-id gateway call inside the batch loop. */
type BatchVerbOutcome = 'success' | 'already-gone';

/** Fallback display label when a fact's real label can't be resolved. */
function fallbackFactLabel(id: string): string {
  return `Fact ID: ${id.slice(0, 8)}…`;
}

/** Swap-render components: the multi-select page plus a Cancel affordance. */
export function buildBatchSelectComponents(
  facts: FactItem[],
  page: number
): ReturnType<typeof buildBatchModeRows> {
  const selectRow = buildBrowseSelectMenu<FactItem>({
    items: facts,
    customId: buildFactActionId('batch-select'),
    placeholder: 'Select several facts to manage...',
    startIndex: page * FACTS_PER_PAGE,
    maxValues: FACTS_PER_PAGE,
    formatItem: formatFactSelectOption,
  });
  return buildBatchModeRows({
    selectRow,
    cancelCustomId: buildFactActionId('batch-cancel'),
  });
}

/**
 * "Select several" entry — swap the current page into multi-select mode.
 * Ack-first; the page state lives in the dashboard session like pagination.
 */
export async function handleBatchSelectEntry(interaction: ButtonInteraction): Promise<void> {
  await ackUpdate(interaction);

  const session = await findFactBrowseSession(interaction.message.id);
  if (session === null) {
    await interaction.followUp({
      content: FACTS_SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { personalityId, currentPage, tag, query } = session.data;
  const { userClient } = clientsFor(interaction);
  const data = await fetchFacts(
    userClient,
    personalityId,
    currentPage * FACTS_PER_PAGE,
    FACTS_PER_PAGE,
    { tag, query }
  );
  if (data === null) {
    await interaction.followUp({
      content: renderSpec(CATALOG.error.transient("Couldn't load that page right now.")),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      buildFactsEmbed({ facts: data.facts, total: data.total, page: currentPage, tag, query }),
    ],
    components: buildBatchSelectComponents(data.facts, currentPage),
  });
}

/**
 * Map option value → label for every select menu on a message. discord.js
 * rehydrates message components as builders, so each row is normalized via
 * toJSON() and walked generically as unknown data.
 */
function readSelectOptionLabels(message: Message): Map<string, string> {
  const labels = new Map<string, string>();
  for (const row of message.components) {
    collectSelectOptionLabels(row.toJSON(), labels);
  }
  return labels;
}

function collectSelectOptionLabels(source: unknown, labels: Map<string, string>): void {
  if (typeof source !== 'object' || source === null) {
    return;
  }
  const record = source as Record<string, unknown>;
  const options = record.options;
  if (Array.isArray(options)) {
    collectOptionEntries(options, labels);
  }
  const children = record.components;
  if (Array.isArray(children)) {
    for (const child of children) {
      collectSelectOptionLabels(child, labels);
    }
  }
}

function collectOptionEntries(options: unknown[], labels: Map<string, string>): void {
  for (const option of options) {
    if (typeof option !== 'object' || option === null) {
      continue;
    }
    const entry = option as Record<string, unknown>;
    const value = entry.value;
    const label = entry.label;
    if (typeof value === 'string') {
      labels.set(value, typeof label === 'string' ? label : value);
    }
  }
}

/**
 * Multi-select finished — show the confirm view listing EVERY selected fact,
 * with Lock / Forget verb buttons and Cancel. The selected ids ride the
 * embed footer so the confirm handler can recover them (aliasBrowse pattern).
 */
export async function handleBatchPick(interaction: StringSelectMenuInteraction): Promise<void> {
  await ackUpdate(interaction);

  const ids = interaction.values.filter(value => value.length > 0);
  if (ids.length === 0) {
    await followUpSpec(interaction, CATALOG.error.validation('No facts were selected.'));
    return;
  }

  const labels = readSelectOptionLabels(interaction.message);
  const listing = ids
    .map(id => {
      const label = labels.get(id) ?? fallbackFactLabel(id);
      return `• ${escapeMarkdown(label)}`;
    })
    .join('\n');
  const warning =
    `**This affects ${ids.length} ${ids.length === 1 ? 'fact' : 'facts'} immediately.** ` +
    'Forget is permanent — forgotten facts are never re-learned.';

  const { embed, components } = buildBatchConfirmView({
    title: '⚠️ Manage Several Facts',
    description: clampEmbedText(`${listing}\n\n${warning}`, 3800),
    footerText: encodeBatchFooterIds(ids),
    // The factory row is Cancel → Forget (Danger), Danger last; the
    // Secondary Lock verb rides its own row ABOVE the confirm row.
    secondaryVerb: {
      customId: buildFactActionId('batch-confirm', 'lock'),
      label: `Lock (${ids.length})`,
      emoji: '🔐',
    },
    confirm: {
      customId: buildFactActionId('batch-confirm', 'forget'),
      label: `Forget (${ids.length})`,
      emoji: '🗑️',
    },
    cancelCustomId: buildFactActionId('batch-cancel'),
  });

  await interaction.editReply({ embeds: [embed], components });
}

/** One single-id gateway call, mapped to the batch outcome vocabulary. */
async function runBatchVerb(
  userClient: UserClient,
  verb: BatchVerb,
  factId: string,
  userId: string
): Promise<BatchVerbOutcome> {
  if (verb === 'forget') {
    return (await forgetFact(userClient, factId, userId)) ? 'success' : 'already-gone';
  }
  const updated = await setFactLock(userClient, factId, true, userId);
  return updated === null ? 'already-gone' : 'success';
}

/** Resolved pre-loop state for one selected id: menu label + lock state. */
interface ResolvedBatchLabel {
  label: string;
  isLocked: boolean;
}

/**
 * Why a confirm must refuse before any mutation: the browse session no longer
 * exists, or the pre-loop page fetch failed (transient gateway error).
 */
type BatchLabelsRefusal = 'session-gone' | 'fetch-failed';

/**
 * Result-time labels, resolved BEFORE the loop mutates the page: while every
 * selected id is still on the current page, one fetch matches them all; ids
 * whose fact has since vanished degrade to a short id prefix. A refusal means
 * the caller must refuse BEFORE mutating, because the outcome report could
 * not name the facts it acted on — true for BOTH refusal reasons: a gone
 * session and a failed fetch alike leave no honest basis for the run.
 */
async function resolveBatchLabels(
  interaction: ButtonInteraction,
  ids: readonly string[]
): Promise<
  { ok: true; labels: Map<string, ResolvedBatchLabel> } | { ok: false; reason: BatchLabelsRefusal }
> {
  const resolved = new Map<string, ResolvedBatchLabel>();
  const idSet = new Set(ids);
  const session = await findFactBrowseSession(interaction.message.id);
  if (session === null) {
    return { ok: false, reason: 'session-gone' };
  }
  const { personalityId, currentPage, tag, query } = session.data;
  const { userClient } = clientsFor(interaction);
  const data = await fetchFacts(
    userClient,
    personalityId,
    currentPage * FACTS_PER_PAGE,
    FACTS_PER_PAGE,
    { tag, query }
  );
  if (data === null) {
    return { ok: false, reason: 'fetch-failed' };
  }
  for (const fact of data.facts) {
    if (idSet.has(fact.id)) {
      resolved.set(fact.id, {
        label: formatFactSelectOption(fact).label,
        isLocked: fact.isLocked,
      });
    }
  }
  return { ok: true, labels: resolved };
}

/** Deliver a confirm refusal (nothing has mutated) with the reason-honest copy. */
async function replyBatchRefusal(
  interaction: ButtonInteraction,
  reason: BatchLabelsRefusal
): Promise<void> {
  if (reason === 'fetch-failed') {
    // A live session with a failed fetch is NOT an expired session —
    // transient copy, not the expiry copy.
    await followUpSpec(interaction, CATALOG.error.transient("Couldn't load that page right now."));
    return;
  }
  await interaction.followUp({
    content: FACTS_SESSION_EXPIRED,
    flags: MessageFlags.Ephemeral,
  });
}

/** Outcome counts for one finished batch run. */
interface BatchRunCounts {
  succeeded: number;
  gone: number;
  failed: number;
  locked: number;
}

/**
 * Deliver the outcome report: a result embed naming every item's outcome,
 * stacked on top of the refreshed list view when one exists.
 *
 * The color ladder: red for a real failure; warning amber when nothing
 * succeeded AND nothing failed (all locked / all already-gone — no work was
 * actually done); green otherwise.
 *
 * Discord caps the SUM of embed text per message at 6000 characters; the
 * mutations have already run, so the report must survive reply failures on
 * EVERY branch: the stacked reply falls back to the result embed alone, and
 * either reply shape falls back to a plain ephemeral followUp carrying just
 * the counts.
 */
async function deliverBatchResult(
  interaction: ButtonInteraction,
  verb: BatchVerb,
  counts: BatchRunCounts,
  lines: readonly BatchResultLine[]
): Promise<void> {
  const { succeeded, gone, failed, locked } = counts;
  const resultEmbed = buildBatchResultEmbed({
    title: verb === 'forget' ? '🗑️ Forget Results' : '🔐 Lock Results',
    color:
      failed > 0
        ? DISCORD_COLORS.ERROR
        : succeeded === 0
          ? DISCORD_COLORS.WARNING
          : DISCORD_COLORS.SUCCESS,
    lines: formatBatchItemLines(lines),
  });

  // Last resort on either branch — the mutations already ran, so the counts
  // must reach the user even when the message itself can no longer be edited.
  const followUpCounts = (): Promise<void> =>
    followUpSpec(
      interaction,
      CATALOG.info.note(
        verb === 'forget'
          ? `Batch finished: ${succeeded} succeeded, ${gone} already gone, ${locked} locked (skipped), ${failed} failed.`
          : `Batch finished: ${succeeded} succeeded, ${gone} already gone, ${locked} already locked, ${failed} failed.`
      )
    );

  // Result embed alone, still laddered: if even this editReply rejects
  // (message deleted mid-run), the counts followUp delivers the report.
  const deliverResultOnly = async (): Promise<void> => {
    try {
      await interaction.editReply({ embeds: [resultEmbed], components: [] });
    } catch (error) {
      logger.warn(
        { err: error, verb },
        'Result-only batch reply failed; falling back to counts followUp'
      );
      await followUpCounts();
    }
  };

  const view = await buildRefreshedFactsView(interaction);
  if (view === null) {
    await deliverResultOnly();
    return;
  }
  try {
    await interaction.editReply({
      embeds: [resultEmbed, view.embed],
      components: view.components,
    });
  } catch (error) {
    logger.warn({ err: error, verb }, 'Stacked batch result reply failed; retrying result-only');
    await deliverResultOnly();
  }
}

/**
 * Confirm verb — run the loop sequentially with per-item isolation, then
 * render a result embed naming every item's outcome on top of the refreshed
 * list view.
 */
export async function handleBatchConfirm(
  interaction: ButtonInteraction,
  verb: BatchVerb
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }

  const ids = parseBatchFooterIds(interaction.message.embeds[0]?.footer?.text);
  if (ids === null) {
    await followUpSpec(
      interaction,
      CATALOG.error.validation(
        "Couldn't tell which facts were selected — please run `/memory facts` and try again."
      )
    );
    return;
  }

  const userId = interaction.user.id;
  const { userClient } = clientsFor(interaction);

  // Strip the confirm buttons to shrink the double-tap window to the ack +
  // strip round-trips themselves — a tap Discord delivers inside that window
  // still runs the whole flow. After the strip, later taps find nothing to
  // act on. The embeds stay untouched: the confirm view remains visible but
  // inert. A refusal below loses only that inert view — its followUp copy
  // tells the user to re-run.
  await interaction.editReply({ components: [] });

  // Labels come from a fetch made BEFORE the loop: after it runs, the
  // successfully forgotten facts are gone from the page and their real
  // statements would be unrecoverable. BOTH refusal cases — a gone session
  // and a failed pre-loop fetch — refuse BEFORE any gateway call: the
  // outcome report could not name the facts it acted on, so no mutation may
  // run on that basis.
  const resolved = await resolveBatchLabels(interaction, ids);
  if (!resolved.ok) {
    await replyBatchRefusal(interaction, resolved.reason);
    return;
  }
  const labels = resolved.labels;

  const lockedIds = new Set(
    [...labels.entries()].filter(([, meta]) => meta.isLocked).map(([id]) => id)
  );
  // Locked facts never run, for either verb: a forget would 403 at the
  // gateway, and a lock's target state is already set — the skip is the
  // outcome, so no call is made. Both verbs skip them upfront and report
  // them as their own locked outcome.
  const runIds = ids.filter(id => !lockedIds.has(id));
  const results = await runBatchSequentially(runIds, id =>
    runBatchVerb(userClient, verb, id, userId)
  );

  // Same truncation the select menu applies to option labels — the result
  // lines must not resurrect the full statement the menu clipped.
  const labelFor = (id: string): string =>
    escapeMarkdown(
      truncateForSelect(labels.get(id)?.label ?? fallbackFactLabel(id), { stripNewlines: true })
    );

  const toResultLine = (result: (typeof results)[number]): BatchResultLine => {
    const label = labelFor(result.id);
    if (!result.ok) {
      // On a forget run a 403 IS the gateway's locked-fact rejection (the
      // factsApi contract) — and a selected id missing from the fetched page
      // has UNKNOWN lock state, so the 403 is the only honest locked signal.
      // Render it as the locked outcome, not a generic failure.
      if (
        verb === 'forget' &&
        result.error instanceof GatewayClientError &&
        result.error.status === 403
      ) {
        return { label, status: 'locked', note: 'locked — unlock first' };
      }
      const reason = renderSpec(
        verb === 'forget'
          ? classifyGatewayFailure(result.error, 'fact', { failedAction: 'forget the fact' })
          : classifyGatewayFailure(result.error, 'fact lock')
      );
      return { label, status: 'failed', note: reason };
    }
    if (result.value === 'success') {
      return { label, status: 'success' };
    }
    return { label, status: 'gone', note: 'already gone' };
  };

  // Original ids order: loop results where the id ran, locked-skip lines for
  // the ids neither verb attempted (every non-locked id has a result).
  const resultLines = new Map<string, BatchResultLine>(
    results.map(result => [result.id, toResultLine(result)])
  );
  const lines = ids.map(
    (id): BatchResultLine =>
      resultLines.get(id) ?? {
        label: labelFor(id),
        status: 'locked',
        note: verb === 'forget' ? 'locked — unlock first' : 'already locked',
      }
  );

  const succeeded = lines.filter(line => line.status === 'success').length;
  const gone = lines.filter(line => line.status === 'gone').length;
  const failed = lines.filter(line => line.status === 'failed').length;
  const locked = lines.filter(line => line.status === 'locked').length;
  const counts: BatchRunCounts = { succeeded, gone, failed, locked };
  logger.info({ userId, verb, requested: ids.length, ...counts }, 'Batch fact action finished');

  await deliverBatchResult(interaction, verb, counts, lines);
}
