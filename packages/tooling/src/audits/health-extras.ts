/**
 * Report-only context sections for `pnpm ops health` — appended AFTER the
 * verdict header + per-tool bullets. None of these affect the aggregate
 * verdict or the exit code: they are situational awareness for the weekly
 * report, not gates (the gates live in `pnpm quality` / CI).
 *
 * Three sections:
 * - **Security surface** — open Dependabot PRs + alerts via the `gh` CLI;
 *   degrades to "unavailable (<reason>)" when gh is missing/unauthenticated.
 * - **Ratchet margins** — headroom against the ratchet baselines that can be
 *   measured honestly without a heavy run: lines, ux-literals, and coverage
 *   (cheap live measures), cpd (stale-ok, only if a prior `pnpm cpd` report
 *   exists on disk), mutation (baseline score + floor only — a live score
 *   needs a Stryker run).
 * - **Docs orphans** — `docs/reference` files with zero inbound markdown
 *   links (see `docs-orphan-scan.ts`).
 *
 * Split out of `health.ts` to keep that file's aggregator loop readable and
 * inside the max-lines budget; `runHealth` is the only production caller.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadJscpdReport, filterReport } from '../cpd/postFilter.js';
import {
  measureSurfaces,
  parseLinesBaseline,
  DEFAULT_LINES_BASELINE_PATH,
  type SurfaceMeasurement,
} from './lines-check.js';
import { parseMutationBaseline } from '../test/mutation-check.js';
import {
  measureUxLiterals,
  parseUxLiteralsBaseline,
  DEFAULT_UX_LITERALS_BASELINE_PATH,
} from './ux-literals-check.js';
import { loadUnifiedBaseline, collectUnifiedAuditData } from '../test/audit-unified.js';
import { scanDocsOrphans, type DocsOrphanResult } from './docs-orphan-scan.js';

/** One security metric, degraded independently of its siblings. */
export type SecurityCount =
  { available: true; count: number } | { available: false; reason: string };

/**
 * Per-metric availability (not all-or-nothing): in CI, GITHUB_TOKEN can list
 * Dependabot PRs but structurally CANNOT read the Dependabot-alerts API — no
 * workflow `permissions:` scope grants it (`security-events` covers code/
 * secret scanning only). A shared try/catch would let the always-403 alerts
 * call discard the PR count that succeeds.
 */
export interface SecuritySurface {
  dependabotPrs: SecurityCount;
  dependabotAlerts: SecurityCount;
}

/** Budget for each gh subprocess — a hung gh must degrade, not stall health. */
const GH_TIMEOUT_MS = 30 * 1000;

/** Run one gh command that emits a single integer (via --jq) on stdout. */
function runGhCount(args: string[]): number {
  const stdout = execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GH_TIMEOUT_MS,
  });
  const count = Number.parseInt(stdout.trim(), 10);
  if (Number.isNaN(count)) {
    throw new Error(`unexpected gh output: ${stdout.trim().slice(0, 80)}`);
  }
  return count;
}

/** Compose a one-line degradation reason, preferring gh's own stderr. */
function describeGhFailure(error: unknown): string {
  const execError = error as { stderr?: string | Buffer };
  // FIRST non-empty line: gh's multi-line hints lead with the explanation
  // ("set the GH_TOKEN environment variable") and trail with an example
  // snippet — .at(-1) once reported the bare snippet as the whole reason.
  const stderrLine =
    typeof execError.stderr === 'string'
      ? execError.stderr
          .trim()
          .split('\n')
          .find(l => l.trim().length > 0)
      : undefined;
  if (stderrLine !== undefined && stderrLine.length > 0) {
    return stderrLine;
  }
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

/** Run one gh count, degrading to an unavailable-with-reason on any throw. */
function safeGhCount(args: string[]): SecurityCount {
  try {
    return { available: true, count: runGhCount(args) };
  } catch (error) {
    return { available: false, reason: describeGhFailure(error) };
  }
}

/**
 * Count open Dependabot PRs + alerts, each degrading independently. Never
 * throws — some environments (local checkouts without gh auth, CI tokens
 * without alerts access) legitimately can't answer one or both, and the
 * security section must degrade per-metric rather than break the report.
 */
export function collectSecuritySurface(): SecuritySurface {
  return {
    dependabotPrs: safeGhCount([
      'pr',
      'list',
      '--author',
      'app/dependabot',
      '--state',
      'open',
      '--json',
      'number',
      '--jq',
      'length',
    ]),
    dependabotAlerts: safeGhCount([
      'api',
      'repos/{owner}/{repo}/dependabot/alerts',
      '--jq',
      '[.[] | select(.state=="open")] | length',
    ]),
  };
}

/**
 * Lines ratchet headroom — the one margin cheap enough to measure LIVE
 * (a handful of file reads). One bullet per tracked surface.
 */
export function collectLinesMarginBullets(rootDir: string): string[] {
  const baselinePath = resolve(rootDir, DEFAULT_LINES_BASELINE_PATH);
  if (!existsSync(baselinePath)) {
    return ['lines: unavailable (no lines-baseline.json — run `pnpm ops lines:update-baseline`)'];
  }
  const baseline = parseLinesBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath);
  const measured = measureSurfaces(rootDir) as Record<string, SurfaceMeasurement | undefined>;

  const bullets: string[] = [];
  for (const [name, surface] of Object.entries(baseline.surfaces)) {
    const ceiling = surface.lines + surface.graceMargin;
    const measurement = measured[name];
    if (measurement === undefined || measurement.fileCount === 0) {
      bullets.push(`lines ${name}: unmeasurable (surface matched zero files)`);
      continue;
    }
    bullets.push(
      `lines ${name}: ${measurement.lines}/${ceiling} ` +
        `(${ceiling - measurement.lines} headroom, live measure)`
    );
  }
  return bullets;
}

