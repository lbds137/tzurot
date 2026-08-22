/**
 * Context Window Manager
 *
 * Manages token budgets and selects conversation history that fits within context window.
 * History is serialized as XML inside the system prompt to prevent identity bleeding.
 * Cross-channel history from other channels is included when budget permits.
 */

import { type DiscordEnvironment } from '@tzurot/common-types/types/schemas/discord';
import { type CrossChannelHistoryGroupEntry } from '@tzurot/common-types/types/schemas/message';
import { formatLocationAsXml } from '@tzurot/common-types/utils/environmentFormatter';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { MemoryDocument } from '../ConversationalRAGTypes.js';
import {
  type StructuredHistoryEntry,
  type ResponderIdentity,
  collectPersonalityNames,
  formatConversationHistoryAsXml,
} from '../../jobs/utils/conversationUtils.js';
import {
  measureHistoryEntryTokens,
  measureHistoryEntryRealTokens,
  PER_MESSAGE_WIRE_OVERHEAD_TOKENS,
} from './historyTokenMeasure.js';
import { contentToText } from '../../utils/baseMessageContent.js';
import { buildRealMessages } from './RealMessagesBuilder.js';
import { serializeCrossChannelHistory } from './CrossChannelSerializer.js';
import { MemoryBudgetManager, type MemorySelectionResult } from './MemoryBudgetManager.js';

const logger = createLogger('ContextWindowManager');

/**
 * Trailing render inputs for {@link ContextWindowManager.selectAndSerializeHistory},
 * bundled into one options object for the same reason `ResponderIdentity`
 * bundles `name`+`id` (see that interface's doc-comment): the method was
 * already at the five-parameter ceiling, so a bare new parameter would need a
 * suppression whose only justification is "we added a parameter". Bundle
 * instead, append fields to this interface as new render inputs arrive.
 */
export interface HistoryWindowOptions {
  crossChannelGroups?: CrossChannelHistoryGroupEntry[];
  currentEnvironment?: DiscordEnvironment;
  /**
   * Selects the per-entry MEASURE and the reported token cost, not the
   * serialization — `serializedHistory` is produced in full (the XML form)
   * regardless of this flag, because diagnostics and prefix-cache
   * observability read it either way. Must be the SAME value
   * `ContentBudgetManager.preselectHistory` already read once this turn (see
   * `PreselectedHistory.realMessagesEnabled`'s doc-comment) — reading it again
   * here would risk the two calls disagreeing.
   */
  realMessagesEnabled?: boolean;
}

/**
 * Fraction of the budget evicted per hysteresis step at the TOKEN layer
 * (§2.5 of the prompt-assembly design; the 25% figure is transposed from the
 * count-cap layer's §2.5.2 D2, which re-derived it for that layer).
 * Deliberately NOT imported from
 * `HISTORY_WINDOW.EVICTION_CHUNK_RATIO` in `@tzurot/conversation-history`
 * (the count-cap FETCH layer's sibling constant) — the two layers tune
 * independently, and coupling them would let a telemetry-driven change to one
 * silently move the other. A config constant telemetry can lower later, not a
 * literal to be trusted forever.
 */
const HISTORY_EVICTION_CHUNK_RATIO = 0.25;

/**
 * The token-layer eviction never quantizes below this many entries. This is
 * this layer's OWN floor, deliberately NOT imported from
 * `HISTORY_WINDOW.MIN_MESSAGE_FLOOR` in `@tzurot/conversation-history` — see
 * {@link HISTORY_EVICTION_CHUNK_RATIO}'s doc-comment for why the two layers
 * stay decoupled.
 */
const HISTORY_EVICTION_MIN_ENTRY_FLOOR = 20;

