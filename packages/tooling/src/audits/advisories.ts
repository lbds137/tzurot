/**
 * Open-advisory enumeration for the release security-preflight and the weekly
 * health report.
 *
 * Reads the GitHub Dependabot *alerts* API — the same source
 * {@link collectSecuritySurface} counts — but keeps the full per-advisory
 * detail: severity, the first patched version, and whether the vulnerable
 * package is a DIRECT workspace dependency.
 *
 * The direct/transitive split is the actionable signal. Dependabot opens PRs
 * for direct deps automatically, but it CANNOT PR a transitive-only advisory
 * (it can't edit a dependency it doesn't directly control) — those need a
 * manual `pnpm.overrides` bump and otherwise linger open with no PR ever
 * arriving. Surfacing that class at the release decision-point is the whole
 * point: it's exactly the shape that sat unnoticed until a release preflight.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { GH_TIMEOUT_MS, describeGhFailure } from './health-extras.js';

/** One open Dependabot advisory, enriched with our direct/transitive classification. */
export interface Advisory {
  /** Vulnerable package name (e.g. `protobufjs`). */
  package: string;
  /**
   * Dependabot ecosystem: `npm` | `pip` | `actions` | … The alerts API returns
   * advisories for EVERY ecosystem GitHub scans (this repo has a Python service
   * and github-actions deps), so the npm-specific classification below is gated
   * on this — a pip advisory must not get "needs a pnpm.overrides bump."
   */
  ecosystem: string;
  /**
   * Alerts-API severity: `low` | `medium` | `high` | `critical`. `moderate`
   * (npm-audit / GHSA vocabulary) is ranked defensively but the alerts API
   * emits `medium`, so it should not occur from this source.
   */
  severity: string;
  /** The advisory's vulnerable version range (e.g. `>= 7.5.0, <= 7.6.4`). */
  vulnerableRange: string;
  /** First patched version, or `null` when no fix has been published yet. */
  firstPatched: string | null;
  /** GHSA identifier (e.g. `GHSA-v422-hmwv-36x6`). */
  ghsaId: string;
  /**
   * NPM-only signal: true when the package appears in some workspace
   * `package.json` dependency block (Dependabot can PR it directly), false =
   * transitive-only (needs a manual `pnpm.overrides` bump). Always false for
   * non-npm ecosystems — read it together with {@link ecosystem}, never alone.
   */
  isDirect: boolean;
}

/** Per-call availability: the alerts API is legitimately unreadable in some environments. */
export type AdvisorySurface =
  { available: true; advisories: Advisory[] } | { available: false; reason: string };

/** Shape emitted by the `gh api ... --jq` projection below, before enrichment. */
interface RawAdvisory {
  package: string;
  ecosystem: string;
  severity: string;
  vulnerableRange: string;
  firstPatched: string | null;
  ghsaId: string;
}

/** Severity rank for descending sort — unknown labels sort last. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  moderate: 2,
  low: 3,
};

/** Directories never worth walking for package.json files (deps + build/output dirs). */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.pnpm-store',
  'tzurot-legacy',
  '.git',
  'dist',
  'coverage',
  'reports',
  '.venv',
]);

/**
 * Fetch open Dependabot alerts as newline-delimited JSON objects.
 *
 * `--paginate` with a streaming `.[]` jq projection yields one JSON object per
 * line across all pages (a wrapping `[...]` projection would emit one array
 * per page — invalid as a single document). Kept separate from the parse so a
 * test can mock `execFileSync` and exercise the mapping.
 */
function fetchOpenAlertsNdjson(): string {
  return execFileSync(
    'gh',
    [
      'api',
      'repos/{owner}/{repo}/dependabot/alerts',
      '--paginate',
      '--jq',
      '.[] | select(.state=="open") | {' +
        'package: .dependency.package.name, ' +
        'ecosystem: .dependency.package.ecosystem, ' +
        'severity: .security_advisory.severity, ' +
        'vulnerableRange: .security_vulnerability.vulnerable_version_range, ' +
        'firstPatched: .security_vulnerability.first_patched_version.identifier, ' +
        'ghsaId: .security_advisory.ghsa_id}',
    ],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS }
  );
}

