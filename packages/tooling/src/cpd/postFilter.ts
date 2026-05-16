/**
 * Post-filter for jscpd output
 * ============================
 *
 * jscpd detects clones at the token-stream level and cannot distinguish
 * *standardized call sites of shared helpers* (good architecture) from
 * *copy-pasted business logic* (real debt). Both look identical at the
 * token level — a fragment like
 * `findGlobalConfigOrSendError(res, () => prisma.X.findUnique({...}), {...})`
 * repeated across consumers reads as duplication even though each
 * occurrence is a legitimate reference to a shared abstraction.
 *
 * This module classifies each clone fragment as either:
 * - **call-dominant** (helper call sites; not real duplication)
 * - **logic** (actual duplicated business logic; real debt)
 *
 * The filtered count excludes call-dominant fragments and is the metric
 * used by the CI ratchet. The raw jscpd count remains informational.
 *
 * Why a line-pattern heuristic, not a full AST parser:
 *   jscpd fragments often start/end mid-expression (e.g. `}),\n }, opts);`)
 *   so even ts-morph's error-tolerant parser produces noisy descendant
 *   counts. Line-pattern matching is brittle in general but a good fit
 *   for THIS narrow question — "is this clone mostly call-shape lines or
 *   mostly logic-shape lines?" — because both call sites and control flow
 *   leave very distinct line signatures.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Shape of a single duplicate entry in jscpd's JSON output (subset we use). */
interface JscpdDuplicate {
  format: string;
  lines: number;
  fragment: string;
  firstFile: { name: string; start: number; end: number };
  secondFile: { name: string; start: number; end: number };
}

/** Shape of jscpd's full JSON output (subset we use). */
interface JscpdReport {
  statistics: {
    total: {
      clones: number;
      duplicatedLines: number;
      lines: number;
      percentage: number;
    };
  };
  duplicates: JscpdDuplicate[];
}

/** Classification of a single line within a fragment. */
type LineClass = 'call' | 'structural' | 'noise';

/** Matches a line that begins with a function/method call expression.
 *  Covers: `foo()`, `foo.bar()`, `await foo()`, `!(await foo())`, etc. */