/**
 * CPD ratchet headroom — honest only when a prior `pnpm cpd` run left its
 * JSON report on disk; the filtered count is recomputed from that artifact
 * (cheap JSON post-filter, no jscpd re-run) and labeled as stale-ok.
 */
export function collectCpdMarginBullets(rootDir: string): string[] {
  const baselinePath = resolve(rootDir, '.github/baselines/cpd-baseline.json');
  const reportPath = resolve(rootDir, 'reports/jscpd/jscpd-report.json');
  if (!existsSync(baselinePath)) {
    return ['cpd: unavailable (no cpd-baseline.json)'];
  }
  if (!existsSync(reportPath)) {
    return ['cpd: unavailable (no jscpd report on disk — run `pnpm cpd` first)'];
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as {
    filteredLines?: number;
    graceMargin?: number;
    threshold?: number;
  };
  if (typeof baseline.filteredLines !== 'number' || typeof baseline.graceMargin !== 'number') {
    return ['cpd: unavailable (cpd-baseline.json missing filteredLines/graceMargin)'];
  }
  const filtered = filterReport(loadJscpdReport(reportPath), baseline.threshold ?? 0.8);
  const ceiling = baseline.filteredLines + baseline.graceMargin;
  return [
    `cpd filteredLines: ${filtered.filteredLines}/${ceiling} ` +
      `(${ceiling - filtered.filteredLines} headroom, as of last \`pnpm cpd\` run — stale-ok)`,
  ];
}

/**
 * Mutation ratchet — baseline score + floor ONLY. A live score needs a
 * Stryker run (minutes, not milliseconds), so no current measurement is
 * reported; the bullet is labeled accordingly.
 */
export function collectMutationMarginBullets(rootDir: string): string[] {
  const baselinePath = resolve(rootDir, '.github/baselines/mutation-baseline.json');
  if (!existsSync(baselinePath)) {
    return ['mutation: unavailable (no mutation-baseline.json)'];
  }
  const baseline = parseMutationBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath);
  return Object.entries(baseline.packages).map(([name, pkg]) => {
    const floor = Math.round((pkg.score - pkg.graceMargin) * 100) / 100;
    return `mutation ${name}: baseline score ${pkg.score}, floor ${floor} (baseline only — no live run)`;
  });
}

/**
 * UX-literals adoption ratchet — a cheap live measure (regex walk over
 * bot-client's commands dir). This ratchet counts DOWN: the goal is fewer
 * raw literals, so headroom-under-ceiling is slack the AST rule (Phase 3)
 * will eventually retire, and a shrinking total is progress worth seeing.
 */
export function collectUxLiteralsMarginBullets(rootDir: string): string[] {
  const baselinePath = resolve(rootDir, DEFAULT_UX_LITERALS_BASELINE_PATH);
  if (!existsSync(baselinePath)) {
    return ['ux-literals: unavailable (no ux-literals-baseline.json)'];
  }
  const baseline = parseUxLiteralsBaseline(readFileSync(baselinePath, 'utf-8'), baselinePath);
  const measurement = measureUxLiterals(rootDir);
  if (measurement.fileCount === 0) {
    return ['ux-literals: unmeasurable (scan root matched zero files)'];
  }
  const ceiling = baseline.total + baseline.graceMargin;
  return [
    `ux-literals: ${measurement.total}/${ceiling} ` +
      `(${ceiling - measurement.total} headroom, baseline ${baseline.total}, live measure — ` +
      `lower is better; a total well under baseline is a tightening candidate)`,
  ];
}

/**
 * Test-coverage ratchet — live gap scan (static fs walk over service files +
 * schema/test colocation; no test run). knownGaps sitting non-zero across
 * reports is exactly the "accepted at whatever baseline we left it" slack
 * this section exists to surface.
 */