/**
 * Narrow an unknown parsed line to a well-formed raw advisory. All five fields
 * are checked (not just package/severity): a partially-shaped line — e.g. the
 * API omits `vulnerable_version_range` — would otherwise flow through as
 * `undefined` and print "vulnerable: undefined" (or silently vanish from
 * `--json`, since JSON.stringify drops undefined keys). Dropping it entirely
 * matches the "a malformed line must not poison the report" contract.
 */
function isRawAdvisory(value: unknown): value is RawAdvisory {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.package === 'string' &&
    typeof candidate.ecosystem === 'string' &&
    typeof candidate.severity === 'string' &&
    typeof candidate.vulnerableRange === 'string' &&
    (typeof candidate.firstPatched === 'string' || candidate.firstPatched === null) &&
    typeof candidate.ghsaId === 'string'
  );
}

/**
 * Parse the NDJSON stream into raw advisories, skipping blank lines and any
 * line that doesn't shape up as an advisory. Malformed entries are dropped
 * rather than propagated — a single odd line must not poison the whole report.
 */
function parseAlertNdjson(ndjson: string): RawAdvisory[] {
  const advisories: RawAdvisory[] = [];
  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // A non-JSON line (a stray gh warning on stdout, a truncated page) drops
      // just that line — a single odd line must not poison the whole report.
      continue;
    }
    if (isRawAdvisory(parsed)) {
      advisories.push(parsed);
    }
  }
  return advisories;
}

/** Collect every dependency name declared across all workspace package.json files. */
function collectDirectDependencyNames(rootDir: string): Set<string> {
  const names = new Set<string>();
  for (const file of findPackageJsonFiles(rootDir)) {
    let pkg: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    try {
      pkg = JSON.parse(readFileSync(file, 'utf-8')) as typeof pkg;
    } catch {
      // A malformed/unreadable package.json (mid-merge-conflict, a WIP file, a
      // permission hiccup) contributes no dep names — skip it rather than let
      // the throw discard the already-fetched advisory list (fail visible-not-blank).
      continue;
    }
    for (const block of [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ]) {
      if (block !== undefined) {
        for (const name of Object.keys(block)) {
          names.add(name);
        }
      }
    }
  }
  return names;
}

/** Recursively find package.json files under the monorepo, skipping excluded dirs. */
function findPackageJsonFiles(rootDir: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // unreadable dir — skip, never throw the whole collection
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry === 'package.json') {
        results.push(full);
        continue;
      }
      if (EXCLUDED_DIRS.has(entry)) {
        continue;
      }
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue; // dangling symlink / race — skip this entry, don't mask the report
      }
      if (isDirectory) {
        walk(full);
      }
    }
  };
  walk(rootDir);
  return results;
}

/**
 * Enumerate open Dependabot advisories, enriched with the direct/transitive
 * split. Never throws — the alerts API is unreadable in CI (the token lacks
 * `security-events` scope) and in local checkouts without `gh` auth, and the
 * caller (health report, preflight) must degrade rather than break.
 */
export function collectOpenAdvisories(rootDir: string): AdvisorySurface {
  try {
    const ndjson = fetchOpenAlertsNdjson();
    const directNames = collectDirectDependencyNames(rootDir);
    const advisories = parseAlertNdjson(ndjson)
      // isDirect is npm-only: the package.json dep set says nothing about a pip
      // or actions package, so those stay false and are reported by ecosystem.
      .map(raw => ({ ...raw, isDirect: raw.ecosystem === 'npm' && directNames.has(raw.package) }))
      .sort(compareAdvisories);
    return { available: true, advisories };
  } catch (error) {
    // Fetch failure, a malformed response line, or an unreadable workspace all
    // degrade to unavailable — the contract is "never throws," so the health
    // report and preflight surface a reason instead of crashing.
    return { available: false, reason: describeGhFailure(error) };
  }
}

/** Sort critical→low, then alphabetically by package for a stable report. */
function compareAdvisories(a: Advisory, b: Advisory): number {
  const rankA = SEVERITY_RANK[a.severity.toLowerCase()] ?? 99;
  const rankB = SEVERITY_RANK[b.severity.toLowerCase()] ?? 99;
  return rankA !== rankB ? rankA - rankB : a.package.localeCompare(b.package);
}

