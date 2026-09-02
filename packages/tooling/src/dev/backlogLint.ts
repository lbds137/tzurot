/**
 * Backlog Lint
 *
 * Structural checks on the backlog surfaces (see `.claude/rules/06-backlog.md`):
 *  - `now.md` section caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10
 *    (caps are parsed from the `(max N)` in each section heading).
 *  - `cold/queue.md` doc references (`doc-N`) all resolve to a real file in
 *    `tracker/docs/` (theme content lives there since the themes/ideas→docs
 *    migration; queue.md carries only the ordering).
 *  - Relative markdown links (`[text](../foo.md)`) inside `tracker/docs/`,
 *    `tracker/tasks/`, and `backlog/` (recursively) resolve on disk. The
 *    migration that moved theme content into `tracker/docs/` depth-rewrote
 *    every outbound relative link once; nothing gated future rot until this
 *    check. `tracker/archive/` is deliberately NOT scanned — archived content
 *    is frozen, so gating on it would block a PR over a document nobody is
 *    going to fix.
 *  - `tracker/tasks/` integrity: every task file parses with an id, title, and
 *    created_date. A task that fails these silently vanishes from the digest,
 *    search, and the aging surface — the same content-destroying failure the
 *    old markdown table had (a merged row hid a real item for a month), so it
 *    gates rather than warns.
 *  - `tracker/tasks/` triage: every OPEN task carries the labels
 *    `06-backlog.md` requires at filing — at least one `area:*`, exactly one
 *    `size:S|M|L`, exactly one `state:*`, and a high/medium/low priority. Those
 *    four fields are what every selection query filters on, so an unlabelled
 *    task is filed into a blind spot: a filter that returns nothing reads as
 *    "no such work", never as "the label is missing". Done tasks are exempt:
 *    they're finished work awaiting archive.
 *  - `tracker/tasks/` and `tracker/archive/tasks/` are disjoint by id, and the
 *    archive itself holds one file per id. An archived task whose live copy
 *    survived still answers every open-pool query while the operator believes
 *    it superseded, and both halves parse cleanly, so nothing else surfaces it.
 *
 * Separately, and NOT gating: a warning naming any uncommitted file under
 * `tracker/`. Everything above parses the tracker tree off disk, so a task git
 * has never seen passes every check — green while invisible to the digest and
 * to every query. That one is advisory because a half-written task file is a
 * legitimate working state.
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

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import chalk from 'chalk';
import { checkBacklogConfig } from './backlogConfigGate.js';
import { checkOwnerQueue } from './backlogOwnerQueue.js';
import { parseLinkDestinations } from './markdownLinks.js';
import { checkUncommittedTrackerFiles, readTrackerGitStatus } from './trackerGitStatus.js';
import {
  loadTrackerTasks,
  openTasks,
  TRACKER_TASKS_DIR,
  type TrackerTask,
} from './trackerTasks.js';

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
  /**
   * The origin/develop task listing for the id-collision check. Injected by
   * tests; read from git when absent.
   */
  origin?: OriginTaskListing;
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

/**
 * The `doc-N` ids that currently exist as files in `tracker/docs/`.
 *
 * Filenames are `doc-N - Title.md`; matching on the space-delimited id prefix
 * is what stops `doc-1` from matching `doc-14 - …`.
 */
function existingDocIds(rootDir: string): Set<string> {
  const docsDir = join(rootDir, 'tracker/docs');
  const files = existsSync(docsDir) ? readdirSync(docsDir) : [];
  return new Set(files.map(f => String(f).split(' ')[0]));
}

/** queue.md doc references that don't resolve to a file in tracker/docs/. */
function checkQueueDocRefs(rootDir: string): string[] {
  const queuePath = join(rootDir, 'backlog/cold/queue.md');
  if (!existsSync(queuePath)) {
    return [];
  }
  const existingIds = existingDocIds(rootDir);
  // Repo-relative, matching checkDocIdRefs below — the two checks report the
  // same finding about the same convention, and a bare `queue.md` prefix reads
  // as a different kind of location than its sibling's full path. Derived from
  // queuePath rather than written out again, so the message cannot drift away
  // from the file actually read. (checkRelativeLinks reaches the same repo-
  // relative form by a different route — its `rel` accumulates down the
  // directory walk — so the shared property is "derived from the real path",
  // not a shared mechanism.)
  const queueRel = relative(rootDir, queuePath);
  return extractQueueDocRefs(readFileSync(queuePath, 'utf-8'))
    .filter(ref => !existingIds.has(ref))
    .map(ref => `${queueRel}: dangling doc reference → ${ref} (no tracker/docs/ file)`);
}

