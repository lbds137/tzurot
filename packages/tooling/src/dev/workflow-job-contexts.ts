/**
 * Pure parse/expansion of a workflow file's `jobs:` mapping into the status-check contexts
 * (GitHub's naming for check-run contexts) each job actually produces. No I/O — the git read
 * and the required-checks evaluation built on top of this live in `main-required-checks.ts`.
 */

import { parse as parseYaml } from 'yaml';

/** jobId → the status-check contexts that job produces on origin/main, in production order,
 * deduped. */
export type WorkflowContexts = Map<string, string[]>;

/** Narrow an unknown value to a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A matrix value this module can reason about: string, number, or boolean. */
function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

const MATRIX_KEY_PATTERN = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;

/**
 * Cartesian product of every matrix axis (every key of `matrix` except `include`/`exclude`
 * whose value is an array), in key order, plus every `include` entry that is itself a plain
 * object, appended as its own combination.
 *
 * Known gap: GitHub actually MERGES an `include` entry into matching axis combinations rather
 * than always adding a new one — unimplemented; the two live matrices are include-only,
 * where the two readings coincide, so a divergence would read as an extra/altered leg
 * finding (loud), not a silently wrong verdict. `exclude` is handled by `expandJobContexts`
 * falling back to the bare job id before this function ever runs; the `key !== 'exclude'`
 * filter below is harmless (an `exclude` array is never an axis).
 */
function matrixCombinations(matrix: Record<string, unknown>): Record<string, unknown>[] {
  const axisKeys = Object.keys(matrix).filter(
    key => key !== 'include' && key !== 'exclude' && Array.isArray(matrix[key])
  );
  let combos: Record<string, unknown>[] = axisKeys.length === 0 ? [] : [{}];
  for (const key of axisKeys) {
    const values = matrix[key] as unknown[];
    combos = combos.flatMap(combo => values.map(value => ({ ...combo, [key]: value })));
  }
  const includeEntries = Array.isArray(matrix.include) ? matrix.include.filter(isPlainObject) : [];
  return [...combos, ...includeEntries];
}

/**
 * The context one matrix combination produces. A combination value that is not a scalar, a
 * name template referencing a key the combination lacks, or a name template leaving a
 * non-matrix `${{ }}` after substitution all yield the bare `jobId` — known gaps, loud (a leg
 * finding) rather than silent.
 */
function nameCombination(
  jobId: string,
  name: string | undefined,
  combo: Record<string, unknown>
): string {
  const values = Object.values(combo);
  if (!values.every(isScalar)) {
    return jobId;
  }
  if (name === undefined) {
    return `${jobId} (${values.map(String).join(', ')})`;
  }
  let missingKey = false;
  const substituted = name.replace(MATRIX_KEY_PATTERN, (match, key: string) => {
    if (!(key in combo)) {
      missingKey = true;
      return match;
    }
    return String(combo[key]);
  });
  return missingKey || substituted.includes('${{') ? jobId : substituted;
}

/** Dedupe an array of strings, preserving first occurrence. */
function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Contexts one job produces (GitHub's naming for check-run contexts). Exported for tests.
 *
 * - `job` not a plain object → `[jobId]`.
 * - No `strategy.matrix` at all: a string `name` with no `${{` is the sole context; otherwise
 *   `[jobId]` (no name, or an expression-valued name this module cannot evaluate).
 * - `matrix` present but not a plain object (an expression string, e.g.
 *   `${{ fromJSON(needs.x.outputs.m) }}`) → `[jobId]` — known gap: expression-valued matrices
 *   are not evaluated, so a required leg of such a job reads as a leg finding (loud, not
 *   silent) rather than being silently accepted.
 * - Zero combinations (an empty matrix object) → `[jobId]`.
 * - `matrix.exclude` present (any value) → `[jobId]` — known gap: `exclude` removes
 *   combinations and is not evaluated here, so the job is treated as producing only its
 *   bare id: every required leg of it becomes a leg finding and the re-add warning stays
 *   silent (loud, not silent, for a leg that might not exist).
 */
export function expandJobContexts(jobId: string, job: unknown): string[] {
  if (!isPlainObject(job)) {
    return [jobId];
  }
  const name = typeof job.name === 'string' ? job.name : undefined;
  const strategy = isPlainObject(job.strategy) ? job.strategy : undefined;
  const matrix = strategy?.matrix;

  if (matrix === undefined) {
    return name !== undefined && !name.includes('${{') ? [name] : [jobId];
  }
  if (!isPlainObject(matrix)) {
    return [jobId];
  }
  if (matrix.exclude !== undefined) {
    return [jobId];
  }
  const combinations = matrixCombinations(matrix);
  if (combinations.length === 0) {
    return [jobId];
  }
  return dedupe(combinations.map(combo => nameCombination(jobId, name, combo)));
}

/**
 * Contexts every job under `jobs:` of a workflow file's text produces (a real YAML parse, not
 * a line regex). Throws when the document has no `jobs` mapping — an unreadable workflow must
 * degrade the caller, never read as "zero jobs, every context is a violation" or "nothing to
 * check". Top-level keys like `on`/`push` are not jobs.
 */
export function parseWorkflowContexts(workflowYaml: string): WorkflowContexts {
  const doc = parseYaml(workflowYaml) as unknown;
  const jobs = isPlainObject(doc) ? doc.jobs : undefined;
  if (!isPlainObject(jobs)) {
    throw new Error('workflow YAML has no `jobs` mapping');
  }
  const contexts: WorkflowContexts = new Map();
  for (const [jobId, job] of Object.entries(jobs)) {
    contexts.set(jobId, expandJobContexts(jobId, job));
  }
  return contexts;
}