/**
 * The chunked-eviction cut over an already-measured, chronological (oldest
 * first) array of per-entry token costs. Pure function so the property tests
 * pinning §2.5's invariants (oscillation, head-stability/hysteresis, the
 * floor, dormancy parity) can drive it directly, in addition to end to end
 * through `selectAndSerializeHistory`.
 *
 * `measures[i]` is entry `i`'s cost; `budget` is the current-channel budget
 * AFTER the `<chat_log>` (or, flag-on, zero) wrapper overhead is deducted.
 * Returns the number of entries to evict from the FRONT (oldest end) —
 * `rawHistory.slice(cFinal)` is what ships.
 *
 * Algorithm (§2.5's chunked eviction, with the quantization mechanics
 * transposed from the count-cap layer's §2.5.2 D1/D2 row-count hysteresis to
 * token cost):
 * 1. Prefix-sum every entry once — the walk below reads the array rather than
 *    re-measuring, so no entry is measured twice.
 * 2. If the full history already fits the budget (`sTotal <= budget`), evict
 *    nothing. This is today's dominant path and stays byte-identical.
 * 3. Otherwise find the MINIMAL fit `cMin` by the same newest-first walk
 *    `selectCurrentChannelEntries` has always used: accumulate from the
 *    newest entry backward, and BREAK (never resume scanning for a smaller
 *    older entry) on the first entry that would exceed budget.
 * 4. Below the entry floor, hysteresis is off — a window this small is cheap
 *    to re-bill, and quantization would eat too large a share of it — so
 *    `cFinal = cMin`.
 * 5. At or above the floor, quantize: evict in chunks of `Q = ceil(ratio *
 *    budget)` TOKENS, `k` chunks deep, landing on the entry boundary `cQ`
 *    where the evicted-token prefix first reaches `k * Q`. Clamp `cQ` between
 *    `cMin` (never ship over budget) and `n - floor` (never quantize below the
 *    floor).
 *
 * Properties (provable from the definitions above, not merely observed):
 * - **Never exceeds budget**: `S(cQ) >= k*Q >= sTotal - budget`, so the
 *   shipped suffix `sTotal - S(cQ) <= budget`. The floor clamp can only move
 *   the cut UP toward `cMin`, whose suffix fits by construction — so the
 *   clamp bounds quantization OVERSHOOT only; it never overrides the budget.
 *   A small budget can still strip below the floor via `cMin` — today's
 *   semantics, no new context-overflow risk.
 * - **Oscillation band**: when the chunked cut is active and unclamped,
 *   shipped tokens land in `(budget * (1 - ratio) - m, budget]`, where `m` is
 *   the BOUNDARY entry's measured cost (`measures[cQ - 1]`) — the cut lands on
 *   an entry boundary, so crossing the threshold evicts the whole entry that
 *   straddles it. For entries small relative to `Q` this is §2.5's nominal
 *   "evict to ~75% of budget, refill to 100%"; a single oversized entry
 *   (a vision description, a heavy embed) at the boundary deepens the cut by
 *   up to its own size. Degraded-but-safe: never-exceeds-budget and the entry
 *   floor both hold unconditionally. Pinned both ways by the OSCILLATION
 *   (uniform fixture, nominal band) and OVERSIZED-BOUNDARY (skewed fixture,
 *   qualified bound) tests.
 * - **Head stability / hysteresis**: with the budget fixed, appending entries
 *   to the TAIL leaves every `S(i)` for existing `i` unchanged and grows only
 *   `sTotal`, so `k` is fixed until `Q` tokens of new content accumulate — and
 *   while `k` is fixed, `cQ` is fixed, so the window HEAD does not move. It
 *   then jumps by one whole chunk. That head stability is the whole point: a
 *   prefix cache is invalidated by a moving head, and a per-turn slide defeats
 *   it every turn.
 * - **Entry-boundary cuts**: every value `cFinal` can take is derived by
 *   `Math.max`/`Math.min` over entry INDICES (`cMin`, `cQ`, `n - floor`), and
 *   the caller ships `rawHistory.slice(cFinal)` — so a cut falls between two
 *   entries rather than splitting one.
 *
 * FORWARD-COMPAT (no machinery built): if a history entry ever carries a tool
 * call, a tool-call and its tool-result must evict ATOMICALLY — an orphaned
 * `tool_calls` without its result is a provider error. No history entry
 * carries tool calls today, so this is a note for whoever adds them, not a
 * code path here.
 *
 * HONESTY: the budget itself jitters turn to turn (the current message's size
 * varies), which can move `k` near a chunk boundary. This is deliberately NOT
 * smoothed — there is no trimming data in production to tune a smoothing
 * scheme against, so any scheme would be fitted to imagined data. Chunk
 * boundaries live in evicted-TOKEN space, which makes `k` robust to jitter far
 * smaller than `Q`.
 */
