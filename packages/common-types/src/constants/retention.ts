/**
 * Retention policy windows — the numbers the published privacy policy states.
 *
 * Shared here because two services must agree on them: api-gateway's
 * eligibility predicates (services/api-gateway/src/services/retention/
 * eligibility.ts is the single home of the SQL that consumes them) and
 * bot-client's warning-notice copy (which tells the user these numbers).
 * Changing either value is a POLICY change, not a tuning knob — the policy
 * text at /privacy must move in the same release.
 */
export const RETENTION_POLICY = {
  /**
   * The single inactivity window (epic decision: ONE 180-day window, not the
   * rejected flat-90d). Inactivity is measured from last_active_at, falling
   * back to created_at when the tracking clock never stamped.
   */
  WINDOW_DAYS: 180,
  /**
   * The reachable branch's grace window (Phase 3, owner call): days between
   * the warning DM landing and purge eligibility. Any bot use during grace
   * clears retention_notified_at and exits the pipeline entirely.
   */
  GRACE_PERIOD_DAYS: 30,
} as const;