/**
 * `doc-N` references in the scanned bodies that no longer resolve.
 *
 * Cross-references between docs are written as a backticked `doc-N` token
 * rather than a path — the filenames carry spaces and em-dashes, which make
 * fragile link targets. That convention was previously validated ONLY inside
 * `queue.md`, so every other `doc-N` mention could dangle silently through a
 * renumber or a delete: the same rot class the relative-link check above
 * closes, in the form the fix for it produces.
 *
 * Read from RAW markdown, not the code-stripped text the link extractor uses —
 * backticks ARE the convention here, so stripping code spans would erase every
 * reference this is meant to check.
 */
function checkDocIdRefs(rootDir: string): string[] {
  const existingIds = existingDocIds(rootDir);
  const problems: string[] = [];
  for (const scanDir of RELATIVE_LINK_SCAN_DIRS) {
    const dir = join(rootDir, scanDir);
    if (!existsSync(dir)) {
      continue;
    }
    for (const { abs, rel } of collectMarkdownFiles(dir, scanDir)) {
      // queue.md has its own check above, with a message specific to the
      // theme-ordering index; skip it rather than report it twice.
      if (rel.endsWith('cold/queue.md')) continue;
      for (const ref of extractQueueDocRefs(readFileSync(abs, 'utf-8'))) {
        if (!existingIds.has(ref)) {
          problems.push(`${rel}: dangling doc reference → ${ref} (no tracker/docs/ file)`);
        }
      }
    }
  }
  return problems;
}

/**
 * The directories whose markdown bodies carry outbound relative links.
 * `backlog` is scanned recursively (`backlog/cold/` holds the queue and epic
 * log); the tracker directories are flat but go through the same walk.
 */
const RELATIVE_LINK_SCAN_DIRS = ['tracker/docs', TRACKER_TASKS_DIR, 'backlog'];

/** Every `.md` file under `dir`, recursively, paired with its repo-relative path. */
function collectMarkdownFiles(dir: string, relDir: string): { abs: string; rel: string }[] {
  const found: { abs: string; rel: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = join(relDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectMarkdownFiles(abs, rel));
    } else if (entry.name.endsWith('.md')) {
      found.push({ abs, rel });
    }
  }
  return found;
}

/**
 * Relative markdown links in the scanned directories that don't resolve to a
 * file on disk. Each target resolves against the directory of the file that
 * contains it, not the scan root — `backlog/cold/epic-log.md` and
 * `backlog/now.md` sit at different depths and their `../` means different
 * things.
 *
 * Reports a second class alongside the dangling ones: a destination whose
 * unbracketed whitespace stops it rendering as a link at all. That one resolves
 * fine on disk, which is exactly why it needs its own report — the file is
 * there, so the existence check has nothing to say, and the reference is
 * silently plain text on GitHub.
 *
 * Non-rendering targets are deliberately NOT existence-checked, so a
 * doubly-broken reference reports only its form. The bucket holds raw captures,
 * some of them truncation artifacts (`../notes (draft`) that never named a real
 * path — appending "and the file is missing" to those would be wrong exactly
 * where the report is already approximate. Fix the form and the next run
 * resolves the target properly.
 */
function checkRelativeLinks(rootDir: string): string[] {
  const problems: string[] = [];
  for (const scanDir of RELATIVE_LINK_SCAN_DIRS) {
    const dir = join(rootDir, scanDir);
    if (!existsSync(dir)) {
      continue;
    }
    for (const { abs, rel } of collectMarkdownFiles(dir, scanDir)) {
      const content = readFileSync(abs, 'utf-8');
      const { resolvable, nonRendering } = parseLinkDestinations(content);
      for (const target of resolvable) {
        const resolved = join(dirname(abs), target);
        if (!existsSync(resolved)) {
          problems.push(
            `${rel}: dangling relative link → ${target} (resolved: ${relative(rootDir, resolved)})`
          );
        }
      }
      for (const target of nonRendering) {
        // The target is echoed, never rebuilt into a suggestion: the capture
        // truncates at a literal `)`, so a constructed `<…>` fix would be wrong
        // for exactly the destinations that need it most.
        problems.push(
          `${rel}: link target has unbracketed whitespace so it will not render → ${target} ` +
            `(wrap the destination in angle brackets or percent-encode the whitespace)`
        );
      }
    }
  }
  return problems;
}