export function computeEvictionCut(
  measures: number[],
  budget: number
): { cFinal: number; cMin: number; k: number; q: number; sTotal: number } {
  const n = measures.length;
  // The production caller guards `budgetAfterOverhead <= 0` before calling,
  // but this function is exported for direct use — and a non-positive budget
  // would make `q` zero in the quantize branch (reachable there via
  // zero-cost entries, which "fit" any budget), turning `k` into a
  // divide-by-zero. Nothing fits a non-positive budget: evict everything.
  if (budget <= 0) {
    const sTotal = measures.reduce((sum, m) => sum + m, 0);
    return { cFinal: n, cMin: n, k: 0, q: 0, sTotal };
  }
  const prefix: number[] = [0];
  for (let i = 0; i < n; i++) {
    prefix.push(prefix[i] + measures[i]);
  }
  const sTotal = prefix[n];

  let running = 0;
  let i = n - 1;
  for (; i >= 0; i--) {
    if (running + measures[i] > budget) {
      break;
    }
    running += measures[i];
  }
  const cMin = i + 1;

  if (sTotal <= budget) {
    return { cFinal: 0, cMin: 0, k: 0, q: 0, sTotal };
  }

  const fitCount = n - cMin;
  if (fitCount < HISTORY_EVICTION_MIN_ENTRY_FLOOR) {
    return { cFinal: cMin, cMin, k: 0, q: 0, sTotal };
  }

  const q = Math.ceil(HISTORY_EVICTION_CHUNK_RATIO * budget);
  const k = Math.ceil((sTotal - budget) / q);
  const threshold = k * q;
  let cQ = n;
  for (let i = 0; i <= n; i++) {
    if (prefix[i] >= threshold) {
      cQ = i;
      break;
    }
  }
  const cFinal = Math.max(cMin, Math.min(cQ, n - HISTORY_EVICTION_MIN_ENTRY_FLOOR));

  return { cFinal, cMin, k, q, sTotal };
}

/** Pre-compute <current_conversation> wrapper token overhead and location XML. */
function computeCurrentConversationOverhead(environment: DiscordEnvironment): {
  overhead: number;
  locationXml: string;
} {
  const locationXml = formatLocationAsXml(environment);
  const wrapperText = `<current_conversation>\n${locationXml}\n</current_conversation>`;
  return { overhead: countTextTokens(wrapperText), locationXml };
}

/** Wrap current channel XML in <current_conversation> with location, or return as-is. */
function wrapCurrentChannel(currentChannelXml: string, locationXml: string): string {
  if (currentChannelXml.length === 0 || locationXml.length === 0) {
    return currentChannelXml;
  }
  return `<current_conversation>\n${locationXml}\n${currentChannelXml}\n</current_conversation>`;
}

/** Combine cross-channel and current-channel sections (cross-channel first). */
function combineHistorySections(crossChannelXml: string, currentXml: string): string {
  if (crossChannelXml.length > 0 && currentXml.length > 0) {
    return `${crossChannelXml}\n${currentXml}`;
  }
  return crossChannelXml || currentXml;
}

export class ContextWindowManager {
  private memoryBudgetManager: MemoryBudgetManager;

  constructor(memoryBudgetManager?: MemoryBudgetManager) {
    this.memoryBudgetManager = memoryBudgetManager ?? new MemoryBudgetManager();
  }

