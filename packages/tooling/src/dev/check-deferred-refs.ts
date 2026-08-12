/**
 * Follow-ups Tripwire
 *
 * Many tracker tasks are annotated "opportunistic when next touching <file>" —
 * an annotation that only pays off if whoever is editing the file REMEMBERS
 * the task exists. In practice nobody queries a several-hundred-task store
 * before unrelated work, so tasks with concrete, cheap fix shapes sit for
 * months while the referenced files get edited around them.
 *
 * This tool makes those references structural: given a set of files (typically
 * the staged set at commit time), it scans the tracker store (`tracker/tasks/`)
 * for tasks whose text references any of them and prints the matches
 * INFORMATIONALLY. It never fails — this is a reminder surface, not a gate, so
 * a developer who decides "not this PR" loses nothing. Wired into
 * .husky/pre-commit (staged set) and .husky/pre-push (branch changed-set).
 *
 * Tasks with no file path in their text (the genuinely event-gated ones)
 * are invisible to this tool by design.
 *
 * (The exported symbols keep the `Deferred` name from the tool's
 * `deferred.md`-table era for test stability.)
 */

import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { loadTrackerTasks, openTasks, type TrackerTask } from './trackerTasks.js';

/** Max characters of the task title shown per match */
const TITLE_PREVIEW_LENGTH = 90;

/** @internal Exported for testing */
export interface DeferredRef {
  /** True when pathToken is a bare filename matched against basenames. */
  isBasename?: boolean;
  /** Normalized path token from the task text, e.g. 'services/x/src/y.ts' or 'services/x/' */
  pathToken: string;
  /** True when the token is a directory/glob prefix rather than an exact file */
  isPrefix: boolean;
  /** Task title (truncated) */
  title: string;
  /** Task id, e.g. 'TASK-210' */
  taskId: string;
  /** Task file path relative to the repo root */
  taskFile: string;
}

/** @internal Exported for testing */
export interface DeferredMatch {
  file: string;
  refs: DeferredRef[];
}

/**
 * Path-like tokens inside task prose: `services/...`, `packages/...`, or
 * `prisma/...` (schema + migration tasks reference it), optionally wrapped
 * in backticks, possibly carrying `:123`-style line refs or globs. Captured
 * liberally, then normalized.
 */
