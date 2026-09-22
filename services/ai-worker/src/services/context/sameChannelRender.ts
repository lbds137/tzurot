/**
 * Same-channel history render mode.
 *
 * Governs what the CURRENT channel's history renders for turns older than the
 * verbatim window — 'both' (today's behavior, every turn verbatim), 'summarized'
 * (the responding character's own older turns are replaced by their stored
 * memory summary, falling back to verbatim where no usable summary exists), or
 * 'user-only' (older non-user turns are dropped entirely). User turns are never
 * altered in any mode. A turn replaced by its summary keeps only its
 * reactions — the rest of its metadata described the content the summary
 * replaced.
 *
 * `partitionExchanges` is the single split point: the sync trigger-id collector
 * and the async render both derive the older/tail exchange split from it, so
 * the two resolve the verbatim window boundary from one place. The most recent
 * N COMPLETED exchanges stay verbatim; a trailing run with no responder turn is
 * never one of the N, so a user turn still awaiting a reply cannot push a
 * completed exchange out of the window.
 */

import { MessageRole } from '@tzurot/common-types/constants/message';
import type { SameChannelRenderMode } from '@tzurot/common-types/schemas/api/configOverrides';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';

const logger = createLogger('sameChannelRender');

/** One exchange: a half-open `[start, end)` range into the entries array. */
interface Exchange {
  /** Inclusive start index into the entries array. */
  start: number;
  /** Exclusive end index. */
  end: number;
  /**
   * Set only on a trailing run with no responder turn — the entries posted
   * since the character last replied. Absent on every completed exchange, so
   * `unterminated === true` is the whole test.
   */
  unterminated?: true;
}

function roleEquals(role: string, target: MessageRole): boolean {
  return role.toLowerCase() === target.toLowerCase();
}

/**
 * Segment `entries` (oldest-first) into exchanges. An exchange is a maximal
 * run of entries ending at a *responder turn* — an assistant-role entry whose
 * `personalityId` matches `responderPersonalityId`. Entries after the final
 * responder turn form a trailing exchange marked `unterminated` — it is not a
 * completed exchange, so it never counts against the verbatim window.
 *
 * When `responderPersonalityId` is undefined, the whole array is returned as
 * one exchange — the safe degradation for callers with no personality in
 * hand: nothing is ever older than the verbatim window, so no render happens.
 */
function segmentExchanges(
  entries: StructuredHistoryEntry[],
  responderPersonalityId: string | undefined
): Exchange[] {
  if (responderPersonalityId === undefined) {
    return [{ start: 0, end: entries.length }];
  }

  const exchanges: Exchange[] = [];
  let start = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isResponderTurn =
      roleEquals(entry.role, MessageRole.Assistant) &&
      entry.personalityId === responderPersonalityId;
    if (isResponderTurn) {
      exchanges.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < entries.length) {
    exchanges.push({ start, end: entries.length, unterminated: true });
  }
  return exchanges;
}

/**
 * How many of `exchanges` are COMPLETED. At most one exchange is ever
 * unterminated and it is always the last, so this subtracts at most one.
 */
function completedCount(exchanges: Exchange[]): number {
  return exchanges.length - (exchanges[exchanges.length - 1]?.unterminated === true ? 1 : 0);
}

/**
 * Split `entries` at the verbatim-window boundary: the exchanges that fall
 * OUTSIDE the window, and the tail the window protects. Both the sync
 * trigger-id collector and the async render partition through this, so the two
 * resolve the window boundary from one place.
 *
 * The window counts COMPLETED exchanges only. Since the unterminated run is the
 * last exchange and `olderCount` can never reach its index, it always lands in
 * the tail rather than displacing a completed exchange into `older`.
 */
function partitionExchanges(
  entries: StructuredHistoryEntry[],
  opts: { verbatimExchanges: number; responderPersonalityId: string | undefined }
): { older: Exchange[]; tail: Exchange[] } {
  const exchanges = segmentExchanges(entries, opts.responderPersonalityId);
  const olderCount = Math.max(0, completedCount(exchanges) - opts.verbatimExchanges);
  return { older: exchanges.slice(0, olderCount), tail: exchanges.slice(olderCount) };
}

