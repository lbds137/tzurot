/**
 * JSON-report reading for the diff-scoped mutation gate
 * (`ops test:mutation-scoped`, see mutation-scoped.ts for the runner).
 *
 * Pure: report text → per-package mutant counts and failure locations.
 * A not-covered (NoCoverage) mutant fails the gate just like a survivor: if
 * no test even executes the mutated line, the killing assertion cannot exist.
 */

/** Mutant tally for one package (or the whole run). */
export interface MutationSummary {
  generated: number;
  killed: number;
  survived: number;
  /** NoCoverage mutants — no test executes the mutated line; gated like a survivor. */
  noCoverage: number;
  /** Timeout/RuntimeError/CompileError mutants — reported, not gated on. */
  other: number;
  /** Absent when Stryker reported no location for the mutant — no fake 0 is printed. */
  survivors: { file: string; line?: number }[];
  /** Where the NoCoverage mutants sit, printed beside the survivors on failure. */
  uncovered: { file: string; line?: number }[];
}

interface ReportMutant {
  status?: string;
  location?: { start?: { line?: number } };
}

interface JsonReport {
  files?: Record<string, { mutants?: ReportMutant[] }>;
}

/** Read a mutation.json report (the authoritative per-package summary). */
export function summarizeReport(reportJson: string, packageDir: string): MutationSummary {
  const report = JSON.parse(reportJson) as JsonReport;
  let generated = 0;
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let other = 0;
  const survivors: { file: string; line?: number }[] = [];
  const uncovered: { file: string; line?: number }[] = [];
  for (const [fileKey, entry] of Object.entries(report.files ?? {})) {
    // ASSUMPTION: Stryker writes the `files` keys relative to the cwd it ran in —
    // the package dir, since the scoped run execs inside the package — so prefixing
    // packageDir reconstructs the repo-root path.
    for (const mutant of entry.mutants ?? []) {
      const status = (mutant.status ?? '').toLowerCase();
      if (status === 'ignored') {
        continue;
      }
      generated += 1;
      if (status === 'killed') {
        killed += 1;
      } else if (status === 'survived') {
        survived += 1;
        survivors.push({ file: `${packageDir}/${fileKey}`, line: mutant.location?.start?.line });
      } else if (status === 'nocoverage') {
        noCoverage += 1;
        uncovered.push({ file: `${packageDir}/${fileKey}`, line: mutant.location?.start?.line });
      } else {
        other += 1;
      }
    }
  }
  return { generated, killed, survived, noCoverage, other, survivors, uncovered };
}

/**
 * Fallback when the JSON report is absent: Stryker's clear-text "All files" row.
 * Returns null when the row is missing — a rowless output is a failed or
 * unparseable Stryker run, never "zero mutants"; the runner maps null to a
 * package error (pinned by the rowless-stdout tests).
 */
export function parseTextSummary(stdout: string): MutationSummary | null {
  const row = stdout.split('\n').find(line => line.trim().startsWith('All files'));
  if (row === undefined) {
    return null;
  }
  const cells = row.split('|').map(cell => cell.trim());
  const count = (index: number): number => {
    const value = cells[index];
    return value === undefined || value === 'n/a' || value === '' ? 0 : Number(value) || 0;
  };
  // Row layout: name | total score | covered score | killed | timeout | survived | no cov | errors
  // (the name column is first — the row has no leading pipe).
  const killed = count(3);
  const survived = count(5);
  const noCoverage = count(6);
  const other = count(4) + count(7);
  return {
    generated: killed + survived + other + noCoverage,
    killed,
    survived,
    noCoverage,
    other,
    survivors: [],
    uncovered: [],
  };
}