const CALL_PATTERN = /^\s*(?:!?\(?await\s+)?[\w$][\w$.]*\s*\(/;

/** Matches control-flow keywords anywhere in a line.
 *  These are unambiguous logic signals regardless of position. */
const CONTROL_FLOW_PATTERN =
  /\b(?:if|else|for|while|do|switch|case|return|throw|try|catch|finally|continue|break|new\s+\w)\b/;

/** Matches declaration keywords at line start (after whitespace).
 *  Position-anchored to avoid false positives like `{ type: 'USER' }` or
 *  `{ const: 'foo' }` (object-literal field names that happen to be
 *  reserved-ish words). */
const DECLARATION_PATTERN = /^\s*(?:const|let|var|function|class|interface|type|enum)\s+\w/;

/** Matches a line that's only punctuation/braces/closing tokens.
 *  These are continuation/formatting noise — neither call nor logic. */
const NOISE_PATTERN = /^[\s})(,;[\]]*$/;

/**
 * Classify a single trimmed line by its shape.
 * - `'structural'` if it contains control flow, declarations, or comparisons
 * - `'call'` if it begins with a call-expression pattern
 * - `'noise'` otherwise (continuation lines, object-literal field syntax,
 *   stray punctuation — anything we can't confidently classify)
 *
 * Order matters: structural is checked before call because a line like
 * `if (await maybeCall()) {` should classify as structural (it's logic),
 * not as a call site.
 */
export function classifyLine(line: string): LineClass {
  const trimmed = line.trim();
  if (NOISE_PATTERN.test(trimmed)) return 'noise';
  if (CONTROL_FLOW_PATTERN.test(trimmed)) return 'structural';
  if (DECLARATION_PATTERN.test(line)) return 'structural';
  if (CALL_PATTERN.test(trimmed)) return 'call';
  return 'noise';
}

/** Result of classifying a single clone fragment. */
export interface FragmentClassification {
  /** Total non-empty lines in the fragment. */
  totalLines: number;
  /** Lines classified as call-expression shape. */
  callLines: number;
  /** Lines classified as structural/business logic. */
  structuralLines: number;
  /** Lines classified as noise (continuation/punctuation). */
  noiseLines: number;
  /** Ratio of call-shape to call+structural lines (ignoring noise). */
  callRatio: number;
  /** Whether this fragment is considered "call-dominant" (≥ threshold). */
  isCallDominant: boolean;
}

/**
 * Classify a clone fragment. A fragment is call-dominant when, among the
 * lines we can confidently classify, calls outnumber structural lines at
 * or above the threshold.
 *
 * The default threshold of 0.8 means a fragment with 4 call lines and 1
 * structural line counts as call-dominant (real but minor logic mixed in
 * with mostly helper-call shape). A fragment with 3 call lines and 2
 * structural lines does NOT — at 60% call ratio, the logic is significant
 * enough that the fragment represents real shared structure rather than
 * just helper-call uniformity.
 */
export function classifyFragment(fragment: string, threshold = 0.8): FragmentClassification {
  const lines = fragment.split('\n').filter(l => l.trim().length > 0);
  let callLines = 0;
  let structuralLines = 0;
  let noiseLines = 0;
  for (const line of lines) {
    const cls = classifyLine(line);
    if (cls === 'call') callLines++;
    else if (cls === 'structural') structuralLines++;
    else noiseLines++;
  }
  const classifiable = callLines + structuralLines;
  const callRatio = classifiable > 0 ? callLines / classifiable : 0;
  return {
    totalLines: lines.length,
    callLines,
    structuralLines,
    noiseLines,
    callRatio,
    isCallDominant: classifiable > 0 && callRatio >= threshold,
  };
}

/** Result of running the filter against a full jscpd report. */
export interface FilterResult {
  /** Raw count from jscpd output. */
  rawCount: number;
  /** Raw duplicated-lines from jscpd output. */
  rawLines: number;
  /** Filtered count: clones minus call-dominant fragments. */
  filteredCount: number;
  /** Filtered duplicated-lines: sum of lines from non-call-dominant fragments. */
  filteredLines: number;
  /** How many clones were excluded as call-dominant. */
  excludedCount: number;
  /** Breakdown of the file pairs producing the remaining (filtered) clones. */
  remainingByPair: { pair: string; clones: number; lines: number }[];
}

/**
 * Run the post-filter against a parsed jscpd report.
 *
 * @param threshold Call-ratio threshold for "call-dominant" classification
 *   (default 0.8 per GLM's recommendation). Lower → more inclusive (more
 *   clones filtered out); higher → stricter (only the most call-saturated
 *   fragments excluded).
 */
export function filterReport(report: JscpdReport, threshold = 0.8): FilterResult {
  const rawCount = report.statistics.total.clones;
  const rawLines = report.statistics.total.duplicatedLines;

  let filteredCount = 0;
  let filteredLines = 0;
  let excludedCount = 0;
  const pairAgg = new Map<string, { clones: number; lines: number }>();

  for (const dup of report.duplicates) {
    const { isCallDominant } = classifyFragment(dup.fragment, threshold);
    if (isCallDominant) {
      excludedCount++;
      continue;
    }
    filteredCount++;
    filteredLines += dup.lines;

    const a = relativeName(dup.firstFile.name);
    const b = relativeName(dup.secondFile.name);
    const key = [a, b].sort().join(' <-> ');
    const prev = pairAgg.get(key) ?? { clones: 0, lines: 0 };
    pairAgg.set(key, { clones: prev.clones + 1, lines: prev.lines + dup.lines });
  }

  const remainingByPair = [...pairAgg.entries()]
    .map(([pair, agg]) => ({ pair, ...agg }))
    .sort((a, b) => b.lines - a.lines);

  return { rawCount, rawLines, filteredCount, filteredLines, excludedCount, remainingByPair };
}

/** Strip the absolute prefix to keep output readable. */
function relativeName(absPath: string): string {
  const cwd = process.cwd();
  return absPath.startsWith(cwd) ? absPath.slice(cwd.length + 1) : absPath;
}

/** Conventional output path for jscpd's JSON report (configured in `.jscpd.json`).
 *  Single source of truth for the report location — CLI commands import this
 *  rather than redefining the string locally. */
export const JSCPD_REPORT_PATH = 'reports/jscpd/jscpd-report.json';

/** Load jscpd report JSON from the given path. Defaults to JSCPD_REPORT_PATH.
 *
 *  Validates the report shape minimally so a schema drift in jscpd's output
 *  (e.g. a future renamed field) surfaces as a clear error rather than
 *  silently producing `NaN` propagation through the filter. Same defensive
 *  shape as `parseBaseline` in commands/cpd.ts. */
export function loadJscpdReport(reportPath: string = JSCPD_REPORT_PATH): JscpdReport {
  const full = resolve(process.cwd(), reportPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(full, 'utf-8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`jscpd report at ${reportPath} is not valid JSON: ${message}`, { cause: err });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`jscpd report at ${reportPath} must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.duplicates)) {
    throw new Error(
      `jscpd report at ${reportPath} missing or invalid 'duplicates' array (jscpd schema drift?)`
    );
  }
  const statsRoot = obj.statistics as { total?: unknown } | undefined;
  const total = statsRoot?.total as Record<string, unknown> | undefined;
  if (total === undefined || typeof total.clones !== 'number') {
    throw new Error(
      `jscpd report at ${reportPath} missing 'statistics.total.clones' (jscpd schema drift?)`
    );
  }
  if (typeof total.duplicatedLines !== 'number') {
    throw new Error(
      `jscpd report at ${reportPath} missing 'statistics.total.duplicatedLines' (jscpd schema drift?)`
    );
  }
  return parsed as JscpdReport;
}