  /**
   * Select and serialize conversation history as XML within token budget.
   * History is serialized inside the system prompt to prevent identity bleeding.
   * Cross-channel history is included when available and budget permits.
   */
  selectAndSerializeHistory(
    rawHistory: StructuredHistoryEntry[] | undefined,
    responder: ResponderIdentity,
    historyBudget: number,
    options: HistoryWindowOptions = {}
  ): {
    serializedHistory: string;
    historyTokensUsed: number;
    messagesIncluded: number;
    messagesDropped: number;
    crossChannelMessagesIncluded: number;
    /** The current-channel entries that actually shipped (newest-first walk
     * keeps a contiguous newest suffix) — the STM/LTM pre-pass derives the
     * EXACT dedup cutoff + shipped-message-id set from these. */
    selectedEntries: StructuredHistoryEntry[];
    /** The `<prior_conversations>` XML `serializeCrossChannelHistory` produced
     * (empty when cross-channel is disabled or nothing fit). Populated
     * regardless of the `realMessagesEnabled` flag — PR 2.3's real-message
     * path renders this verbatim as its own leading `HumanMessage`; the XML
     * path already folds it into `serializedHistory` via
     * `combineHistorySections` and does not need this field separately. */
    crossChannelXml: string;
  } {
    const { crossChannelGroups, currentEnvironment, realMessagesEnabled = false } = options;
    const hasCurrentChannel = rawHistory !== undefined && rawHistory.length > 0;
    const hasCrossChannel = crossChannelGroups !== undefined && crossChannelGroups.length > 0;

    if ((!hasCurrentChannel && !hasCrossChannel) || historyBudget <= 0) {
      return {
        serializedHistory: '',
        historyTokensUsed: 0,
        messagesIncluded: 0,
        messagesDropped: rawHistory?.length ?? 0,
        crossChannelMessagesIncluded: 0,
        selectedEntries: [],
        crossChannelXml: '',
      };
    }

    // Pre-compute <current_conversation> wrapper overhead and location XML.
    // Only applies when both environment and current-channel messages exist.
    const { overhead: computedOverhead, locationXml } =
      currentEnvironment !== undefined && hasCurrentChannel
        ? computeCurrentConversationOverhead(currentEnvironment)
        : { overhead: 0, locationXml: '' };
    // Flag-on, the <current_conversation> wrapper is never shipped —
    // `ContentBudgetManager.allocate` ships an empty `serializedHistory` to
    // the real-message system build — so charging its overhead here is a
    // phantom cost that would re-create the exact under-fill the flag-on
    // recalibration removes. `locationXml` above is still needed below to
    // build `serializedHistory` for diagnostics regardless of the flag.
    const currentConversationOverhead = realMessagesEnabled ? 0 : computedOverhead;

    // Select current-channel messages within budget, reserving space for the wrapper.
    // Deducting overhead upfront avoids a bounded overrun where selected messages +
    // wrapper could silently exceed historyBudget.
    const adjustedBudget = historyBudget - currentConversationOverhead;
    const { selectedEntries, currentChannelXml, tokensUsed } = hasCurrentChannel
      ? this.selectCurrentChannelEntries(rawHistory, responder, adjustedBudget, realMessagesEnabled)
      : { selectedEntries: [] as StructuredHistoryEntry[], currentChannelXml: '', tokensUsed: 0 };

    // Include wrapper overhead in tokens used (only when content exists to wrap)
    const adjustedTokensUsed =
      selectedEntries.length > 0 && currentConversationOverhead > 0
        ? tokensUsed + currentConversationOverhead
        : tokensUsed;

    // Serialize cross-channel history if available and budget remains
    const { crossChannelXml, crossChannelMessagesIncluded, crossTokens } = hasCrossChannel
      ? this.serializeCrossChannel(
          crossChannelGroups,
          responder,
          historyBudget,
          adjustedTokensUsed,
          realMessagesEnabled
        )
      : { crossChannelXml: '', crossChannelMessagesIncluded: 0, crossTokens: 0 };

    const actualTokens = adjustedTokensUsed + crossTokens;

    // Wrap current channel in <current_conversation> when environment is available
    const wrappedCurrentXml = wrapCurrentChannel(currentChannelXml, locationXml);

    // Combine: cross-channel before current channel (older context first)
    const serializedHistory = combineHistorySections(crossChannelXml, wrappedCurrentXml);

    return {
      serializedHistory,
      historyTokensUsed: actualTokens,
      messagesIncluded: selectedEntries.length,
      messagesDropped: (rawHistory?.length ?? 0) - selectedEntries.length,
      crossChannelMessagesIncluded,
      selectedEntries,
      crossChannelXml,
    };
  }

