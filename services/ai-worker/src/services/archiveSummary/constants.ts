/** Bump when the summarizer's system/user prompt text changes meaningfully —
 *  a re-summarize sweep keys off this to know which stored summaries are stale. */
export const ARCHIVE_SUMMARY_PROMPT_VERSION = 1;

/** A summary at or under this length needs no regeneration pass. */
export const SUMMARY_SOFT_CAP_TOKENS = 80;

/** A final summary over this length is a billed `overflow` failure — never truncated. */
export const SUMMARY_HARD_CAP_TOKENS = 120;

/** Consecutive billed failures against the same content before a row is marked `dead`. */
export const MAX_SUMMARY_ATTEMPTS = 3;

/** One short summary call, same scale as the roster blurb's 60s budget. */
export const ARCHIVE_SUMMARY_TIMEOUT_MS = 60_000;

/** Reasoning is disabled for this call, so 512 is ample for a ~60-word summary plus its JSON wrapper. */
export const ARCHIVE_SUMMARY_MAX_TOKENS = 512;

/** Delay when a switch is off — the event being waited on is a manual flip, not a clock. */
export const SWITCH_OFF_DELAY_MS = 10 * 60_000;

/** Delay when the daily budget is exhausted — the event being waited on is the UTC-day rollover. */
export const BUDGET_DELAY_MS = 60 * 60_000;

/** Route-misconfiguration errors log at most this often per process — long
 *  enough not to spam a hot queue, short enough that a repeat
 *  misconfiguration later in the process's life is still surfaced. */
export const ROUTE_ERROR_LOG_INTERVAL_MS = 60 * 60_000;

/** BullMQ worker rate limiter for the archive-summary queue. */
export const ARCHIVE_SUMMARY_RATE_LIMIT = { max: 10, duration: 60_000 } as const;
