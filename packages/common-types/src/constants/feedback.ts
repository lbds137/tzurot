/**
 * Feedback-intake abuse gates (owner-set posture: /feedback is a spam/DoS
 * vector; gates run cheap-first in api-gateway). Values are deliberate
 * constants — fold into admin-settings runtime config only if retuning
 * becomes a habit.
 */
export const FEEDBACK_LIMITS = {
  /** Mirrors user_feedback.content VarChar(2000). */
  MAX_LENGTH: 2000,
  /** Minimum gap between submissions per user. */
  COOLDOWN_SECONDS: 300,
  /** Submission ATTEMPTS per user per UTC day (rejected duplicates count). */
  DAILY_CAP: 5,
  /** Near-dup dedupe lookback: same normalized content within this window is rejected. */
  DEDUPE_WINDOW_DAYS: 7,
} as const;