export function collectCoverageMarginBullets(rootDir: string): string[] {
  const baseline = loadUnifiedBaseline(rootDir);
  const audit = collectUnifiedAuditData(rootDir, baseline);
  interface CoverageRow {
    label: string;
    untested: number;
    known: number;
    fresh: number;
    stale: number;
    cov: number;
  }
  const fmt = ({ label, untested, known, fresh, stale, cov }: CoverageRow): string =>
    `coverage ${label}: ${untested} untested (${cov.toFixed(1)}% covered), ` +
    `${known} known gap${known === 1 ? '' : 's'} in baseline` +
    (fresh > 0 ? `, ${fresh} NEW` : '') +
    // A knownGaps entry whose gap no longer exists is paid debt the baseline
    // hasn't reclaimed — the purest stagnation signal this row can show.
    (stale > 0 ? `, ${stale} fixed-but-still-in-baseline (run test:audit --update)` : '') +
    ` (live measure${known > 0 ? ' — non-zero knownGaps is parked debt' : ''})`;
  return [
    fmt({
      label: 'services',
      untested: audit.services.untestedServices.length,
      known: baseline.services.knownGaps.length,
      fresh: audit.services.newGaps.length,
      stale: audit.services.fixedGaps.length,
      cov: audit.services.coverage,
    }),
    fmt({
      label: 'contracts',
      untested: audit.contracts.untestedSchemas.length,
      known: baseline.contracts.knownGaps.length,
      fresh: audit.contracts.newGaps.length,
      stale: audit.contracts.fixedGaps.length,
      cov: audit.contracts.coverage,
    }),
  ];
}

export interface HealthExtras {
  security: SecuritySurface;
  marginBullets: string[];
  docsOrphans: DocsOrphanResult | { unavailable: string };
}

/** One margin collector, degraded to an "unavailable" bullet on any throw. */
function safeBullets(label: string, collect: () => string[]): string[] {
  try {
    return collect();
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return [`${label}: unavailable (${reason})`];
  }
}

/**
 * Collect all three report-only sections. Every collector degrades in place;
 * this function never throws, so `runHealth` can call it unconditionally.
 */
export function collectHealthExtras(rootDir: string): HealthExtras {
  const marginBullets = [
    ...safeBullets('lines', () => collectLinesMarginBullets(rootDir)),
    ...safeBullets('cpd', () => collectCpdMarginBullets(rootDir)),
    ...safeBullets('mutation', () => collectMutationMarginBullets(rootDir)),
    ...safeBullets('ux-literals', () => collectUxLiteralsMarginBullets(rootDir)),
    ...safeBullets('coverage', () => collectCoverageMarginBullets(rootDir)),
  ];
  let docsOrphans: HealthExtras['docsOrphans'];
  try {
    docsOrphans = scanDocsOrphans(rootDir);
  } catch (error) {
    docsOrphans = { unavailable: error instanceof Error ? error.message : String(error) };
  }
  return { security: collectSecuritySurface(), marginBullets, docsOrphans };
}

/** Render one security metric as its report bullet. */
function securityBullet(label: string, metric: SecurityCount): string {
  return metric.available
    ? `- ${label}: ${metric.count}`
    : `- ${label}: unavailable (${metric.reason})`;
}

/**
 * Render the extras as markdown-flavored plain text, matching the section
 * shape of `formatHealthReport` (H3 sections after the tool bullets).
 */
export function formatHealthExtras(extras: HealthExtras): string {
  const lines: string[] = [];

  lines.push('### Security surface (report-only)');
  lines.push(securityBullet('Dependabot PRs open', extras.security.dependabotPrs));
  lines.push(securityBullet('Dependabot alerts open', extras.security.dependabotAlerts));

  lines.push('');
  lines.push('### Ratchet margins (report-only)');
  for (const bullet of extras.marginBullets) {
    lines.push(`- ${bullet}`);
  }

  lines.push('');
  lines.push('### Docs orphans (report-only)');
  if ('unavailable' in extras.docsOrphans) {
    lines.push(`- docs-orphan scan: unavailable (${extras.docsOrphans.unavailable})`);
  } else if (extras.docsOrphans.orphans.length === 0) {
    lines.push(
      `- 0 of ${extras.docsOrphans.totalDocs} docs/reference files lack inbound markdown links`
    );
  } else {
    lines.push(
      `- ${extras.docsOrphans.orphans.length} of ${extras.docsOrphans.totalDocs} ` +
        `docs/reference files have no inbound markdown links:`
    );
    for (const orphan of extras.docsOrphans.orphans) {
      lines.push(`  - ${orphan}`);
    }
  }

  return lines.join('\n');
}