const AREA_LABEL_PREFIX = 'area:';
const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);

/**
 * A label axis that must appear exactly once, with its full vocabulary.
 *
 * `state:*` is the reachability axis — what has to happen before this task can
 * be picked up. `size:*` is effort. Both are enumerated rather than pattern-
 * matched so a failure message can print the accepted values.
 */
interface LabelAxis {
  readonly name: string;
  readonly prefix: string;
  readonly values: readonly string[];
}

const SIZE_AXIS: LabelAxis = { name: 'size', prefix: 'size:', values: ['S', 'M', 'L'] };
// `unreachable` was retired: its definition — the only trigger is "next time
// someone touches this" — describes exactly the case the admission bar says to
// do NOW rather than file, so the value only ever collected items that should
// not have been filed. Closed tasks keep the old label harmlessly; this axis
// is validated on open tasks only.
const STATE_AXIS: LabelAxis = {
  name: 'state',
  prefix: 'state:',
  values: ['ready', 'observable', 'dependent', 'owner'],
};

const vocabularyOf = (axis: LabelAxis): string =>
  axis.values.map(value => `${axis.prefix}${value}`).join(' | ');

/**
 * Problems on one exactly-once label axis.
 *
 * The distinction that matters: **presence is measured on the PREFIX, validity
 * on the vocabulary.** Measuring presence on the vocabulary instead makes an
 * out-of-vocabulary value (`state:blocked`, `size:XL`) report as "no label" —
 * which sends the reader to add a label that is already sitting there, and, if
 * the unknown-value message is also emitted, tells them the label is absent and
 * present in the same breath. Each shape gets exactly one message:
 *
 * - no `prefix` label at all → missing
 * - a `prefix` label outside the vocabulary → unknown, naming the value
 * - more than one VALID value → too many
 */
function checkLabelAxis(task: TrackerTask, axis: LabelAxis): string[] {
  const accepted = new Set(axis.values.map(value => `${axis.prefix}${value}`));
  const present = task.labels.filter(label => label.startsWith(axis.prefix));
  const valid = present.filter(label => accepted.has(label));

  if (present.length === 0) {
    return [`${task.file}: open task has no ${axis.name} label (${vocabularyOf(axis)})`];
  }

  const problems = present
    .filter(label => !accepted.has(label))
    .map(
      label =>
        `${task.file}: open task has unknown ${axis.name} label '${label}' — must be one of ${vocabularyOf(axis)}`
    );

  if (valid.length > 1) {
    problems.push(
      `${task.file}: open task has ${valid.length} ${axis.name} labels — exactly one is required`
    );
  }
  return problems;
}

/**
 * Triage completeness on the open pool: area, size, state, priority.
 *
 * `06-backlog.md` requires all four at filing, and they are exactly the axes
 * the selection queries filter on (`-l area:x`, `-l state:ready -l size:S
 * --priority high`) — a task missing any of them is filed somewhere no query
 * looks. Enforcing it here converts the filing rule from memory-dependent to
 * structural.
 *
 * `state:*` was the axis that proved the point: it governed drain selection and
 * was carried by every open task, yet nothing checked it, so a batch filed
 * without it went straight into the pool invisible to the query that would have
 * surfaced it. Absence of a filter value reads as "no such work", never as "the
 * label is missing" — which is why this has to be structural rather than a
 * habit.
 *
 * Only open tasks are checked; a Done task is finished work waiting on the
 * archive sweep, and back-filling labels onto it buys nothing.
 * @internal Exported for testing
 */
