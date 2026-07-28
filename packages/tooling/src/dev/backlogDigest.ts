/**
 * Backlog Digest
 *
 * The session-start briefing over the tracker store: a ~60-line generated
 * summary of the open-task pool that replaces loading a 40KB+ markdown table
 * into every session. Run via `pnpm ops backlog:digest` (BACKLOG.md names it
 * as part of the session-start load).
 *
 * Three surfaces, in priority order:
 *  - **By area** — per-`area:*`-label counts, so any slice of the haystack is
 *    one query away (`pnpm tracker task list -l area:<x> --plain`).
 *  - **Oldest 20** — the aging escalation. Aging escalates, never deletes
 *    (`.claude/rules/06-backlog.md` § Staleness); this surface exists so the
 *    oldest items get a conscious decision instead of sinking. The old
 *    5-slot nudge starved when undated rows outnumbered slots — here every
 *    task has a date (the lint gates on it) and the window is 4× wider.
 *  - **Newest 10** — what was just filed, as a recency cross-check.
 *
 * Purely informational — never sets a failure exit code. Structural gating
 * lives in the backlog lint (`pnpm ops backlog`).
 */

import chalk from 'chalk';
import { loadTrackerTasks, openTasks, type TrackerTask } from './trackerTasks.js';

const OLDEST_COUNT = 20;
const NEWEST_COUNT = 10;
const TITLE_PREVIEW_LENGTH = 80;

const AREA_LABEL_PREFIX = 'area:';

/** @internal Exported for testing */
export function countByArea(tasks: TrackerTask[]): {
  areas: [string, number][];
  unlabeled: number;
} {
  const counts = new Map<string, number>();
  let unlabeled = 0;
  for (const task of tasks) {
    const areaLabels = task.labels.filter(l => l.startsWith(AREA_LABEL_PREFIX));
    if (areaLabels.length === 0) {
      unlabeled += 1;
      continue;
    }
    for (const label of areaLabels) {
      const area = label.slice(AREA_LABEL_PREFIX.length);
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }
  const areas = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { areas, unlabeled };
}

/** @internal Exported for testing */
export function oldestTasks(tasks: TrackerTask[], n: number): TrackerTask[] {
  return [...tasks]
    .sort(
      (a, b) => (a.createdDate ?? '').localeCompare(b.createdDate ?? '') || a.id.localeCompare(b.id)
    )
    .slice(0, n);
}

/** @internal Exported for testing */
export function newestTasks(tasks: TrackerTask[], n: number): TrackerTask[] {
  return [...tasks]
    .sort(
      (a, b) => (b.createdDate ?? '').localeCompare(a.createdDate ?? '') || b.id.localeCompare(a.id)
    )
    .slice(0, n);
}

function taskLine(task: TrackerTask): string {
  return `- ${task.createdDate ?? '????-??-??'}  ${task.id}  ${task.title.slice(0, TITLE_PREVIEW_LENGTH)}`;
}

interface DigestOptions {
  /** Repo root (defaults to cwd) */
  rootDir?: string;
}

/** CLI entry point. Informational only — never sets a failure exit code. */
export async function runBacklogDigest(options: DigestOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  const { tasks, problems } = loadTrackerTasks(rootDir);
  const open = openTasks(tasks);
  const inProgress = open.filter(t => t.status.toLowerCase() === 'in progress').length;

  const lines: string[] = [];
  lines.push(
    `# Backlog briefing (generated) — ${open.length} open tasks` +
      (inProgress > 0 ? ` (${inProgress} in progress)` : '')
  );
  lines.push('');

  lines.push('## By area (jump anywhere: pnpm tracker task list -l area:<x> --plain)');
  const { areas, unlabeled } = countByArea(open);
  for (const [area, count] of areas) {
    lines.push(`- ${area}: ${count}`);
  }
  if (unlabeled > 0) {
    lines.push(`- (no area label yet): ${unlabeled}`);
  }
  lines.push('');

  lines.push("## Oldest 20 (aging escalates — decide, don't delete)");
  for (const task of oldestTasks(open, OLDEST_COUNT)) {
    lines.push(taskLine(task));
  }
  lines.push('');

  lines.push('## Newest 10 filed');
  for (const task of newestTasks(open, NEWEST_COUNT)) {
    lines.push(taskLine(task));
  }

  console.log(lines.join('\n'));

  if (problems.length > 0) {
    // Surface but don't gate — the lint owns failing on these.
    console.log('');
    console.log(
      chalk.yellow(`⚠ ${problems.length} task file(s) unreadable (run \`pnpm ops backlog\`):`)
    );
    for (const problem of problems) {
      console.log(chalk.dim(`   - ${problem}`));
    }
  }
}