  /**
   * Select current-channel entries within budget. Selection policy (§2.5's
   * chunked eviction, `computeEvictionCut`) is FLAG-INDEPENDENT — it
   * operates on whichever per-entry measure the flag selects, and is
   * expected to be DORMANT in production (the dominant path is "everything
   * fetched fits the budget", handled byte-identically to before this cut was
   * introduced).
   */
  private selectCurrentChannelEntries(
    rawHistory: StructuredHistoryEntry[],
    responder: ResponderIdentity,
    historyBudget: number,
    realMessagesEnabled: boolean
  ): { selectedEntries: StructuredHistoryEntry[]; currentChannelXml: string; tokensUsed: number } {
    // Flag-on, history ships as real messages rather than inside a
    // `<chat_log>` wrapper, so charging this wrapper's overhead flag-on would
    // be a phantom cost re-creating the exact under-fill the recalibration
    // removes.
    const wrapperOverhead = realMessagesEnabled ? 0 : countTextTokens('<chat_log>\n</chat_log>');
    const budgetAfterOverhead = historyBudget - wrapperOverhead;

    if (budgetAfterOverhead <= 0) {
      return { selectedEntries: [], currentChannelXml: '', tokensUsed: 0 };
    }

    // Scoped to the FETCHED history, while the final render scopes to the
    // SELECTED subset. A name that appears only in a dropped entry therefore
    // widens the measurement but not the shipped XML — an over-measure, which
    // is the safe direction for a budget.
    const allPersonalityNames = collectPersonalityNames(rawHistory, responder.name);

    // Measured, not looked up: the DB's `tokenCount` counts raw content only,
    // so it omits the XML envelope (or real-message envelope) and every
    // metadata section this entry will actually ship. Every entry is
    // measured EXACTLY ONCE here, up front, so `computeEvictionCut`'s walk
    // reads the array rather than re-measuring.
    const measureEntry = realMessagesEnabled
      ? measureHistoryEntryRealTokens
      : measureHistoryEntryTokens;
    const measures = rawHistory.map(entry =>
      measureEntry(entry, responder.name, allPersonalityNames, responder.id)
    );

    const { cFinal, cMin, k, q, sTotal } = computeEvictionCut(measures, budgetAfterOverhead);
    const selectedEntries = rawHistory.slice(cFinal);

    const currentChannelXml = formatConversationHistoryAsXml(selectedEntries, responder.name, {
      responderPersonalityId: responder.id,
    });
    const tokensUsed =
      selectedEntries.length === 0
        ? 0
        : realMessagesEnabled
          ? this.measureRealMessagesTokens(selectedEntries, responder)
          : countTextTokens(currentChannelXml) + wrapperOverhead;

    // Gated on the CUT differing from the minimal walk, not on `k` alone: at
    // the exact entry floor (fitCount === floor) the quantize branch runs and
    // reports k > 0, but the floor clamp collapses the cut back to `cMin` —
    // a shipped set byte-identical to the pre-hysteresis behavior, which this
    // line must not report as a chunked eviction.
    if (cFinal > cMin) {
      const shippedMeasureTokens = measures.slice(cFinal).reduce((sum, m) => sum + m, 0);
      logger.info(
        {
          k,
          q,
          cMin,
          cFinal,
          fetched: rawHistory.length,
          shippedTokens: shippedMeasureTokens,
          sTotal,
          budget: budgetAfterOverhead,
        },
        'Chunked history eviction applied'
      );
    }

    logger.info(
      {
        selected: selectedEntries.length,
        total: rawHistory.length,
        tokensUsed,
        budget: historyBudget,
      },
      'Selected history messages'
    );

    return { selectedEntries, currentChannelXml, tokensUsed };
  }

  /**
   * Measure the exact shipped-form cost of the flag-on real-message render.
   * Building the real messages here to measure and again in
   * `ContentBudgetManager.allocate` to actually ship them is deliberate:
   * deterministic, cheap string work, and it keeps the reported cost an exact
   * re-measure of the shipped form rather than a second estimate.
   */
  private measureRealMessagesTokens(
    selectedEntries: StructuredHistoryEntry[],
    responder: ResponderIdentity
  ): number {
    const realMessages = buildRealMessages(selectedEntries, responder.name, responder.id);
    if (realMessages.length === 0) {
      return 0;
    }
    const contentTokens = realMessages.reduce(
      (sum, m) => sum + countTextTokens(contentToText(m.content)),
      0
    );
    return contentTokens + realMessages.length * PER_MESSAGE_WIRE_OVERHEAD_TOKENS;
  }