/**
 * The one-line action a maintainer should take for an advisory. For npm, the
 * direct/transitive split decides who's responsible (Dependabot for direct, a
 * manual override for transitive). Non-npm ecosystems get a generic, honest
 * pointer — the npm-specific `pnpm.overrides` remediation would be wrong there.
 */
export function recommendedAction(advisory: Advisory): string {
  if (advisory.firstPatched === null) {
    return 'No fix published yet — track the upstream advisory';
  }
  if (advisory.ecosystem !== 'npm') {
    return `Fix available (>=${advisory.firstPatched}) — update via the ${advisory.ecosystem} manifest`;
  }
  if (advisory.isDirect) {
    return `Dependabot PR expected (bump to >=${advisory.firstPatched})`;
  }
  return `Manual override needed (>=${advisory.firstPatched}) — transitive, Dependabot can't PR`;
}

/**
 * Whether `--strict` should fail: a high/critical advisory that HAS a published
 * fix (i.e. is actionable). Fix-unavailable advisories never fail the gate —
 * failing on something with no available fix is unactionable red that trains
 * maintainers to ignore the check.
 */
const STRICT_FAIL_SEVERITIES = new Set(['high', 'critical']);
export function hasActionableStrictAdvisory(advisories: Advisory[]): boolean {
  return advisories.some(
    a => a.firstPatched !== null && STRICT_FAIL_SEVERITIES.has(a.severity.toLowerCase())
  );
}

/** Colorize a severity label for the terminal report. */
function severityBadge(severity: string): string {
  const label = severity.toUpperCase().padEnd(8);
  switch (severity.toLowerCase()) {
    case 'critical':
      // Same width as the other badges (no extra leading space) so the column aligns.
      return chalk.bgRed.white(label);
    case 'high':
      return chalk.red(label);
    case 'medium':
    case 'moderate':
      return chalk.yellow(label);
    default:
      return chalk.gray(label);
  }
}

/** Render the human-readable advisory report (degradation-aware). */
export function formatAdvisoriesReport(surface: AdvisorySurface): string {
  if (!surface.available) {
    return `⚠️  Dependabot advisories: unavailable (${surface.reason})`;
  }
  if (surface.advisories.length === 0) {
    return '✅ No open Dependabot advisories.';
  }
  const count = surface.advisories.length;
  const lines: string[] = [`⚠️  ${count} open Dependabot advisor${count === 1 ? 'y' : 'ies'}:`, ''];
  for (const a of surface.advisories) {
    // npm splits direct/transitive; other ecosystems are labeled by ecosystem
    // (the npm dep set can't classify a pip/actions package).
    const scope = a.ecosystem === 'npm' ? (a.isDirect ? 'direct' : 'transitive') : a.ecosystem;
    lines.push(`  ${severityBadge(a.severity)} ${chalk.bold(a.package)}  (${scope})  ${a.ghsaId}`);
    lines.push(`      vulnerable: ${a.vulnerableRange}`);
    lines.push(`      ${recommendedAction(a)}`);
    lines.push('');
  }
  const transitive = surface.advisories.filter(
    a => a.ecosystem === 'npm' && !a.isDirect && a.firstPatched !== null
  ).length;
  if (transitive > 0) {
    lines.push(
      chalk.dim(
        `${transitive} transitive npm advisor${transitive === 1 ? 'y needs' : 'ies need'} a manual ` +
          `pnpm.overrides bump (Dependabot can't PR transitive-only advisories).`
      )
    );
  }
  return lines.join('\n').trimEnd();
}

interface AdvisoriesCommandOptions {
  json?: boolean;
  strict?: boolean;
  rootDir?: string;
}

/**
 * `security:advisories` entry point. Prints the report (or JSON), and under
 * `--strict` sets a nonzero exit code ONLY for actionable high/critical
 * advisories while the API is available — it fails open on an unreadable API
 * (CI without alerts scope) rather than blocking on a query it can't run.
 */
export function runAdvisoriesCommand(options: AdvisoriesCommandOptions = {}): void {
  const surface = collectOpenAdvisories(options.rootDir ?? process.cwd());
  if (options.json === true) {
    console.log(JSON.stringify(surface, null, 2));
  } else {
    console.log(formatAdvisoriesReport(surface));
  }
  if (
    options.strict === true &&
    surface.available &&
    hasActionableStrictAdvisory(surface.advisories)
  ) {
    process.exitCode = 1;
  }
}
