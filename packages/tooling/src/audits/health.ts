/**
 * `pnpm ops health` — the dumb audit aggregator (Layer 5 of the
 * audit-enforcement architecture — `docs/reference/audit-enforcement.md`).
 *
 * Runs every summary-capable, statically-runnable audit tool as a real
 * `pnpm ops <tool> --summary` subprocess, parses the one JSONL summary line
 * each emits (the contract in `audits/summary.ts`), and prints a single
 * consolidated report. No orchestration, no conditional execution, no
 * file-hash cleverness — a for-loop a solo dev can debug half-asleep, by
 * design (council consensus: smart orchestration was premature optimization
 * at this tool count).
 *
 * A tool that exits non-zero but emits a well-formed `status: 'fail'` line
 * is a FINDING (the tool works; the codebase failed the audit). A tool that
 * emits no parseable summary line is BROKEN (the tool itself rotted) —
 * reported separately and loudly, because silent tool rot is the exact
 * failure mode this architecture exists to catch.
 *
 * Tool-list criteria (deliberately static — edit the const to change it):
 * summary-capable + runnable from a bare checkout (no DB, no prod creds, no
 * prior report artifact). Tools enforced per-PR anyway (e.g. mutation:check,
 * which also needs a Stryker report artifact) are excluded — the aggregator
 * exists for cadence coverage, not to re-run the per-PR gates.
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { parseSummary, type AuditSummary } from './summary.js';

/**
 * The static tool roster. Add a tool when it gains `--summary` support AND
 * its bare (argument-less) run is meaningful as a recurring health signal.
 *
 * Deliberately absent (with follow-ups filed to tune their bare-run modes):
 * - `lint:complexity-report` — a repo-wide run includes the deliberately-
 *   broken audit-canary fixture, so it structurally always fails; needs a
 *   fixture exclusion + a baseline before it can gate weekly.
 * - `db:check-safety` — a bare run re-flags HISTORICAL (applied, reviewed)
 *   migrations forever; needs a recent/unapplied-range mode.
 * A perma-red row is alert-fatigue poison — the weekly report only earns
 * trust if red means "act now."
 */
export const HEALTH_TOOLS = [
  'guard:proposal-links',
  'guard:boundaries',
  'guard:audit-tool-docs',
  'guard:claude-content-refs',
  'commands:audit',
] as const;

export interface ToolHealth {
  tool: string;
  /** Parsed summary when the tool emitted one; null = tool is BROKEN. */
  summary: AuditSummary | null;
  /** Why parsing failed (only when summary is null). */
  brokenReason?: string;
}

export interface HealthReport {
  results: ToolHealth[];
  /** ok = all tools ok; warn = soft findings only; fail = any fail OR any broken tool. */
  overall: 'ok' | 'warn' | 'fail';
}

/**
 * Extract the last parseable JSONL summary line from a tool's stdout.
 * Tools print human-readable report lines too; the summary contract is
 * "exactly one JSON object line", conventionally last — scanning backwards
 * tolerates report noise without trusting anything but a valid line.
 */
export function extractSummaryLine(stdout: string): AuditSummary | null {
  const lines = stdout.split('\n').filter(l => l.trim().startsWith('{'));
  for (const line of lines.reverse()) {
    try {
      return parseSummary(line.trim());
    } catch {
      // Not the summary line (e.g. JSON-ish report output) — keep scanning.
    }
  }
  return null;
}

/** Pure aggregation of per-tool results into the overall verdict. */
export function aggregateHealth(results: ToolHealth[]): HealthReport {
  let overall: HealthReport['overall'] = 'ok';
  for (const result of results) {
    if (result.summary === null || result.summary.status === 'fail') {
      overall = 'fail';
      break;
    }
    if (result.summary.status === 'warn') {
      overall = 'warn';
    }
  }
  return { results, overall };
}

/**
 * Compose the BROKEN reason from the exec error, preferring the tool's own
 * stderr diagnostics — the weekly Discord report is often the only place a
 * broken tool gets debugged from.
 */
function describeBrokenTool(error: unknown): string {
  const execError = error as { stderr?: string | Buffer };
  const stderrLine =
    typeof execError.stderr === 'string' ? execError.stderr.trim().split('\n').at(-1) : undefined;
  const errorLine = error instanceof Error ? error.message.split('\n')[0] : String(error);
  return stderrLine !== undefined && stderrLine.length > 0
    ? `${errorLine} — ${stderrLine}`
    : errorLine;
}

/**
 * Per-tool subprocess budget. A hung tool (deadlock, infinite loop) must
 * fail fast into the BROKEN state the aggregator exists to report — not
 * block the sequential loop until the workflow-level timeout.
 */
const TOOL_TIMEOUT_MS = 5 * 60 * 1000;

/** Run one tool as a real subprocess; never throws (captures exit + output). */
function runTool(tool: string): ToolHealth {
  let stdout: string;
  // Carried past the try so the no-summary fall-through can still surface
  // the crash's own diagnostics: a tool that prints partial non-summary
  // stdout ("Loading…") before dying non-zero must not lose its stderr
  // root-cause line to the generic no-summary message.
  let caughtError: unknown;
  try {
    stdout = execFileSync('pnpm', ['ops', tool, '--summary'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout: TOOL_TIMEOUT_MS,
    });
  } catch (error) {
    // Non-zero exit still usually carries the summary line on stdout —
    // a failing audit is a finding, not a broken tool.
    caughtError = error;
    const execError = error as { stdout?: string | Buffer };
    stdout = typeof execError.stdout === 'string' ? execError.stdout : '';
    if (stdout.length === 0) {
      return { tool, summary: null, brokenReason: describeBrokenTool(error) };
    }
  }

  const summary = extractSummaryLine(stdout);
  if (summary === null) {
    return {
      tool,
      summary: null,
      brokenReason:
        caughtError === undefined
          ? 'no parseable JSONL summary line on stdout'
          : `no parseable JSONL summary line on stdout — ${describeBrokenTool(caughtError)}`,
    };
  }
  return { tool, summary };
}

const STATUS_ICON = { ok: '✅', warn: '⚠️', fail: '❌' } as const;

/**
 * Render the consolidated report. Markdown-flavored plain text — readable in
 * a terminal AND postable to Discord verbatim by the weekly workflow.
 */
export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [];
  lines.push(`## Audit health: ${STATUS_ICON[report.overall]} ${report.overall.toUpperCase()}`);
  lines.push('');
  for (const { tool, summary, brokenReason } of report.results) {
    if (summary === null) {
      lines.push(`- 💥 **${tool}** — TOOL BROKEN: ${brokenReason ?? 'unknown'}`);
    } else {
      const baselineNote = summary.baseline > 0 ? ` (baseline ${summary.baseline})` : '';
      lines.push(
        `- ${STATUS_ICON[summary.status]} **${tool}** — ${summary.findings} finding(s)${baselineNote}`
      );
    }
  }
  return lines.join('\n');
}

/** CLI shell for `pnpm ops health`. */
export function runHealth(options: { noFail?: boolean } = {}): HealthReport {
  console.log(chalk.dim(`Running ${HEALTH_TOOLS.length} audit tools…`));
  const results: ToolHealth[] = [];
  for (const tool of HEALTH_TOOLS) {
    console.log(chalk.dim(`  → ${tool}`));
    results.push(runTool(tool));
  }

  const report = aggregateHealth(results);
  console.log('');
  console.log(formatHealthReport(report));

  if (report.overall === 'fail' && options.noFail !== true) {
    process.exitCode = 1;
  }
  return report;
}