  /** Serialize cross-channel groups within remaining budget, re-measuring actual tokens. */
  private serializeCrossChannel(
    groups: CrossChannelHistoryGroupEntry[],
    responder: ResponderIdentity,
    historyBudget: number,
    currentChannelTokensUsed: number,
    realMessagesEnabled: boolean
  ): { crossChannelXml: string; crossChannelMessagesIncluded: number; crossTokens: number } {
    if (currentChannelTokensUsed >= historyBudget) {
      return { crossChannelXml: '', crossChannelMessagesIncluded: 0, crossTokens: 0 };
    }

    const crossResult = serializeCrossChannelHistory(
      groups,
      responder.name,
      historyBudget - currentChannelTokensUsed,
      responder.id
    );

    if (crossResult.xml.length === 0) {
      return { crossChannelXml: '', crossChannelMessagesIncluded: 0, crossTokens: 0 };
    }

    // Re-measure actual tokens; may slightly exceed historyBudget due to char/4
    // approximation in serializeCrossChannelHistory (non-ASCII content like CJK or
    // emoji server names can widen the gap).
    //
    // Design decision: we accept the overrun rather than trimming because:
    // 1. The serializer's own budget check (chars/4) is conservative for ASCII/English,
    //    so overruns only occur with non-ASCII-heavy content and are typically small
    //    (typically <50 tokens for ASCII; CJK-heavy content may be higher).
    // 2. Trimming would require re-serializing all groups (the XML is already built).
    // 3. The model's context limit has a separate safety margin — historyBudget is the
    //    *history slice* of a larger window, not the hard model limit.
    // The >5% info log below provides production visibility for monitoring.
    //
    // Flag-on, cross-channel content still ships as XML (unchanged), but as
    // its OWN leading `HumanMessage` rather than folded into the system
    // prompt — so it pays the same per-message wire overhead a real message
    // pays, charged here once rather than per cross-channel entry.
    const crossTokens =
      countTextTokens(crossResult.xml) +
      (realMessagesEnabled ? PER_MESSAGE_WIRE_OVERHEAD_TOKENS : 0);
    const totalTokens = currentChannelTokensUsed + crossTokens;
    logger.info(
      {
        crossTokens,
        crossChannelMessagesIncluded: crossResult.messagesIncluded,
        channelCount: groups.length,
      },
      'Added cross-channel history'
    );

    if (totalTokens > historyBudget) {
      const overrun = totalTokens - historyBudget;
      const overrunPercent = historyBudget > 0 ? overrun / historyBudget : 0;
      const logData = { actualTokens: totalTokens, historyBudget, overrun };
      if (overrunPercent > 0.05) {
        logger.info(logData, 'Cross-channel budget overrun >5% (bounded)');
      } else {
        logger.debug(logData, 'Cross-channel budget overrun (bounded)');
      }
    }

    return {
      crossChannelXml: crossResult.xml,
      crossChannelMessagesIncluded: crossResult.messagesIncluded,
      crossTokens,
    };
  }

  /**
   * Select memories that fit within a token budget
   *
   * Delegates to MemoryBudgetManager for the actual selection logic.
   * See MemoryBudgetManager.selectMemoriesWithinBudget for details.
   */
  selectMemoriesWithinBudget(
    memories: MemoryDocument[],
    tokenBudget: number,
    timezone?: string
  ): MemorySelectionResult {
    return this.memoryBudgetManager.selectMemoriesWithinBudget(memories, tokenBudget, timezone);
  }

  /**
   * Calculate the token budget for memories
   *
   * Delegates to MemoryBudgetManager for the actual calculation.
   * See MemoryBudgetManager.calculateMemoryBudget for details.
   */
  calculateMemoryBudget(
    contextWindowTokens: number,
    systemPromptBaseTokens?: number,
    currentMessageTokens?: number,
    historyTokens?: number
  ): number {
    return this.memoryBudgetManager.calculateMemoryBudget(
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      historyTokens
    );
  }

  /**
   * Count total tokens in conversation history
   *
   * Delegates to MemoryBudgetManager for the actual counting.
   * See MemoryBudgetManager.countHistoryTokens for details.
   */
  countHistoryTokens(
    rawHistory: StructuredHistoryEntry[] | undefined,
    responder: ResponderIdentity,
    realMessagesEnabled = false
  ): number {
    return this.memoryBudgetManager.countHistoryTokens(
      rawHistory,
      responder.name,
      responder.id,
      realMessagesEnabled
    );
  }
}