const PATH_TOKEN_PATTERN = /(?:services|packages|prisma)\/[\w.\-/*]+/g;

/**
 * Bare backticked filenames (`GenerationStep.ts`) — how most tasks reference
 * code. Extension required so bare identifiers/prose can't false-match;
 * backticks required so only deliberate code references count.
 */
const BASENAME_TOKEN_PATTERN = /`([A-Za-z][\w.-]*\.(?:ts|tsx|js|py|prisma|sql|ya?ml))`/g;

/**
 * Basenames too generic to identify a file — dozens of modules share these
 * names, so a basename match would false-positive on nearly every push and
 * train readers to ignore the output. Tasks referencing such files must use
 * the full path form to be matchable.
 */
const GENERIC_BASENAMES = new Set([
  'index.ts',
  'index.test.ts',
  'types.ts',
  'config.ts',
  'constants.ts',
  'utils.ts',
  'helpers.ts',
  'errors.ts',
  'schema.ts',
  'api.ts',
]);

/**
 * Normalize a raw path token from prose into a matchable form.
 * Returns null for tokens too short to be meaningful (bare 'services/x').
 */
/** @internal Exported for testing */
export function normalizePathToken(raw: string): { pathToken: string; isPrefix: boolean } | null {
  // Strip trailing punctuation that prose attaches (periods, commas, colons
  // with line numbers like `file.ts:231-234` keep only the path part).
  // Char-by-char trim instead of a `+$` quantifier — appeases the
  // regexp/no-super-linear-move ReDoS rule on prose-derived input.
  let token = raw.replace(/:[\d~,-]*$/, '');
  while (token.length > 0 && '.,;)'.includes(token[token.length - 1])) {
    token = token.slice(0, -1);
  }

  let isPrefix = false;
  const starIndex = token.indexOf('*');
  if (starIndex !== -1) {
    // Glob like services/voice-engine/*.py → prefix match on the static part
    token = token.slice(0, starIndex);
    isPrefix = true;
  }
  if (token.endsWith('/')) {
    isPrefix = true;
  }

  const segments = token.split('/').filter(s => s.length > 0);
  if (segments.length < 2) {
    return null;
  }

  // Extension-bearing tokens are exact files — 2 segments is enough
  // (`prisma/schema.prisma` is a real path at that depth).
  const last = segments[segments.length - 1];
  if (!isPrefix && last.includes('.')) {
    return { pathToken: token, isPrefix: false };
  }

  // Everything else is directory-ish. Globs and trailing slashes already
  // declared themselves prefixes; bare extension-less prose tokens need
  // group/package/sub depth so a passing mention of 'services/ai-worker'
  // doesn't become a match-everything prefix.
  if (!isPrefix) {
    if (segments.length < 3) {
      return null;
    }
    isPrefix = true;
    token = `${token}/`;
  }

  return { pathToken: token, isPrefix };
}

/**
 * Extract path-keyed references from a set of tracker tasks. Title and body
 * are scanned together — path mentions appear in both.
 * @internal Exported for testing
 */
export function extractDeferredRefs(tasks: TrackerTask[]): DeferredRef[] {
  const refs: DeferredRef[] = [];

  for (const task of tasks) {
    const text = `${task.title}\n${task.body}`;
    const title = task.title.slice(0, TITLE_PREVIEW_LENGTH);

    const seen = new Set<string>();
    for (const raw of text.match(PATH_TOKEN_PATTERN) ?? []) {
      const normalized = normalizePathToken(raw);
      if (normalized === null || seen.has(normalized.pathToken)) {
        continue;
      }
      seen.add(normalized.pathToken);
      refs.push({ ...normalized, title, taskId: task.id, taskFile: task.file });
    }
    collectBasenameRefs(text, seen, task, title, refs);
  }

  return refs;
}

/**
 * Collect bare-basename refs from a task, skipping generic names and any
 * basename already covered by a full-path ref on the same task (the path form
 * is stricter and should win).
 */
function collectBasenameRefs(
  text: string,
  seen: Set<string>,
  task: TrackerTask,
  title: string,
  refs: DeferredRef[]
): void {
  for (const match of text.matchAll(BASENAME_TOKEN_PATTERN)) {
    const basename = match[1];
    if (GENERIC_BASENAMES.has(basename) || seen.has(basename)) {
      continue;
    }
    if ([...seen].some(t => t.endsWith(`/${basename}`))) {
      continue;
    }
    seen.add(basename);
    refs.push({
      pathToken: basename,
      isPrefix: false,
      isBasename: true,
      title,
      taskId: task.id,
      taskFile: task.file,
    });
  }
}

/**
 * Match a set of files against the parsed references.
 */
/** @internal Exported for testing */
export function matchFiles(files: string[], refs: DeferredRef[]): DeferredMatch[] {
  const matches: DeferredMatch[] = [];

  for (const file of files) {
    const hits = refs.filter(ref => {
      if (ref.isBasename === true) {
        return file.endsWith(`/${ref.pathToken}`) || file === ref.pathToken;
      }
      return ref.isPrefix ? file.startsWith(ref.pathToken) : file === ref.pathToken;
    });
    if (hits.length > 0) {
      matches.push({ file, refs: hits });
    }
  }

  return matches;
}

/**
 * Bound on the staged-file read. This tool is wired into pre-commit and
 * pre-push and is informational-only — the outer `checkDeferredRefs` catch
 * already treats any failure as "skip the reminder", so a bounded stall
 * degrades into that same silent skip instead of hanging the hook.
 */
export const DEFERRED_REFS_TIMEOUT_MS = 15_000;

/** Resolve the staged file list from git */
function getStagedFiles(): string[] {
  const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
    encoding: 'utf-8',
    timeout: DEFERRED_REFS_TIMEOUT_MS,
  });
  return output.split('\n').filter(line => line.length > 0);
}

interface CheckOptions {
  /** Read the file list from git's staged set */
  staged?: boolean;
  /** Explicit file list (used when staged is false) */
  files?: string[];
}

/**
 * CLI entry point. ALWAYS exits 0 — informational, never a gate. The
 * catch-all makes that contract hold even when git or the filesystem
 * misbehaves: errors are logged to stderr and swallowed, because a broken
 * reminder tool must never break a commit or a script that calls it.
 */
export async function checkDeferredRefs(options: CheckOptions = {}): Promise<void> {
  try {
    const files = options.staged === true ? getStagedFiles() : (options.files ?? []);
    if (files.length === 0) {
      return;
    }

    // Unparseable task files are the lint's problem, not this reminder's —
    // skip them silently here.
    const { tasks } = loadTrackerTasks(process.cwd());
    const refs = extractDeferredRefs(openTasks(tasks));
    const matches = matchFiles(files, refs);
    if (matches.length === 0) {
      return;
    }

    console.log('');
    console.log(chalk.yellow.bold('📌 Backlog tasks reference files in this change:'));
    for (const match of matches) {
      console.log(chalk.white(`   ${match.file}`));
      for (const ref of match.refs) {
        console.log(chalk.dim(`     • ${ref.taskId}  ${ref.title} (${ref.taskFile})`));
      }
    }
    console.log(chalk.dim('   Reminder only — fold one in if it fits, or carry on. Never blocks.'));
    console.log('');
  } catch (error) {
    console.error(
      chalk.dim(
        `follow-up-refs check skipped (${error instanceof Error ? error.message : String(error)})`
      )
    );
  }
}
