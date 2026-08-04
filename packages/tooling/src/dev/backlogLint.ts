/**
 * Backlog Lint
 *
 * Structural checks on the backlog surfaces (see `.claude/rules/06-backlog.md`):
 *  - `now.md` section caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10
 *    (caps are parsed from the `(max N)` in each section heading).
 *  - `cold/queue.md` doc references (`doc-N`) all resolve to a real file in
 *    `tracker/docs/` (theme content lives there since the themes/ideas→docs
 *    migration; queue.md carries only the ordering).
 *  - `tracker/tasks/` integrity: every task file parses with an id, title, and
 *    created_date. A task that fails these silently vanishes from the digest,
 *    search, and the aging surface — the same content-destroying failure the
 *    old markdown table had (a merged row hid a real item for a month), so it
 *    gates rather than warns.
 *  - `tracker/tasks/` triage: every OPEN task carries the labels
 *    `06-backlog.md` requires at filing — at least one `area:*`, exactly one
 *    `size:S|M|L`, and a high/medium/low priority. Those three fields are what
 *    every selection query filters on, so an unlabelled task is filed into a
 *    blind spot. Done tasks are exempt: they're finished work awaiting archive.
 *
 * Run via `pnpm ops backlog`. Exits non-zero on a structural problem so it can
 * gate in `pnpm quality` and CI. This is a binary "is the layout in sync?"
 * check, NOT an audit-class tool — no baseline / WHY.md / canary
 * (see `.claude/rules/05-tooling.md` on the audit-class criteria).
 *
 * The aging-escalation surface (oldest open tasks) lives in the digest
 * (`pnpm ops backlog:digest`), which is read at session start — an
 * informational nudge printed into a CI log surfaced nothing.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadTrackerTasks, openTasks, type TrackerTask } from './trackerTasks.js';

/** @internal Exported for testing */
export interface SectionCap {
  /** Section heading text, e.g. '🎯 Current Focus (max 3)' */
  section: string;
  /** The declared cap parsed from `(max N)` */
  cap: number;
  /** Count of direct list items in the section */
  count: number;
}

const SECTION_CAP_PATTERN = /\(max\s+(\d+)\)/;

/**
 * Parse `now.md`: for each `### ...(max N)` heading, count direct list items
 * (top-level `- ` or `N. ` lines) until the next `###`. Sections without a
 * `(max N)` marker are ignored.
 * @internal Exported for testing
 */
export function parseSectionCaps(nowMd: string): SectionCap[] {
  const caps: SectionCap[] = [];
  let current: SectionCap | null = null;

  for (const line of nowMd.split('\n')) {
    if (line.startsWith('### ')) {
      if (current !== null) {
        caps.push(current);
      }
      const capMatch = SECTION_CAP_PATTERN.exec(line);
      current =
        capMatch !== null
          ? { section: line.replace(/^###\s+/, '').trim(), cap: Number(capMatch[1]), count: 0 }
          : null;
      continue;
    }
    // Count only top-level (non-indented) list items.
    if (current !== null && /^(?:-|\d+\.)\s/.test(line)) {
      current.count += 1;
    }
  }
  if (current !== null) {
    caps.push(current);
  }
  return caps;
}

/**
 * Extract backticked `doc-N` references from `queue.md`.
 * @internal Exported for testing
 */
export function extractQueueDocRefs(queueMd: string): string[] {
  const refs: string[] = [];
  const pattern = /`(doc-\d+)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(queueMd)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

interface LintOptions {
  /** Repo root (defaults to cwd) */
  rootDir?: string;
}

/** Structural problems from now.md section caps. */
function checkNowCaps(rootDir: string): string[] {
  const nowPath = join(rootDir, 'backlog/now.md');
  if (!existsSync(nowPath)) {
    return ['backlog/now.md not found'];
  }
  return parseSectionCaps(readFileSync(nowPath, 'utf-8'))
    .filter(cap => cap.count > cap.cap)
    .map(cap => `now.md: "${cap.section}" has ${cap.count} items (cap ${cap.cap})`);
}

/** queue.md doc references that don't resolve to a file in tracker/docs/. */
function checkQueueDocRefs(rootDir: string): string[] {
  const queuePath = join(rootDir, 'backlog/cold/queue.md');
  if (!existsSync(queuePath)) {
    return [];
  }
  const docsDir = join(rootDir, 'tracker/docs');
  const files = existsSync(docsDir) ? readdirSync(docsDir) : [];
  // Filenames are `doc-N - Title.md`; match on the space-delimited id prefix
  // so `doc-1` never matches `doc-14 - ...`.
  const existingIds = new Set(files.map(f => f.split(' ')[0]));
  return extractQueueDocRefs(readFileSync(queuePath, 'utf-8'))
    .filter(ref => !existingIds.has(ref))
    .map(ref => `queue.md: dangling doc reference → ${ref} (no tracker/docs/ file)`);
}

const SIZE_LABEL_PATTERN = /^size:[SML]$/;
const AREA_LABEL_PREFIX = 'area:';
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

/**
 * Triage completeness on the open pool: area label, size label, priority.
 *
 * `06-backlog.md` requires all three at filing, and they are exactly the axes
 * the selection queries filter on (`-l area:x`, `-l size:S --priority high`) —
 * a task missing any of them is filed somewhere no query looks. Enforcing it
 * here converts the filing rule from memory-dependent to structural.
 *
 * Only open tasks are checked; a Done task is finished work waiting on the
 * archive sweep, and back-filling labels onto it buys nothing.
 * @internal Exported for testing
 */
export function checkTaskTriage(tasks: TrackerTask[]): string[] {
  const problems: string[] = [];
  for (const task of openTasks(tasks)) {
    const sizeLabels = task.labels.filter(label => SIZE_LABEL_PATTERN.test(label));
    if (sizeLabels.length === 0) {
      problems.push(`${task.file}: open task has no size label (size:S | size:M | size:L)`);
    } else if (sizeLabels.length > 1) {
      problems.push(
        `${task.file}: open task has ${sizeLabels.length} size labels — exactly one is required`
      );
    }
    if (!task.labels.some(label => label.startsWith(AREA_LABEL_PREFIX))) {
      problems.push(`${task.file}: open task has no area label (area:<package-or-domain>)`);
    }
    if (!VALID_PRIORITIES.has(task.priority)) {
      problems.push(
        `${task.file}: open task has priority '${task.priority}' — must be high | medium | low`
      );
    }
  }
  return problems;
}

function reportProblems(problems: string[]): void {
  if (problems.length === 0) {
    console.log(
      chalk.green(
        '✓ Backlog layout in sync (caps respected, links resolve, tracker store parses, open tasks triaged)'
      )
    );
    return;
  }
  console.log(chalk.red.bold('✖ Backlog structural problems:'));
  for (const problem of problems) {
    console.log(chalk.red(`   - ${problem}`));
  }
}

/**
 * CLI entry point. Sets a non-zero exit code on any structural problem (cap
 * exceeded, dangling doc reference, unreadable tracker task, untriaged open
 * task).
 */
export async function runBacklogLint(options: LintOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();

  // A task that failed to parse is already in `problems` and absent from
  // `tasks`, so the triage check never double-reports it.
  const { tasks, problems: trackerProblems } = loadTrackerTasks(rootDir);
  const problems = [
    ...checkNowCaps(rootDir),
    ...checkQueueDocRefs(rootDir),
    ...trackerProblems,
    ...checkTaskTriage(tasks),
  ];
  reportProblems(problems);

  if (problems.length > 0) {
    process.exitCode = 1;
  }
}
