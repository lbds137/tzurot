/**
 * Count-cap hysteresis for the channel-history window.
 *
 * A FULL history window slides its start by one message per turn, so the head
 * of `<chat_log>` changes every turn and everything from it onward re-bills
 * against the provider's prompt cache. Quantizing the eviction fixes the
 * window-start element for a whole chunk of new messages at a time: the head
 * is byte-stable and the tail appends, which is the shape prefix caching
 * rewards. The start then jumps once per `chunk` new messages — one accepted
 * miss instead of one per turn.
 *
 * Design: `docs/proposals/backlog/prompt-assembly-architecture.md` §2.5.2 (D1, D2).
 */

export const HISTORY_WINDOW = {
  /**
   * Fraction of the cap evicted per hysteresis step. A head jump re-bills the
   * whole post-head suffix, so expected re-bill per message is
   * `windowTokens / chunk` — a larger chunk is cheaper, traded against how
   * much context leaves at once. Tunable from telemetry.
   */
  EVICTION_CHUNK_RATIO: 0.25,
  /** The window never quantizes below this many messages. */
  MIN_MESSAGE_FLOOR: 20,
  /**
   * Below this cap hysteresis is off: a small window is cheap to re-bill, and
   * quantization would eat too large a share of it.
   */
  MIN_CAP_FOR_HYSTERESIS: 20,
} as const;

/** The resolved fetch window for one request. */
export interface HistoryWindow {
  /** Rows dropped from the OLD end, quantized to `chunk`. */
  evicted: number;
  /** Rows to fetch, newest-first. Always `inScopeCount - evicted`. */
  take: number;
  /**
   * The eviction chunk in force. `0` means hysteresis is off for this cap and
   * the window tracks the row count exactly (the pre-hysteresis behavior).
   */
  chunk: number;
}

/**
 * What the window actually did, for the telemetry that tunes it.
 *
 * `headRowId` is the identity of the window-START row: it is the value that
 * must NOT change turn-to-turn within a chunk, so it is the one field that
 * makes the design falsifiable from logs alone. A run of turns whose
 * `headRowId` changes every time means the hysteresis is not holding, whatever
 * the arithmetic says.
 */
export interface HistoryWindowMeta {
  /** Rows matching the fetch predicate, counted in-snapshot. */
  inScopeCount: number;
  evicted: number;
  /** Rows actually IN the window — what came back, not what was asked for. */
  take: number;
  chunk: number;
  /** Id of the oldest row in the returned window; null when it is empty. */
  headRowId: string | null;
  /** True when the read failed and the empty window is a fallback, not a fact. */
  degraded: boolean;
}

/**
 * Resolve the eviction chunk for a cap.
 *
 * Returns 0 when hysteresis does not apply. Note this includes `cap` exactly
 * equal to the floor: `cap - MIN_MESSAGE_FLOOR` is 0 there, so there is no
 * room to quantize without breaching the floor. Hysteresis therefore begins
 * one message above the floor, not at it.
 */
export function resolveEvictionChunk(cap: number): number {
  if (cap < HISTORY_WINDOW.MIN_CAP_FOR_HYSTERESIS) {
    return 0;
  }
  const chunk = Math.min(
    Math.ceil(HISTORY_WINDOW.EVICTION_CHUNK_RATIO * cap),
    cap - HISTORY_WINDOW.MIN_MESSAGE_FLOOR
  );
  return chunk > 0 ? chunk : 0;
}

/**
 * Given how many rows are in scope and the resolved cap, decide how many to
 * evict and how many to fetch.
 *
 * The window-start element is the `(evicted + 1)`-th oldest in-scope row. As
 * `inScopeCount` grows with `evicted` held fixed, that element does not move —
 * which is the entire point. Both inputs must come from ONE snapshot: derived
 * from separate reads, a write landing in between slides the head for that
 * request and reintroduces the disease this cures.
 *
 * @param inScopeCount - rows matching the fetch predicate, counted in-snapshot
 * @param cap - the resolved message cap for this request
 */
export function resolveHistoryWindow(inScopeCount: number, cap: number): HistoryWindow {
  const effectiveCap = Math.max(0, cap);
  const chunk = resolveEvictionChunk(effectiveCap);

  if (inScopeCount <= effectiveCap || chunk === 0) {
    // Unfull window, or hysteresis off: take everything up to the cap, exactly
    // as the pre-hysteresis fetch did.
    return { evicted: 0, take: Math.min(inScopeCount, effectiveCap), chunk };
  }

  const evicted = chunk * Math.ceil((inScopeCount - effectiveCap) / chunk);
  return { evicted, take: inScopeCount - evicted, chunk };
}