/** An exchange's trigger candidates: every user-role entry's Discord ids, in order. */
function exchangeTriggerCandidates(
  entries: StructuredHistoryEntry[],
  exchange: Exchange
): string[] {
  const ids: string[] = [];
  for (let i = exchange.start; i < exchange.end; i++) {
    const entry = entries[i];
    if (roleEquals(entry.role, MessageRole.User)) {
      for (const id of entry.discordMessageId ?? []) {
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Trigger-message ids of the exchanges that fall OUTSIDE the verbatim window. */
export function collectOlderExchangeTriggerIds(
  entries: StructuredHistoryEntry[],
  opts: { verbatimExchanges: number; responderPersonalityId: string | undefined }
): string[] {
  const { older } = partitionExchanges(entries, opts);

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const exchange of older) {
    for (const id of exchangeTriggerCandidates(entries, exchange)) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

export interface SameChannelRenderCounts {
  /**
   * COMPLETED exchanges left untouched at the tail of the window. A trailing
   * run with no responder turn is not one of them, though it is kept verbatim.
   */
  verbatimExchanges: number;
  /** Entries whose content was replaced by a stored summary. */
  summarized: number;
  /** Responder entries in older exchanges that stayed verbatim for want of a usable summary. */
  fallbackVerbatim: number;
  /** Entries removed entirely. */
  omitted: number;
}

function zeroCounts(verbatimExchanges: number): SameChannelRenderCounts {
  return { verbatimExchanges, summarized: 0, fallbackVerbatim: 0, omitted: 0 };
}

/**
 * Render a single older-exchange entry under `'summarized'` mode. User-role
 * entries are always kept unchanged by reference; non-responder entries (a
 * sibling personality's replies, or any other role) are also kept unchanged by
 * reference. A responder turn resolves a summary by walking the exchange's
 * trigger candidates in order and taking the first hit; on a miss it stays
 * verbatim.
 */
function renderSummarizedEntry(
  entry: StructuredHistoryEntry,
  triggerCandidates: string[],
  responderPersonalityId: string | undefined,
  summaries: ReadonlyMap<string, string>,
  counts: SameChannelRenderCounts
): StructuredHistoryEntry {
  if (roleEquals(entry.role, MessageRole.User)) {
    return entry;
  }
  const isResponderTurn =
    roleEquals(entry.role, MessageRole.Assistant) && entry.personalityId === responderPersonalityId;
  if (!isResponderTurn) {
    return entry;
  }
  for (const triggerId of triggerCandidates) {
    const summary = summaries.get(triggerId);
    if (summary !== undefined && summary.length > 0) {
      counts.summarized++;
      // The summary replaces the content that this turn's image descriptions,
      // embeds and quotes described, so that metadata goes with it. Reactions
      // are about the turn rather than about its text, so they survive. The
      // forward attribution (`messageMetadata.forwardedFrom`) does not, so
      // `isForwarded` goes with it — a summary is not a forwarded snapshot,
      // and `renderHistoryEntryBody` keys its forwarded-quote wrapper on
      // `isForwarded === true`.
      const reactions = entry.messageMetadata?.reactions;
      return {
        ...entry,
        content: summary,
        renderedAs: 'summary',
        isForwarded: undefined,
        messageMetadata: reactions === undefined ? undefined : { reactions },
      };
    }
  }
  counts.fallbackVerbatim++;
  return entry;
}

/**
 * Render one older exchange's entries under the active mode, appending the
 * survivors to `out`. User entries pass through by reference in every mode;
 * under 'user-only' every non-user entry is dropped; under 'summarized' a
 * responder turn resolves against this exchange's own trigger candidates.
 */
function renderOlderExchange(
  entries: StructuredHistoryEntry[],
  exchange: Exchange,
  opts: {
    mode: SameChannelRenderMode;
    responderPersonalityId: string | undefined;
    summaries: ReadonlyMap<string, string>;
  },
  counts: SameChannelRenderCounts,
  out: StructuredHistoryEntry[]
): void {
  const triggerCandidates =
    opts.mode === 'summarized' ? exchangeTriggerCandidates(entries, exchange) : [];
  for (let i = exchange.start; i < exchange.end; i++) {
    const entry = entries[i];
    if (roleEquals(entry.role, MessageRole.User)) {
      out.push(entry);
      continue;
    }
    if (opts.mode === 'user-only') {
      counts.omitted++;
      continue;
    }
    out.push(
      renderSummarizedEntry(
        entry,
        triggerCandidates,
        opts.responderPersonalityId,
        opts.summaries,
        counts
      )
    );
  }
}

/**
 * Apply the same-channel render mode to already-fetched history entries. Pure:
 * never mutates the input array or any input entry.
 */
export function applySameChannelRenderMode(
  entries: StructuredHistoryEntry[],
  opts: {
    mode: SameChannelRenderMode;
    verbatimExchanges: number;
    responderPersonalityId: string | undefined;
    /** Trigger Discord message id → stored assistant summary. */
    summaries: ReadonlyMap<string, string>;
  }
): { entries: StructuredHistoryEntry[]; counts: SameChannelRenderCounts } {
  const { older, tail } = partitionExchanges(entries, opts);
  // `older` never holds the unterminated run, so this is the completed count of
  // the tail — and `older.length +` it is the completed count of the whole array.
  const verbatimCompleted = completedCount(tail);

  if (opts.mode === 'both') {
    return { entries, counts: zeroCounts(older.length + verbatimCompleted) };
  }

  if (older.length === 0) {
    return { entries, counts: zeroCounts(verbatimCompleted) };
  }

  const counts = zeroCounts(verbatimCompleted);
  const result: StructuredHistoryEntry[] = [];

  for (const exchange of older) {
    renderOlderExchange(entries, exchange, opts, counts, result);
  }

  for (const exchange of tail) {
    for (let i = exchange.start; i < exchange.end; i++) {
      result.push(entries[i]);
    }
  }

  return { entries: result, counts };
}

/**
 * Apply the same-channel render mode, fetching the stored summaries the
 * 'summarized' arm needs. Fail-soft: a lookup failure logs and renders verbatim
 * rather than failing the turn, matching the other enrichment fetches in the
 * context path.
 */
export async function renderSameChannelHistory(
  entries: StructuredHistoryEntry[],
  opts: {
    mode: SameChannelRenderMode;
    verbatimExchanges: number;
    responderPersonalityId: string | undefined;
    /** Resolves trigger Discord ids to stored assistant summaries. */
    fetchSummaries: (triggerIds: string[]) => Promise<Map<string, string>>;
  }
): Promise<StructuredHistoryEntry[]> {
  if (opts.mode === 'both') {
    return entries;
  }

  let summaries = new Map<string, string>();
  if (opts.mode === 'summarized') {
    const triggerIds = collectOlderExchangeTriggerIds(entries, {
      verbatimExchanges: opts.verbatimExchanges,
      responderPersonalityId: opts.responderPersonalityId,
    });
    // With no trigger ids nothing could resolve, so the query is skipped; the
    // render and its log still run, as they do for 'user-only'.
    if (triggerIds.length > 0) {
      try {
        summaries = await opts.fetchSummaries(triggerIds);
      } catch (err) {
        logger.warn({ err }, 'Same-channel summary lookup failed; rendering history verbatim');
        return entries;
      }
    }
  }

  const { entries: rendered, counts } = applySameChannelRenderMode(entries, {
    mode: opts.mode,
    verbatimExchanges: opts.verbatimExchanges,
    responderPersonalityId: opts.responderPersonalityId,
    summaries,
  });

  logger.info(
    {
      mode: opts.mode,
      verbatimExchanges: counts.verbatimExchanges,
      summarized: counts.summarized,
      fallbackVerbatim: counts.fallbackVerbatim,
      omitted: counts.omitted,
      inputEntries: entries.length,
    },
    'Same-channel history rendered'
  );

  return rendered;
}
