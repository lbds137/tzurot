/**
 * Owner decision queue
 *
 * `state:owner` (`06-backlog.md` § State) marks a task that cannot move
 * without an owner decision. The convention this module enforces: every
 * `state:owner` task carries exactly two description lines —
 *
 * ```
 * Owner question: <one sentence>
 * Recommendation: <pick> — <reason>
 * ```
 *
 * — so the queue is always one named question plus a recommended answer, never
 * a bare "needs a decision" placeholder. The lint (`checkOwnerQueue`) gates on
 * both lines being present on every open `state:owner` task; the digest
 * (`ownerQueue` + `renderOwnerQueueLine`) renders the current queue so the
 * owner sees exactly what's waiting on them without opening each task file.
 */

import { openTasks, type TrackerTask } from './trackerTasks.js';

/** The label that puts a task in the owner decision queue. */
export const OWNER_STATE_LABEL = 'state:owner' as const;

/** Line prefix carrying the named question. */
export const OWNER_QUESTION_PREFIX = 'Owner question:' as const;

/** Line prefix carrying the recommended answer. */
export const RECOMMENDATION_PREFIX = 'Recommendation:' as const;

/**
 * Strip a leading list marker (`- ` / `* `) and a leading `**` from a line,
 * so `- **Owner question:** …` and `Owner question: …` both match the same
 * prefix check.
 */
function unwrapLine(line: string): string {
  let unwrapped = line.trimStart();
  if (unwrapped.startsWith('- ') || unwrapped.startsWith('* ')) {
    unwrapped = unwrapped.slice(2);
  }
  unwrapped = unwrapped.trimStart();
  if (unwrapped.startsWith('**')) {
    unwrapped = unwrapped.slice(2);
  }
  return unwrapped;
}

/** The value after `prefix` on `line`, or null when `line` doesn't carry it. */
function matchPrefix(line: string, prefix: string): string | null {
  const unwrapped = unwrapLine(line);
  if (!unwrapped.startsWith(prefix)) {
    return null;
  }
  let value = unwrapped.slice(prefix.length).trim();
  // The `**` closing a bold prefix (`**Owner question:**`) lands right after
  // the colon, ahead of the value — strip it before the trailing-`**` check.
  if (value.startsWith('**')) {
    value = value.slice(2).trim();
  }
  if (value.endsWith('**')) {
    value = value.slice(0, -2).trim();
  }
  return value;
}

/**
 * The task's `Owner question:` and `Recommendation:` lines, first match wins
 * for each. Either is null when the task body carries no such line.
 * @internal Exported for testing
 */
export function parseOwnerLines(task: TrackerTask): {
  question: string | null;
  recommendation: string | null;
} {
  let question: string | null = null;
  let recommendation: string | null = null;
  for (const line of task.body.split('\n')) {
    if (question === null) {
      const match = matchPrefix(line, OWNER_QUESTION_PREFIX);
      if (match !== null) {
        question = match;
      }
    }
    if (recommendation === null) {
      const match = matchPrefix(line, RECOMMENDATION_PREFIX);
      if (match !== null) {
        recommendation = match;
      }
    }
    if (question !== null && recommendation !== null) {
      break;
    }
  }
  return { question, recommendation };
}

/**
 * Every open `state:owner` task missing its question and/or recommendation
 * line. Question problems are reported before recommendation problems on a
 * task missing both.
 */
export function checkOwnerQueue(tasks: TrackerTask[]): string[] {
  const problems: string[] = [];
  for (const task of openTasks(tasks)) {
    if (!task.labels.includes(OWNER_STATE_LABEL)) {
      continue;
    }
    const { question, recommendation } = parseOwnerLines(task);
    if (question === null || question.length === 0) {
      problems.push(
        `${task.file}: state:owner task has no 'Owner question:' line (06-backlog § State)`
      );
    }
    if (recommendation === null || recommendation.length === 0) {
      problems.push(
        `${task.file}: state:owner task has no 'Recommendation:' line (06-backlog § State)`
      );
    }
  }
  return problems;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Sort rank for a task's priority; anything outside the vocabulary sorts last. */
function priorityRank(priority: string): number {
  return PRIORITY_ORDER[priority] ?? 3;
}

/**
 * `state:owner` tasks from an already-open list — Done exclusion is the
 * caller's job, as with `countByArea` / `oldestTasks` / `newestTasks` —
 * ordered priority high → medium → low (unknown last), then filing date
 * ascending, then id as a stable final tiebreak.
 */
export function ownerQueue(tasks: TrackerTask[]): TrackerTask[] {
  return tasks
    .filter(task => task.labels.includes(OWNER_STATE_LABEL))
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        (a.createdDate ?? '').localeCompare(b.createdDate ?? '') ||
        a.id.localeCompare(b.id)
    );
}

/**
 * One digest line for an owner-queue task: id, priority, question, and
 * recommendation. Never throws — a task missing either line falls back to a
 * placeholder rather than blowing up the digest, which is informational only.
 */
export function renderOwnerQueueLine(task: TrackerTask): string {
  const { question, recommendation } = parseOwnerLines(task);
  const questionText =
    question === null || question.length === 0 ? '(no Owner question line)' : question;
  const recommendationText =
    recommendation === null || recommendation.length === 0
      ? '(no Recommendation line)'
      : recommendation;
  return `- ${task.id} [${task.priority}] — ${questionText} → ${recommendationText}`;
}
