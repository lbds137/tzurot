/**
 * Diagnostic log retention: how long `llm_diagnostic_logs` rows live before
 * the cleanup job deletes them. Internal debug data, not a privacy-policy
 * window, so it lives apart from `retention.ts` (whose values the published
 * policy states).
 *
 * Consumed by ai-worker's CleanupDiagnosticLogs (the delete cutoff) and by
 * tooling's upstream-host report (the window it can honestly claim).
 */

/** Diagnostic log retention in hours (7 days). Changing it changes the telemetry windows. */
export const DIAGNOSTIC_LOG_RETENTION_HOURS = 168;

/** Diagnostic rows are pruned after this many whole days; a larger reporting window reads the same data. */
export const DIAGNOSTIC_RETENTION_DAYS = Math.ceil(DIAGNOSTIC_LOG_RETENTION_HOURS / 24);