export function checkTaskTriage(tasks: TrackerTask[]): string[] {
  const problems: string[] = [];
  for (const task of openTasks(tasks)) {
    problems.push(...checkLabelAxis(task, SIZE_AXIS));
    problems.push(...checkLabelAxis(task, STATE_AXIS));

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

/* -------------------------------------------------------------------------- */
/* Task-id collisions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `tracker/tasks/` as it exists on `origin/develop`, or the fact that the ref
 * could not be resolved.
 *
 * The CLI allocates the next task id by scanning the CURRENT working tree, so a
 * task filed on an unmerged sibling branch is invisible and the same id gets
 * handed out twice. Neither branch's own lint can see that — the collision only
 * exists in the union — so the comparison has to reach outside the working tree.
 */
export interface OriginTaskListing {
  /** False when `origin/develop` could not be resolved (e.g. a shallow clone). */
  resolvable: boolean;
  /** Repo-root-relative task file paths on origin/develop. */
  files: string[];
}

/**
 * The id token a task filename starts with, e.g. `task-453 - Foo.md` → `task-453`.
 *
 * The trailing `.md` is stripped so a title-less filename (`task-453.md`, no
 * ` - Title` suffix) still yields `task-453` rather than `task-453.md` — which
 * would silently never match a frontmatter id and turn a real collision into a
 * false negative. The convention is CLI-enforced, so this is belt-and-braces,
 * but it fails LOUD rather than toward silence.
 */
function fileIdToken(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.split(' ')[0].replace(/\.md$/i, '').toLowerCase();
}

/**
 * Bound on both origin reads below. This runs inside `pnpm quality` and CI;
 * a stalled git must degrade to the documented `resolvable: false` answer
 * rather than hang the gate.
 */
export const ORIGIN_TASKS_TIMEOUT_MS = 15_000;

/** Read the origin listing via git; unresolvable is a normal, non-fatal answer. */
export function readOriginTaskFiles(rootDir: string): OriginTaskListing {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'origin/develop'], {
      cwd: rootDir,
      stdio: 'ignore',
      timeout: ORIGIN_TASKS_TIMEOUT_MS,
    });
  } catch {
    return { resolvable: false, files: [] };
  }
  try {
    const raw = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', 'origin/develop', '--', 'tracker/tasks/'],
      {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: ORIGIN_TASKS_TIMEOUT_MS,
      }
    );
    return {
      resolvable: true,
      files: raw
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.endsWith('.md')),
    };
  } catch {
    return { resolvable: false, files: [] };
  }
}

/**
 * Two task files in the WORKING TREE carrying the same `id:`.
 *
 * This is the post-merge shape: two branches each filed a task, each parsed
 * cleanly in isolation, and the union has a duplicated id under which every
 * id-based query (`task edit`, `task view`, cross-references) is ambiguous.
 * @internal Exported for testing
 */
export function checkDuplicateTaskIds(tasks: TrackerTask[]): string[] {
  const byId = new Map<string, string[]>();
  for (const task of tasks) {
    const files = byId.get(task.id) ?? [];
    files.push(task.file);
    byId.set(task.id, files);
  }
  return [...byId.entries()]
    .filter(([, files]) => files.length > 1)
    .map(
      ([id, files]) => `duplicate task id ${id} across ${files.length} files: ${files.join(', ')}`
    );
}

const ARCHIVE_TASKS_DIR = 'tracker/archive/tasks';

/**
 * Markdown filenames in one task directory, or `[]` when it does not exist.
 *
 * Deliberately a directory listing rather than a projection of the parsed
 * `tasks`: a file that fails to parse is absent from that list, and an
 * unparseable live copy of an archived task is exactly as invisible as a
 * parseable one — more so, since the parse failure gives no hint that a
 * second copy exists.
 */
function readTaskFileNames(rootDir: string, dir: string): string[] {
  const abs = join(rootDir, dir);
  if (!existsSync(abs)) {
    return [];
  }
  // Sorted to match `loadTrackerTasks`, so findings come out in the same order
  // run to run — `readdirSync` makes no ordering guarantee on a real filesystem.
  return readdirSync(abs)
    .filter(name => name.endsWith('.md'))
    .sort();
}

/** @internal Exported for testing */
export function readArchivedTaskFiles(rootDir: string): string[] {
  return readTaskFileNames(rootDir, ARCHIVE_TASKS_DIR);
}

/** @internal Exported for testing */
export function readLiveTaskFiles(rootDir: string): string[] {
  return readTaskFileNames(rootDir, TRACKER_TASKS_DIR);
}

