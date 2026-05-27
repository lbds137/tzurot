/**
 * Legacy gateway-callsite burn-down counter.
 *
 * Transitional gate for the route-manifest cutover. CI invokes it on
 * every PR and fails if either count rises above the baseline. The
 * expected trajectory is monotonic decrease — each migration step
 * either keeps the counts level (infrastructure-only) or strictly
 * lowers them (per-area migration).
 *
 * When both counts reach zero (legacy helpers fully retired), the
 * gate, its baseline file, and the helper modules themselves are
 * deleted in the same commit.
 *
 * Scope:
 * - Walks `services/bot-client/src/**\/*.ts`, excluding `*.test.ts` and
 *   `*.spec.ts`. The legacy helpers ARE still imported in test files
 *   that exercise the old code paths, so counting tests would inflate
 *   the number without reflecting real migration progress.
 * - Counts `\badminFetch\b` and `\bcallGatewayApi\b` independently. The
 *   helper definitions themselves are also counted — that's fine
 *   because they're deleted at the end and the baseline drops with
 *   them.
 *
 * Output: a `LegacyCallsiteCounts` object plus a comparison verdict
 * against the on-disk baseline. The CLI command in `commands/dev.ts`
 * formats the verdict for human + CI consumption.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const BOT_CLIENT_SRC = 'services/bot-client/src';

const PATTERNS = {
  adminFetch: /\badminFetch\b/g,
  callGatewayApi: /\bcallGatewayApi\b/g,
} as const;

export interface LegacyCallsiteCounts {
  adminFetch: number;
  callGatewayApi: number;
}

export interface LegacyCallsiteBaseline extends LegacyCallsiteCounts {
  /** Schema version. Bump when fields change. */
  readonly version: 1;
  /** ISO timestamp of last `--update` invocation. */
  readonly lastUpdated: string;
  /** Free-form context for future readers. */
  readonly notes: string;
}

export interface ComparisonResult {
  baseline: LegacyCallsiteBaseline;
  current: LegacyCallsiteCounts;
  /** Per-category delta from baseline. Negative = burned down, positive = regression. */
  delta: LegacyCallsiteCounts;
  /** True if either category increased above baseline. */
  regression: boolean;
}

/** Files included in the count: TS only, excludes tests. */
function shouldCountFile(absPath: string): boolean {
  if (!absPath.endsWith('.ts')) return false;
  if (absPath.endsWith('.test.ts') || absPath.endsWith('.spec.ts')) return false;
  return true;
}

function walkDirectory(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      // lstatSync rather than statSync: a symlink to a directory should NOT
      // be recursed into. Walking symlinked dirs would inflate counts (e.g.,
      // a pnpm `.bin` symlink accidentally landing in the tree) and risk
      // infinite-loop traversal on circular links.
      const stat = lstatSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (stat.isFile() && shouldCountFile(full)) {
        results.push(full);
      }
    }
  }

  return results;
}

/** Count adminFetch + callGatewayApi occurrences across bot-client/src. */
export function countLegacyCallsites(repoRoot: string): LegacyCallsiteCounts {
  const srcRoot = join(repoRoot, BOT_CLIENT_SRC);

  // Fail fast on a missing source root rather than silently returning zero
  // counts — `0 <= baseline` would otherwise let the gate pass when its
  // input dataset has disappeared (partial checkout, CI matrix oddity).
  if (!existsSync(srcRoot)) {
    throw new Error(
      `Expected source directory not found: ${relative(repoRoot, srcRoot)} (resolved: ${srcRoot})`
    );
  }

  const files = walkDirectory(srcRoot);

  let adminFetchCount = 0;
  let callGatewayApiCount = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    adminFetchCount += (content.match(PATTERNS.adminFetch) ?? []).length;
    callGatewayApiCount += (content.match(PATTERNS.callGatewayApi) ?? []).length;
  }

  return { adminFetch: adminFetchCount, callGatewayApi: callGatewayApiCount };
}

export function readBaseline(baselinePath: string): LegacyCallsiteBaseline {
  const raw = readFileSync(baselinePath, 'utf-8');
  const parsed = JSON.parse(raw) as LegacyCallsiteBaseline;
  // Without this guard, a hand-edited or partially-written baseline with
  // non-numeric counts produces NaN deltas in compareWithBaseline, and
  // `NaN > 0` is `false` — the gate would silently pass on a real
  // regression. That's the exact failure mode this gate exists to catch.
  if (
    typeof parsed.adminFetch !== 'number' ||
    !Number.isFinite(parsed.adminFetch) ||
    typeof parsed.callGatewayApi !== 'number' ||
    !Number.isFinite(parsed.callGatewayApi)
  ) {
    throw new Error(
      `Malformed baseline ${baselinePath}: adminFetch and callGatewayApi must be finite numbers`
    );
  }
  // Loud-fail if the on-disk schema version doesn't match what this code
  // understands. Without it, a future v2 baseline would be silently
  // compared against v1 semantics. Same class of bug as the numeric
  // guard above.
  if (parsed.version !== 1) {
    throw new Error(
      `Malformed baseline ${baselinePath}: expected version 1, got ${String(parsed.version)}`
    );
  }
  return parsed;
}

export function writeBaseline(
  baselinePath: string,
  counts: LegacyCallsiteCounts,
  notes: string
): LegacyCallsiteBaseline {
  const baseline: LegacyCallsiteBaseline = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    adminFetch: counts.adminFetch,
    callGatewayApi: counts.callGatewayApi,
    notes,
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
  return baseline;
}

export function compareWithBaseline(
  current: LegacyCallsiteCounts,
  baseline: LegacyCallsiteBaseline
): ComparisonResult {
  const delta: LegacyCallsiteCounts = {
    adminFetch: current.adminFetch - baseline.adminFetch,
    callGatewayApi: current.callGatewayApi - baseline.callGatewayApi,
  };
  const regression = delta.adminFetch > 0 || delta.callGatewayApi > 0;
  return { baseline, current, delta, regression };
}

/** For logging: the repo-relative path of the counted directory. */
export function describeSource(): string {
  return BOT_CLIENT_SRC;
}
