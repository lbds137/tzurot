/**
 * Test-Tier Distribution Report (`test:tiers`)
 *
 * Report-only: walks every test file, classifies it by the shared taxonomy
 * (`classifyTestFile`), and prints the per-package distribution plus a
 * per-tier rollup. NO gate — this is the measurement down-payment for the
 * tier-coverage ratchet that lands in the broader testing epic. It seeds
 * exactly what that future audit-class tool will gate on.
 *
 * Not audit-class (no threshold, no pass/fail) → no WHY.md / canary / registry
 * entry. The `--summary` line is informational (`status: 'ok'` always).
 */

import { execFileSync } from 'node:child_process';
import {
  CANONICAL_TEST_TIERS,
  TEST_FILE_KINDS,
  TEST_FILE_KIND_INFO,
  TIER_FOR_KIND,
  classifyTestFile,
  type TestFileKind,
  type TestTier,
} from './test-tiers.js';
import { emitSummary } from '../audits/summary.js';

export interface TierReport {
  /** Per-package counts keyed by file-kind. */
  byPackage: Map<string, Record<TestFileKind, number>>;
  /** Repo-wide totals by file-kind. */
  byKind: Record<TestFileKind, number>;
  /** Repo-wide totals rolled up to canonical tier (every tier present, even 0). */
  byTier: Record<TestTier, number>;
  /** Total classified test files. */
  total: number;
}

function zeroKinds(): Record<TestFileKind, number> {
  return Object.fromEntries(TEST_FILE_KINDS.map(k => [k, 0])) as Record<TestFileKind, number>;
}

function zeroTiers(): Record<TestTier, number> {
  return Object.fromEntries(CANONICAL_TEST_TIERS.map(t => [t, 0])) as Record<TestTier, number>;
}

/**
 * Derive the package label for a repo-relative path. `services/X` and
 * `packages/X` collapse to `X`; `tests/e2e` keeps its two-segment label;
 * anything else falls back to its first path segment.
 */
export function packageOf(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/');
  if ((parts[0] === 'services' || parts[0] === 'packages') && parts.length > 1) return parts[1];
  if (parts[0] === 'tests' && parts.length > 1) return `tests/${parts[1]}`;
  return parts[0] !== '' ? parts[0] : 'root';
}

/**
 * Aggregate a list of repo-relative paths into a tier report. Pure — the CLI
 * wrapper owns the `git ls-files` walk and all printing. Non-test paths are
 * skipped (defensive; the caller already globs for `*.test.ts`).
 */
export function buildTierReport(paths: readonly string[]): TierReport {
  const byPackage = new Map<string, Record<TestFileKind, number>>();
  const byKind = zeroKinds();
  const byTier = zeroTiers();
  let total = 0;

  for (const path of paths) {
    const kind = classifyTestFile(path);
    if (kind === null) continue;
    const pkg = packageOf(path);
    const row = byPackage.get(pkg) ?? zeroKinds();
    row[kind] += 1;
    byPackage.set(pkg, row);
    byKind[kind] += 1;
    byTier[TIER_FOR_KIND[kind]] += 1;
    total += 1;
  }

  return { byPackage, byKind, byTier, total };
}

/** List tracked `*.test.ts` paths via git (respects .gitignore, fast). */
function listTestFiles(repoRoot: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '*.test.ts'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return out.split('\0').filter(line => line.length > 0);
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

/** Render the human-readable table + tier rollup + legend. Exported for testing. */
export function formatTierReport(report: TierReport): string {
  const lines: string[] = [];
  const kindCol = 12;
  const pkgCol = Math.max(16, ...[...report.byPackage.keys()].map(k => k.length + 2));

  const header =
    'package'.padEnd(pkgCol) +
    TEST_FILE_KINDS.map(k => pad(k, kindCol)).join('') +
    pad('total', kindCol);
  lines.push(header);
  lines.push('─'.repeat(header.length));

  const packages = [...report.byPackage.keys()].sort((a, b) => a.localeCompare(b));
  for (const pkg of packages) {
    const row = report.byPackage.get(pkg);
    if (row === undefined) continue;
    const rowTotal = TEST_FILE_KINDS.reduce((sum, k) => sum + row[k], 0);
    lines.push(
      pkg.padEnd(pkgCol) +
        TEST_FILE_KINDS.map(k => pad(row[k], kindCol)).join('') +
        pad(rowTotal, kindCol)
    );
  }

  lines.push('─'.repeat(header.length));
  lines.push(
    'TOTAL'.padEnd(pkgCol) +
      TEST_FILE_KINDS.map(k => pad(report.byKind[k], kindCol)).join('') +
      pad(report.total, kindCol)
  );

  lines.push('');
  lines.push('By canonical tier (Clemson):');
  for (const tier of CANONICAL_TEST_TIERS) {
    lines.push(`  ${tier.padEnd(12)} ${report.byTier[tier]}`);
  }

  lines.push('');
  lines.push('Legend (file-kind → tier → mechanical match):');
  for (const kind of TEST_FILE_KINDS) {
    const info = TEST_FILE_KIND_INFO[kind];
    lines.push(`  ${kind.padEnd(12)} → ${info.tier.padEnd(12)} ${info.matches}`);
  }
  lines.push('');
  lines.push('Report-only — no gate. The tier-coverage ratchet lands in the testing epic.');

  return lines.join('\n');
}

export interface TierReportOptions {
  repoRoot?: string;
  /** Emit only the JSONL audit-summary line (informational; status always ok). */
  summary?: boolean;
  /** @internal Test seam — supply paths directly instead of calling git. */
  paths?: readonly string[];
}

/** CLI entry point. Report-only — always exits 0. */
export async function runTierReport(options: TierReportOptions = {}): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const paths = options.paths ?? listTestFiles(repoRoot);
  const report = buildTierReport(paths);

  if (options.summary === true) {
    emitSummary({ tool: 'test:tiers', status: 'ok', findings: report.total, baseline: 0 });
    return;
  }

  console.log('\n📊 Test-tier distribution\n');
  console.log(formatTierReport(report));
  console.log();
}
