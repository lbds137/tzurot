/**
 * `release:develop-ci` — release-preflight check on develop's last CODE push.
 *
 * A board-only develop tip runs CI with every heavy job skipped (the `changes`
 * job in ci.yml), so its run is green while the previous code merge's run may
 * be red, cancelled or unfinished on its own SHA. This walks develop's push
 * runs newest-first, steps over the board-only ones (their probe job is
 * `skipped`, which holds even while the run is still in progress), and reports
 * the first real one.
 *
 * Exit codes: 0 = that run completed with success; 1 = finding (that run
 * failed, was cancelled, or has no verdict yet); 2 = no code run in the
 * window; 3 = cannot classify a run (it has jobs but no probe job, so the
 * probe was probably renamed); 4 = tool error (gh or JSON failure).
 */

import { ghCall } from '../gh/ghCall.js';
import { REPO } from '../gh/github-api.js';
import { RELEASE_GIT_TIMEOUT_MS } from './constants.js';

const RUNS_PAGE_SIZE = 30;
/**
 * The ci.yml job the `changes` gate skips on a board-only push. A test pins
 * that ci.yml still has this job id, gated on `needs.changes.outputs.board_only`.
 */
export const BOARD_ONLY_PROBE_JOB = 'lint';

interface WorkflowRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

interface RunJob {
  name: string;
  conclusion: string | null;
}

/** Runs one `gh` call and returns stdout; injectable so tests need no network. */
export type GhRunner = (args: string[]) => string;

export interface DevelopCiResult {
  exitCode: 0 | 1 | 2 | 3 | 4;
  message: string;
}

const defaultGh: GhRunner = args => ghCall(args, RELEASE_GIT_TIMEOUT_MS);

function listRuns(gh: GhRunner): WorkflowRun[] {
  const raw = gh([
    'api',
    `repos/${REPO}/actions/workflows/ci.yml/runs?branch=develop&event=push&per_page=${RUNS_PAGE_SIZE}`,
  ]);
  const parsed = JSON.parse(raw) as { workflow_runs?: WorkflowRun[] };
  return parsed.workflow_runs ?? [];
}

function fetchJobs(gh: GhRunner, runId: number): RunJob[] {
  const raw = gh(['api', `repos/${REPO}/actions/runs/${runId}/jobs?per_page=100`]);
  return (JSON.parse(raw) as { jobs?: RunJob[] }).jobs ?? [];
}

function describeRun(run: WorkflowRun, state: string): string {
  return `${state} run ${run.id} sha ${run.head_sha.slice(0, 9)} ${run.html_url}`;
}

/** Pure of I/O apart from the injected runner; throws on gh/JSON failure. */
export function checkDevelopCi(gh: GhRunner = defaultGh): DevelopCiResult {
  // Newest first, regardless of API ordering.
  const runs = listRuns(gh).sort((a, b) => b.id - a.id);
  for (const run of runs) {
    const jobs = fetchJobs(gh, run.id);
    const probe = jobs.find(job => job.name === BOARD_ONLY_PROBE_JOB);
    // A probe `skipped` marks a board-only run only when the run itself did not
    // end badly: a run cancelled (or failed) before `lint` started also leaves
    // it `skipped`, because its `if` carries `!cancelled()`.
    if (
      probe?.conclusion === 'skipped' &&
      (run.status !== 'completed' || run.conclusion === 'success')
    ) {
      continue;
    }
    // Jobs exist but the probe is absent: not provably a code run, so refuse
    // to call it one. A run with zero jobs (startup_failure) falls through.
    if (jobs.length > 0 && probe === undefined) {
      return {
        exitCode: 3,
        message: `cannot classify: no ${BOARD_ONLY_PROBE_JOB} job in run ${run.id} — ci.yml probe job renamed?`,
      };
    }
    if (run.status !== 'completed') {
      return { exitCode: 1, message: describeRun(run, run.status) };
    }
    const conclusion = run.conclusion ?? 'unknown';
    return {
      exitCode: conclusion === 'success' ? 0 : 1,
      message: describeRun(run, conclusion),
    };
  }
  return {
    exitCode: 2,
    message: `No non-board develop push run among the last ${runs.length} CI runs.`,
  };
}

export function releaseDevelopCi(gh: GhRunner = defaultGh): void {
  let result: DevelopCiResult;
  try {
    result = checkDevelopCi(gh);
  } catch (error) {
    result = { exitCode: 4, message: `release:develop-ci failed: ${(error as Error).message}` };
  }
  if (result.exitCode === 4) console.error(result.message);
  else console.log(result.message);
  process.exitCode = result.exitCode;
}
