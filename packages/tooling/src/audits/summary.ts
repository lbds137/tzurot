/**
 * Audit Summary Line
 *
 * Standardized one-line JSON summary that every audit tool emits when invoked
 * with `--summary`. The aggregator (`pnpm ops:health`, planned) parses this
 * line; the full human-readable report stays on the default code path.
 *
 * Shape locked by `docs/reference/audit-enforcement.md`
 * Layer 1. Changing it requires updating the proposal AND any consumers.
 */

export interface AuditSummary {
  /** Tool identifier (matches the `pnpm ops <tool>` command name). */
  tool: string;
  /**
   * Aggregate verdict. `ok` = clean; `warn` = soft findings (approaching but
   * not over hard limit); `fail` = at/over hard limit or canary missing.
   *
   * **Aggregator contract**: trust `status` for verdicts. Do NOT derive
   * pass/fail from `findings > baseline` — those two fields are observability
   * metrics, not the verdict signal. A tool may legitimately emit
   * `{status:'warn', findings:12, baseline:0}` to mean "12 items approaching
   * but none over hard limit." Treating that as failure (via findings >
   * baseline) would contradict the tool's own verdict.
   */
  status: 'ok' | 'warn' | 'fail';
  /**
   * Total count of findings the tool surfaced (regressions, violations,
   * approaching items, etc.). Includes both soft-warn items and hard-fail
   * items — granularity is tool-internal. For aggregator dashboards only;
   * does NOT determine pass/fail (see `status`).
   */
  findings: number;
  /**
   * Historical baseline count — for tools that ratchet (e.g., CPD). For
   * tools without a maintained baseline file, `0` means "no historical
   * reference." Again: observability metric, not verdict signal.
   */
  baseline: number;
  /** Optional metadata for staleness/drift detection. The aggregator uses these to detect config-hash mismatches alongside calendar age. */
  meta?: {
    /** Tool-internal version string (semver or hash). */
    toolVersion?: string;
    /** Hash of tool-relevant config (e.g., ESLint rule thresholds). */
    configHash?: string;
    /** Node version the tool ran under. */
    nodeVersion?: string;
    /** Git SHA the audit was generated against. */
    generatedFromSha?: string;
    /** ISO-8601 timestamp of when the summary was emitted. */
    generatedAt?: string;
  };
}

/**
 * Emit a JSONL summary line to stdout. The line is exactly one JSON object
 * with a trailing newline. The aggregator parses with `JSON.parse(lastLine)`.
 *
 * Side effect: writes to stdout. Intentional — the contract is "summary line
 * on stdout, full report elsewhere."
 */
export function emitSummary(summary: AuditSummary): void {
  console.log(JSON.stringify(summary));
}

/**
 * Parse a JSONL summary line. Used by the aggregator and by canary tests
 * that need to verify a tool emitted the right shape.
 *
 * Throws on malformed input (missing required fields, bad JSON) — the
 * aggregator should treat parse failures as `status: 'fail'` on the calling
 * side; this function intentionally fails loud so we never silently accept
 * garbage.
 */
export function parseSummary(line: string): AuditSummary {
  const parsed: unknown = JSON.parse(line);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // `typeof [] === 'object'` so explicit Array.isArray() check is required
    // — otherwise an array input produces a downstream "`tool` must be a
    // string, got undefined" error that obscures the real shape mismatch.
    const shape = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
    throw new Error(`AuditSummary: expected object, got ${shape}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.tool !== 'string') {
    throw new Error(`AuditSummary: \`tool\` must be a string, got ${typeof obj.tool}`);
  }
  if (obj.status !== 'ok' && obj.status !== 'warn' && obj.status !== 'fail') {
    throw new Error(`AuditSummary: \`status\` must be ok|warn|fail, got ${String(obj.status)}`);
  }
  if (typeof obj.findings !== 'number') {
    throw new Error(`AuditSummary: \`findings\` must be a number, got ${typeof obj.findings}`);
  }
  if (obj.findings < 0) {
    throw new Error(`AuditSummary: \`findings\` must be >= 0, got ${obj.findings}`);
  }
  if (typeof obj.baseline !== 'number') {
    throw new Error(`AuditSummary: \`baseline\` must be a number, got ${typeof obj.baseline}`);
  }
  if (obj.baseline < 0) {
    throw new Error(`AuditSummary: \`baseline\` must be >= 0, got ${obj.baseline}`);
  }
  // The `unknown` intermediate is required: TS can't track that the
  // field-level guards above narrowed `obj` from `Record<string, unknown>`
  // to the AuditSummary shape, so a direct `as AuditSummary` is a TS2352
  // error. The double-cast is the canonical workaround.
  return obj as unknown as AuditSummary;
}