/**
 * Any task id answered by more than one file: across `tracker/tasks/` and
 * `tracker/archive/tasks/`, or twice within the archive itself.
 *
 * The archive is how an item exits the pool, so the two directories must be
 * disjoint and the archive must hold one file per id — and each copy parses
 * fine on its own, so nothing else surfaces the overlap. This is
 * `06-backlog.md`'s "a missing label is indistinguishable from absent work"
 * read in reverse.
 *
 * Compared by id token rather than by full filename, so a rename on either
 * side cannot hide it — and because the id, not the title, is what every CLI
 * lookup resolves.
 *
 * Two causes, both real, hence a message naming both remedies. A live copy can
 * SURVIVE an archive move (delete it), or a genuinely new task can be handed a
 * RECYCLED id (renumber it): the allocator numbers from the live directory
 * only — probed, `task-9001` in the archive still yielded `TASK-552` — so
 * archiving the highest-numbered task frees its id for the next create.
 *
 * No bypass env var, unlike `checkOriginIdCollisions`: a rename can make that
 * check spurious, while nothing makes two files answering one id harmless.
 * @internal Exported for testing
 */
export function checkArchiveIdConflicts(liveFiles: string[], archivedFiles: string[]): string[] {
  const archivedById = new Map<string, string[]>();
  for (const name of archivedFiles) {
    const id = fileIdToken(name);
    archivedById.set(id, [...(archivedById.get(id) ?? []), name]);
  }
  // Two files under one id INSIDE the archive is the same failure shape one
  // directory over: each looks correct alone, and a last-writer-wins map would
  // compare only one of them and report neither. Accumulating the list closes
  // that cell as a side effect of not overwriting.
  const archiveInternal = [...archivedById.entries()]
    .filter(([, names]) => names.length > 1)
    .map(
      ([id, names]) =>
        `${id} appears ${names.length} times inside ${ARCHIVE_TASKS_DIR}/: ${names.join(', ')} — ` +
        'the archive is meant to hold one file per id. Delete or renumber the duplicates.'
    );

  return archiveInternal.concat(
    liveFiles
      .map(name => ({ name, archived: archivedById.get(fileIdToken(name)) }))
      .filter((hit): hit is { name: string; archived: string[] } => hit.archived !== undefined)
      .map(
        hit =>
          `${fileIdToken(hit.name)} is BOTH live and archived: ${TRACKER_TASKS_DIR}/${hit.name} ` +
          // Prefixed PER FILE, not once before the join: every path in this
          // message has to be copy-pasteable, and an id with two archived
          // copies would otherwise print the second as a bare filename.
          `and ${hit.archived.map(name => `${ARCHIVE_TASKS_DIR}/${name}`).join(', ')} — ` +
          'the live copy answers every ' +
          'open-pool query, and every id lookup is ambiguous. If the live copy is a leftover ' +
          'from an archive move, delete it; if it is genuinely new work that was handed a ' +
          'recycled id (the allocator numbers from the live directory only), renumber it ' +
          '(file, `id:`, and `ordinal:`).'
      )
  );
}

/** Escape hatch for the legitimate-rename false positive; mirrors `--allow-stale-current`. */
export const ALLOW_ORIGIN_ID_COLLISION_ENV = 'TZUROT_ALLOW_ORIGIN_ID_COLLISION';

/**
 * A NEW local task file reusing an id that already exists on `origin/develop`
 * under a different filename — the collision caught at push time, before the
 * union ever lands.
 *
 * Asymmetric on purpose: the local id comes from frontmatter (authoritative,
 * already parsed), the origin id from the FILENAME prefix, because reading the
 * frontmatter of every origin file would cost one `git show` each.
 *
 * A deliberate RENAME of an existing task file lands in this same shape (the new
 * path is absent from origin while the id is present under the old name), and it
 * CANNOT be distinguished from a real collision by filenames alone. Because this
 * runs in `pnpm quality` locally and the CI lint job, an un-escapable hard-fail
 * would deadlock a rename branch (it can't merge until CI is green, and CI is
 * red because of the rename). So `runBacklogLint` honours the
 * `TZUROT_ALLOW_ORIGIN_ID_COLLISION` env var as the bypass, and the message
 * names it.
 *
 * COVERAGE VARIES WITH FETCH RECENCY: this compares against the local
 * `origin/develop` ref, not the true remote head. A same-id collision a teammate
 * pushed since the last `git fetch` is invisible until the next fetch — a
 * best-effort catch, not an authoritative gate (which is why the in-tree
 * `checkDuplicateTaskIds` stays the unconditional backstop for the merged case).
 * @internal Exported for testing
 */
