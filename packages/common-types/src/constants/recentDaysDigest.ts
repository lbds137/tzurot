/**
 * Shared constants for the recent-days digest: the status vocabulary, the
 * prompt version, and the sweep's tuning knobs. Lives in common-types
 * because the selection query (read by both ai-worker's sweep and the
 * tooling ops command) and the sweep itself both need these, and tooling
 * cannot import from a service.
 */

/** The `persona_personality_digests.digest_status` state machine. */
export const RECENT_DAYS_DIGEST_STATUS = {
  PENDING: 'pending',
  DONE: 'done',
  FAILED: 'failed',
  DEAD: 'dead',
} as const;

export type RecentDaysDigestStatus =
  (typeof RECENT_DAYS_DIGEST_STATUS)[keyof typeof RECENT_DAYS_DIGEST_STATUS];

/** Bump when the digest prompt's rules change meaningfully — the selection
 *  query re-admits every row generated under an older version. */
export const RECENT_DAYS_DIGEST_PROMPT_VERSION = 1;

export const RECENT_DAYS_DIGEST = {
  /** Source rows older than this many days never enter a digest's window. */
  WINDOW_DAYS: 7,
  /** A pair already at `done` waits at least this long before a routine regeneration. */
  MIN_REGEN_INTERVAL_MS: 2 * 60 * 60_000,
  /** Ceiling on billed generations per sweep tick — the spend bound at this cadence. */
  MAX_GENERATIONS_PER_SWEEP: 10,
  /** Newest source rows kept before the token cap below is applied. */
  MAX_SOURCE_MESSAGES: 200,
  /** Oldest rows are dropped until the input's summed token count is at or under this. */
  MAX_SOURCE_TOKENS: 40_000,
  /** A digest at or under this length needs no regeneration pass. */
  SOFT_CAP_TOKENS: 350,
  /** A final digest over this length is a billed `overflow` failure — never truncated. */
  HARD_CAP_TOKENS: 450,
  /** Consecutive billed failures against the same watermark before a pair is marked `dead`. */
  MAX_ATTEMPTS: 3,
  /** One digest call's hard deadline. */
  TIMEOUT_MS: 60_000,
  /** Reasoning is off for this call; ample for a ~250-word digest plus its JSON wrapper. */
  MAX_OUTPUT_TOKENS: 768,
  /** Quoted-run length that counts as lifting the character's own phrasing. */
  QUOTATION_NGRAM: 8,
} as const;

/** `usage_logs.request_type` for every digest generation call. */
export const RECENT_DAYS_DIGEST_REQUEST_TYPE = 'recent_days_digest';

/** The scheduled-worker job NAME (not a `JobType`) for the digest sweep tick. */
export const RECENT_DAYS_DIGEST_SWEEP_JOB = 'recent-days-digest-sweep';

/**
 * Six sweeps an hour at :06, :16, :26, :36, :46, :56 — offset from the
 * roster-blurb sweep's :04/:14/... marks so the two inline sweeps never
 * share a tick on the concurrency-1 scheduled worker.
 */
export const RECENT_DAYS_DIGEST_SWEEP_PATTERN = '6,16,26,36,46,56 * * * *';

/** The `persona_personality_digests.last_error` vocabulary — exactly the
 *  classes the generator's validator can produce. */
export type DigestFailureClass = 'first_person' | 'quotation' | 'overflow' | 'parse_failure';
