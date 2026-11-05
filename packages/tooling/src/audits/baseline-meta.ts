/**
 * Baseline Metadata
 *
 * Layer 3 of the audit-enforcement architecture (`docs/reference/audit-enforcement.md`): every audit baseline
 * file carries a `meta` block with the context that produced it. The one
 * field that matters for drift detection is `configHash` (catches "tool
 * config changed since this baseline was captured") — `checkMetaDrift`
 * compares it alone.
 *
 * The other fields (`toolVersion`, `nodeVersion`, `generatedFromSha`,
 * `generatedAt`) are observability — they don't gate behavior, but they
 * make it possible to answer "when was this baseline last refreshed, and
 * on top of what?" without git archaeology.
 *
 * **Why this exists**: baselines go stale not just because the codebase
 * changed but because the *tool measuring it* changed. If `cpd:check`'s
 * threshold drops from 0.8 to 0.7, the existing baseline's filteredLines
 * count was computed under the old threshold — it's no longer a valid
 * floor for the new measurement. Without `configHash`, a 3-month-old
 * baseline against a config bumped last week reports against a different
 * reality than the code is running against. Calendar-age checks alone
 * can't catch this (the config change was last week, but only the
 * baseline FILE looks stale; the actual drift is in the tool config).
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { sha256Hex } from '@tzurot/common-types/utils/sha256Hex';

export interface BaselineMeta {
  /** Tool-internal version string (semver or hash). Convention: the package.json version, or a hash of the tool's source if it's evolving fast. */
  toolVersion: string;
  /**
   * Hash of tool-relevant config (e.g., ESLint rule thresholds for
   * complexity-report, the post-filter heuristic for CPD). Drift gate.
   * When this mismatches the baseline's stored value, the baseline
   * was captured under different rules and can no longer be trusted
   * as a ratchet floor.
   */
  configHash: string;
  /** Node version the tool ran under at baseline-capture time. */
  nodeVersion: string;
  /**
   * The develop-side commit the measured tree was built on top of; see
   * `buildBaselineMeta` for the provenance contract.
   */
  generatedFromSha: string;
  /** ISO-8601 timestamp of when the baseline was captured. */
  generatedAt: string;
}

/**
 * Build a `BaselineMeta` block. Fills in `nodeVersion`, `generatedFromSha`,
 * and `generatedAt` automatically; the caller supplies the tool-specific
 * `toolVersion` and `configHash`.
 *
 * `generatedFromSha` records the develop-side commit the measured tree
 * was built on top of (`merge-base HEAD origin/develop`, or
 * `'unknown'` when that read fails or is empty); the branch's own changes
 * are not in it. GitHub's
 * rebase-and-merge rewrites PR commit SHAs — a recorded PR SHA would
 * dangle after merge, while the base commit stays an ancestor of
 * `develop` unless `develop` history is rewritten. A re-run on the same
 * tree records the same base (the baseline's own local modification does
 * not affect the read). The recorded base is the base at capture time:
 * if `develop` advances (or the branch is rebased) without re-running
 * the update, the field keeps pointing at the older base. Don't throw on
 * git absence: a repo where the read fails degrades to `'unknown'`, and
 * the metadata block is still useful for the other fields.
 */
export function buildBaselineMeta(toolVersion: string, configHash: string): BaselineMeta {
  return {
    toolVersion,
    configHash,
    nodeVersion: process.version,
    generatedFromSha: getGitSha(),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Returns the result of comparing a stored baseline meta against the
 * current environment's expected meta. `aligned: true` when configHash
 * matches; `aligned: false` indicates drift the caller should hard-fail
 * on (per the Layer 3 design — failure mode is "fail with a clear
 * error message, force operator to explicitly refresh").
 */
export interface MetaDriftCheck {
  aligned: boolean;
  /** Human-readable summary of the drift, suitable for CLI output. */
  detail: string;
}

export function checkMetaDrift(
  stored: BaselineMeta | undefined,
  currentConfigHash: string
): MetaDriftCheck {
  if (stored === undefined) {
    // No prior meta — treat as drift so operator is forced to capture
    // a baseline with metadata. This is the migration path from
    // pre-Layer-3 baselines.
    return {
      aligned: false,
      detail: 'baseline has no meta block; refresh to capture metadata',
    };
  }
  if (stored.configHash !== currentConfigHash) {
    return {
      aligned: false,
      detail: `configHash drift: baseline=${stored.configHash} current=${currentConfigHash}`,
    };
  }
  return { aligned: true, detail: 'configHash matches' };
}

/**
 * Stable hash of a config slice. SHA-256 of the JSON-serialized input,
 * truncated to 12 hex chars for readability. The slice should contain
 * ONLY the inputs that affect measurement — versioning, thresholds,
 * rule lists. Excluding non-measurement noise (file paths, timestamps)
 * keeps the hash from churning on unrelated changes.
 *
 * @invariant Assemble the slice as a stable-order object literal in
 * source, not from spread/dynamic keys. `JSON.stringify` is
 * order-dependent — `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash
 * differently. V8 preserves insertion order for non-integer keys, so
 * inline literals are safe. If assembling dynamically (e.g., spreading
 * from a loaded config), sort keys explicitly before passing —
 * `Object.fromEntries(Object.entries(x).sort())` is the simplest
 * canonicalization.
 *
 * Each tool defines its own `getConfigFingerprint()` returning the slice;
 * this helper hashes the result. The fingerprint is what each tool
 * commits to as its config-stability contract.
 */
export function hashConfigSlice(slice: unknown): string {
  const serialized = JSON.stringify(slice);
  return sha256Hex(serialized, { length: 12 });
}

/**
 * Bound on the merge-base read. Only the manual
 * `*:update-baseline` commands reach this — not the gate — so the stake
 * is a developer watching a stalled command rather than a blocked
 * pipeline. Bounded anyway: it is the same catch-and-degrade shape as
 * every other probe, and the catch below already answers `unknown`.
 */
export const BASELINE_SHA_TIMEOUT_MS = 15_000;

const GIT_READ_OPTS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'ignore'],
  timeout: BASELINE_SHA_TIMEOUT_MS,
};

function getGitSha(): string {
  try {
    const base = execFileSync(
      'git',
      ['merge-base', 'HEAD', 'origin/develop'],
      GIT_READ_OPTS
    ).trim();
    return base.length > 0 ? base : 'unknown';
  } catch {
    return 'unknown';
  }
}