export function checkOriginIdCollisions(tasks: TrackerTask[], origin: OriginTaskListing): string[] {
  if (!origin.resolvable) {
    return [];
  }
  const originPaths = new Set(origin.files);
  // Accumulate ALL origin paths per id, not last-write-wins: if origin/develop
  // already carries a pre-existing duplicate id (which checkDuplicateTaskIds
  // cannot see — it scans only the local tree), the message should name every
  // colliding origin file rather than silently understating the upstream state.
  const originById = new Map<string, string[]>();
  for (const path of origin.files) {
    const id = fileIdToken(path);
    const paths = originById.get(id) ?? [];
    paths.push(path);
    originById.set(id, paths);
  }

  return tasks
    .filter(task => !originPaths.has(task.file))
    .flatMap(task => {
      // onOrigin is drawn from origin.files; the filter above dropped every
      // task whose file is on origin, so a lookup hit here names a
      // different origin file, not this task's own path — which is why the
      // check does not re-compare against task.file.
      const onOrigin = originById.get(task.id.toLowerCase());
      if (onOrigin === undefined) {
        return [];
      }
      return [
        `${task.file}: id ${task.id} is already used on origin/develop by ${onOrigin.join(', ')} — ` +
          'the CLI allocates ids from the working tree, so a sibling branch can hand out the ' +
          'same one. Renumber this task (file, `id:`, and `ordinal:`), or — if the file was ' +
          `simply renamed — re-run with ${ALLOW_ORIGIN_ID_COLLISION_ENV}=1 to bypass.`,
      ];
    });
}

function reportProblems(problems: string[]): void {
  if (problems.length === 0) {
    console.log(
      chalk.green(
        '✓ Backlog layout in sync (caps respected, links resolve, tracker store parses, ' +
          'open tasks triaged, archive disjoint from the live pool)'
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
 * task, duplicated or origin-colliding task id, a task that is both live and
 * archived).
 */
export async function runBacklogLint(options: LintOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();

  // A task that failed to parse is already in `problems` and absent from
  // `tasks`, so the triage check never double-reports it.
  const { tasks, problems: trackerProblems } = loadTrackerTasks(rootDir);
  const origin = options.origin ?? readOriginTaskFiles(rootDir);
  // The bypass is honoured here, not inside the pure check, so the check stays
  // testable and the skip is announced. The in-tree duplicate check is NOT
  // bypassed — two local files sharing an id is unambiguous, never a rename.
  const bypassOriginCollision = process.env[ALLOW_ORIGIN_ID_COLLISION_ENV] === '1';
  const problems = [
    ...checkBacklogConfig(rootDir),
    ...checkNowCaps(rootDir),
    ...checkQueueDocRefs(rootDir),
    ...checkDocIdRefs(rootDir),
    ...checkRelativeLinks(rootDir),
    ...trackerProblems,
    ...checkTaskTriage(tasks),
    ...checkOwnerQueue(tasks),
    ...checkDuplicateTaskIds(tasks),
    ...checkArchiveIdConflicts(readLiveTaskFiles(rootDir), readArchivedTaskFiles(rootDir)),
    ...(bypassOriginCollision ? [] : checkOriginIdCollisions(tasks, origin)),
  ];
  if (bypassOriginCollision) {
    console.log(
      chalk.dim(
        `ℹ ${ALLOW_ORIGIN_ID_COLLISION_ENV}=1 — skipped the origin/develop id-collision check`
      )
    );
  }
  if (!origin.resolvable) {
    // Fail-open, and say so: a CI shallow clone legitimately lacks the ref, and
    // the in-tree duplicate check above still covers the merged case.
    console.log(
      chalk.dim(
        'ℹ origin/develop not resolvable — skipped the cross-branch task-id collision check'
      )
    );
  }
  reportProblems(problems);

  const trackerGitStatus = readTrackerGitStatus(rootDir);
  if (trackerGitStatus !== null) {
    const uncommitted = checkUncommittedTrackerFiles(trackerGitStatus);
    if (uncommitted.length > 0) {
      console.log(
        chalk.yellow(
          '⚠ Uncommitted tracker files — these are invisible to every query until committed:'
        )
      );
      for (const warning of uncommitted) {
        console.log(chalk.yellow(`   - ${warning}`));
      }
    }
  }

  if (problems.length > 0) {
    process.exitCode = 1;
  }
}
