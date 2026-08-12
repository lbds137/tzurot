/**
 * Tracker task store access
 *
 * The backlog's small-item pool lives in `tracker/tasks/*.md` — one Backlog.md
 * (`pnpm tracker`) task file per item: YAML frontmatter + markdown body. This
 * module is the single parser for every tool that reads the store (the digest,
 * the backlog lint, the deferred-refs tripwire), so the shape assumptions live
 * in exactly one place.
 *
 * The CLI owns the file shape. Reading here is deliberately tolerant of
 * value-level variation (single-quoted, double-quoted, and unquoted titles all
 * occur in the store; labels appear as both inline and block lists) but STRICT
 * about structural integrity: a file whose frontmatter won't parse or lacks
 * id/title/created_date is reported as a problem rather than skipped, because
 * such a task silently vanishes from every query surface — the exact failure
 * the old markdown table suffered when a row lost its shape.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Store location relative to the repo root. Matches `backlog.config.yml`.
 *
 * Exported because `backlogLint` also addresses this directory (to compare it
 * against the archive); a second local copy of the literal would be a second
 * source of truth kept in step by hand.
 */
export const TRACKER_TASKS_DIR = 'tracker/tasks';

/** @internal Exported for testing */
export interface TrackerTask {
  /** Task id from frontmatter, e.g. 'TASK-100' */
  id: string;
  title: string;
  /** Workflow status, e.g. 'To Do' / 'In Progress' / 'Done' */
  status: string;
  /** Filing date (YYYY-MM-DD) — the aging anchor. Null when unparseable. */
  createdDate: string | null;
  labels: string[];
  /** Priority from frontmatter ('high' | 'medium' | 'low'); empty string when absent */
  priority: string;
  /** Markdown body after the frontmatter block */
  body: string;
  /** Path of the task file relative to the repo root */
  file: string;
}

/** @internal Exported for testing */
export type TaskParseResult = { ok: true; task: TrackerTask } | { ok: false; problem: string };

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---/;

/** Coerce a frontmatter value to a trimmed string, or null when absent. */
function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

/**
 * The filing date's YYYY-MM-DD prefix. Backlog.md stamps `created_date` as
 * 'YYYY-MM-DD HH:mm'; only the date part is the aging anchor.
 */
function parseCreatedDate(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match === null ? null : match[1];
}

/** Labels normalized to a string array regardless of YAML list style. */
function parseLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((label): label is string => typeof label === 'string');
}

/**
 * Parse one task file's content.
 * @internal Exported for testing
 */
export function parseTaskFile(content: string, file: string): TaskParseResult {
  const frontmatter = FRONTMATTER_PATTERN.exec(content);
  if (frontmatter === null) {
    return { ok: false, problem: `${file}: no frontmatter block` };
  }

  let data: unknown;
  try {
    data = parseYaml(frontmatter[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { ok: false, problem: `${file}: frontmatter is not valid YAML (${message})` };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, problem: `${file}: frontmatter is not a YAML mapping` };
  }

  const record = data as Record<string, unknown>;
  const id = asString(record.id);
  const title = asString(record.title);
  if (id === null || title === null) {
    return { ok: false, problem: `${file}: frontmatter is missing id or title` };
  }
  const createdDate = parseCreatedDate(record.created_date);
  if (createdDate === null) {
    // A dateless task can never be aged — the class the old table's undated
    // rows fell into. The CLI always stamps created_date, so absence means a
    // hand edit broke the file.
    return { ok: false, problem: `${file}: frontmatter is missing a parseable created_date` };
  }

  return {
    ok: true,
    task: {
      id,
      title,
      status: asString(record.status) ?? '',
      createdDate,
      labels: parseLabels(record.labels),
      priority: asString(record.priority) ?? '',
      body: content.slice(frontmatter[0].length),
      file,
    },
  };
}

/** @internal Exported for testing */
export interface TrackerLoadResult {
  tasks: TrackerTask[];
  /** Structural problems — files that exist but can't participate in queries */
  problems: string[];
}

/**
 * Load every task in the store. A missing store directory is reported as a
 * problem (the store is load-bearing post-flip); individual unparseable files
 * are reported per-file so one broken task never hides the rest.
 */
export function loadTrackerTasks(rootDir: string): TrackerLoadResult {
  const dir = join(rootDir, TRACKER_TASKS_DIR);
  if (!existsSync(dir)) {
    return { tasks: [], problems: [`${TRACKER_TASKS_DIR}/ not found`] };
  }

  const tasks: TrackerTask[] = [];
  const problems: string[] = [];
  for (const name of readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()) {
    const file = `${TRACKER_TASKS_DIR}/${name}`;
    const result = parseTaskFile(readFileSync(join(dir, name), 'utf-8'), file);
    if (result.ok) {
      tasks.push(result.task);
    } else {
      problems.push(result.problem);
    }
  }
  return { tasks, problems };
}

/**
 * The active pool: everything not yet Done. Done tasks stay in the store until
 * archived by the CLI, but they're finished work — no query surface should
 * count them as open.
 */
export function openTasks(tasks: TrackerTask[]): TrackerTask[] {
  return tasks.filter(t => t.status.toLowerCase() !== 'done');
}
