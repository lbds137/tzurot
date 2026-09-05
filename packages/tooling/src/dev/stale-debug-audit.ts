/**
 * Stale-Debug Audit
 *
 * Finds `debug`-typed commits (the temporary-diagnostic commit type — see
 * `.claude/rules/05-tooling.md` § "The `debug` type") whose added lines are
 * STILL LIVE in the current tree past an age threshold. A merge-time gate
 * structurally cannot catch this class: debug commits are supposed to merge
 * temporarily, so intentional-temporary and forgotten look identical at merge
 * time. Age of the surviving scaffolding is the only signal that separates
 * them — that makes this a periodic audit, not a CI gate.
 *
 * Detection is blame-based: for every file a debug commit touched, `git blame`
 * at HEAD reports which commit introduced each surviving line. A debug commit
 * whose SHA still owns lines has live scaffolding; one that only removed
 * lines (the `remove` half of an add/remove pair) owns nothing and never
 * flags. Rebase-merged history keeps blame SHAs identical to log SHAs, which
 * is what makes this exact rather than heuristic on this repo.
 */

import { execFileSync } from 'node:child_process';
import { emitSummary } from '../audits/summary.js';

/**
 * Age at which surviving debug scaffolding becomes a hard finding. The
 * debug type's lifecycle is add → diagnose (days) → remove in a cleanup PR;
 * prod diagnostic cycles here run under two weeks. Younger survivors are
 * reported as warnings (active investigations), older ones fail.
 */
export const STALE_DEBUG_MAX_AGE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The grep anchored to conventional `debug:` / `debug(scope):` subjects. */
const DEBUG_SUBJECT_GREP = '^debug[:(]';

export type GitRunner = (args: string[]) => string;

export interface LiveDebugCommit {
  sha: string;
  subject: string;
  /** Commit time in epoch ms. */
  committedAtMs: number;
  ageDays: number;
  /** True when ageDays exceeds the threshold — a hard finding. */
  stale: boolean;
  /** Files (repo-relative) where this commit still owns lines, with counts. */
  survivingFiles: { file: string; lines: number }[];
}

export interface StaleDebugResult {
  /** Every debug-typed commit found in history (live or not). */
  totalDebugCommits: number;
  /** Commits whose added lines survive at HEAD, oldest first. */
  liveCommits: LiveDebugCommit[];
  /** `Retires-debug` trailer values that resolved to no debug commit. */
  ignoredRetireValues: string[];
  status: 'ok' | 'warn' | 'fail';
}

export interface StaleDebugOptions {
  repoRoot?: string;
  maxAgeDays?: number;
  /** Injection seam for tests; production uses execFileSync('git', ...). */
  runGit?: GitRunner;
  /** Injection seam for tests; production uses Date.now(). */
  nowMs?: number;
}

function defaultGitRunner(repoRoot: string): GitRunner {
  return (args: string[]): string =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf-8',
      // Blame over a large history can exceed the 1MB default.
      maxBuffer: 64 * 1024 * 1024,
      // Capture stderr instead of inheriting it: blame on files deleted since
      // a debug commit touched them fails EXPECTEDLY (caught upstream), and
      // inherited "fatal: no such path" noise would drown the report.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/**
 * Parse `git log --format=%H|%ct|%s` output, keeping only commits whose
 * SUBJECT matches the debug convention. `git log --grep` matches every line
 * of the message (a body quoting another `debug:` commit false-matches), so
 * the grep is only a server-side prefilter — the subject anchor here is the
 * real gate.
 */
function parseDebugLog(raw: string): { sha: string; committedAtMs: number; subject: string }[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [sha, epochSeconds, ...subjectParts] = line.split('|');
      return {
        sha,
        committedAtMs: Number(epochSeconds) * 1000,
        subject: subjectParts.join('|'),
      };
    })
    .filter(commit => /^debug[:(]/.test(commit.subject));
}

/** Commit trailer by which a human declares a debug commit's scaffolding retired. */
const RETIRES_DEBUG_TRAILER = 'Retires-debug';

/** A trailer value that can name a commit: a bare 7-40 char hex prefix. */
const RETIRES_DEBUG_VALUE = /^[0-9a-f]{7,40}$/i;

/**
 * Collect every `Retires-debug` trailer value in history.
 *
 * The placeholder was probed against the installed git: a present key renders
 * its value, an absent key renders empty. The MULTI-value join is deliberately
 * not relied on — it was not probed — so this splits the whole output on any
 * whitespace instead. A retirement value is a bare hex token by construction,
 * so whitespace splitting recovers every value whether git joins two of them
 * with the separator, with a newline, or emits them on separate lines. Commas
 * are accepted as separators too, so a hand-typed `sha1, sha2` list resolves
 * both values instead of leaving a trailing comma on the first.
 */
function parseRetireTrailers(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(token => token.length > 0);
}

/**
 * True for a line that cannot itself carry instrumentation: a comment line, a
 * closer-only line (`}`, `});`, `);`, `],`), or a single-line import.
 *
 * Instrumentation is a statement. A surviving import with no surviving call
 * site fails lint as unused; a surviving comment or closing brace executes
 * nothing. Neither can be live scaffolding on its own, so counting them makes
 * a fix commit that absorbed a probe's imports and doc-comment structure flag
 * forever. This drops ONLY lines that cannot execute — a multi-line call whose
 * argument lines are identifiers still counts. `export` is deliberately absent:
 * an export can carry a statement.
 *
 * Pinned by the 'ignores surviving comment, closer, and import lines',
 * 'still counts a surviving statement among structural lines',
 * 'does not treat an export line as structural', and 'does not mistake an
 * identifier starting with "import" for an import block' cases in
 * stale-debug-audit.test.ts.
 */
function isStructuralLine(trimmed: string): boolean {
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    return true;
  }
  if (/^[\])};,]+$/.test(trimmed)) {
    return true;
  }
  return /^import[\s{]/.test(trimmed);
}

/**
 * Count surviving lines per owning SHA token for one file at HEAD.
 * `git blame -l -s` prefixes each line with the 40-char SHA — EXCEPT
 * boundary commits, where a `^` replaces the first column and the SHA is
 * truncated to 39 chars to keep the width. Tokens are therefore matched by
 * prefix against full SHAs, not by equality.
 *
 * Ownership counts STATEMENT lines only: blank, comment, closer-only, and
 * import lines are skipped (see `isStructuralLine`), so a fix commit that
 * absorbed a probe's scaffolding does not flag forever.
 */
function blameOwnership(runGit: GitRunner, file: string): Map<string, number> {
  const ownership = new Map<string, number>();
  const raw = runGit(['blame', '-l', '-s', 'HEAD', '--', file]);
  let inImportBlock = false;
  for (const line of raw.split('\n')) {
    const match = /^\^?([0-9a-f]{7,40})\s+\d+\)(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const trimmed = match[2].trim();
    // A surviving BLANK line is not scaffolding — blame attributes blanks to
    // whoever introduced them, and an otherwise-complete removal that leaves
    // one behind would flag forever (permanent false positive).
    if (trimmed.length === 0) {
      continue;
    }
    if (inImportBlock) {
      // Member lines of a multi-line import, and the `} from '…';` line that
      // closes it, are skipped with the block itself.
      if (trimmed.includes(' from ')) {
        inImportBlock = false;
      }
      continue;
    }
    // An import KEYWORD that names no source yet opens a multi-line block. The
    // `[\s{]` matters: a bare prefix test also fires on an identifier such as
    // `importedCount = compute(`, which would swallow every following line. A
    // trailing `;` means a complete side-effect import, not a block opener.
    if (/^import[\s{]/.test(trimmed) && !trimmed.includes(' from ') && !trimmed.endsWith(';')) {
      inImportBlock = true;
      continue;
    }
    if (isStructuralLine(trimmed)) {
      continue;
    }
    ownership.set(match[1], (ownership.get(match[1]) ?? 0) + 1);
  }
  return ownership;
}

/** Parse `git diff-tree --numstat` output into totals + touched files. */
function parseNumstat(raw: string): { added: number; deleted: number; files: string[] } {
  let added = 0;
  let deleted = 0;
  const files: string[] = [];
  for (const line of raw.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) {
      continue;
    }
    // Binary files report '-'; count them as neither.
    added += Number.isNaN(Number(parts[0])) ? 0 : Number(parts[0]);
    deleted += Number.isNaN(Number(parts[1])) ? 0 : Number(parts[1]);
    const file = parts.slice(2).join('\t').trim();
    if (file.length > 0) {
      files.push(file);
    }
  }
  return { added, deleted, files };
}

/**
 * Filter OUT net-DELETING commits and collect the union of files the rest
 * touched. A `debug:` REMOVE commit legitimately owns residue at HEAD
 * (reflowed call sites, a comment whose neighbor changed) — flagging those is
 * a permanent false positive that trains report-muting. Net direction
 * separates the two without a fragile subject-wordlist; numstat gives the
 * file list and the totals in one call.
 */
function selectAddingCommits(
  runGit: GitRunner,
  commits: { sha: string }[]
): { addingShas: Set<string>; touchedFiles: Set<string> } {
  const addingShas = new Set<string>();
  const touchedFiles = new Set<string>();
  for (const commit of commits) {
    const numstat = parseNumstat(
      runGit([
        'diff-tree',
        '--no-commit-id',
        '--numstat',
        '-r',
        // Pinned against ambient git config, not left to the environment's
        // defaults: with diff.renames=true a renaming debug commit emits a
        // rename-descriptor path ("{old => new}.ts") that later blame calls
        // then fail on, and isMissingPathError silently swallows that as "no
        // surviving lines" — a false negative. --root guards the theoretical
        // parentless-commit case: without it a root commit diffs as empty
        // against no parent, which would also read as no surviving lines.
        '--no-renames',
        '--root',
        commit.sha,
      ])
    );
    // >= not >: a probe inserted by REPLACING a line (1 del + 1 add) is
    // net-zero, and excluding it would hide that scaffolding from
    // survivorship tracking forever — the exact false-negative class this
    // tool exists to close. The cost is that a rare net-zero REMOVE commit
    // owning residue flags once and gets human-triaged; visibility wins.
    // (A merge commit whose subject matches the grep also passes — diff-tree
    // without -m reports no files for merges, so 0 >= 0 admits it with an
    // empty file set; it can never own survivors, and that is fine.)
    if (numstat.added >= numstat.deleted) {
      addingShas.add(commit.sha);
      for (const file of numstat.files) {
        touchedFiles.add(file);
      }
    }
  }
  return { addingShas, touchedFiles };
}

/**
 * The one blame failure allowed to mean "no surviving lines": the file no
 * longer exists at HEAD. execFileSync surfaces git's stderr on the error
 * object (and test runners throw plain Errors), so check both message and
 * stderr for git's `fatal: no such path` / `no such ref` shapes.
 */
function isMissingPathError(error: unknown): boolean {
  const err = error as { message?: string; stderr?: unknown };
  const stderrText =
    typeof err.stderr === 'string'
      ? err.stderr
      : Buffer.isBuffer(err.stderr)
        ? err.stderr.toString('utf-8')
        : '';
  const text = `${err.message ?? ''}\n${stderrText}`;
  return /no such (path|ref)/i.test(text);
}

/**
 * Resolve a possibly-abbreviated token to a full SHA from a known set.
 * Blame tokens are boundary-truncated to 39 chars and trailer values are
 * hand-typed prefixes, so both resolve by prefix rather than equality.
 */
function resolveShaByPrefix(shas: Set<string>, token: string): string | undefined {
  for (const sha of shas) {
    if (sha.startsWith(token)) {
      return sha;
    }
  }
  return undefined;
}

/**
 * Split trailer values into the debug SHAs they retire and the values that
 * named nothing. An unresolvable value is inert rather than fatal — but it is
 * REPORTED, so a typo'd SHA is visible instead of silently retiring nothing.
 * Pinned by 'reports a trailer naming a non-debug commit as ignored' in
 * stale-debug-audit.test.ts.
 */
function resolveRetirements(
  debugShas: Set<string>,
  tokens: string[]
): { retiredShas: Set<string>; ignoredValues: string[] } {
  const retiredShas = new Set<string>();
  const ignoredValues: string[] = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    const sha = RETIRES_DEBUG_VALUE.test(normalized)
      ? resolveShaByPrefix(debugShas, normalized)
      : undefined;
    if (sha === undefined) {
      ignoredValues.push(token);
      continue;
    }
    retiredShas.add(sha);
  }
  return { retiredShas, ignoredValues };
}

/**
 * Blame every touched file once and invert the ownership: which debug SHAs
 * still own lines at HEAD, and where. Files deleted (or renamed away) at
 * HEAD have no surviving lines by definition — blame throws for them and the
 * catch skips. Blame tokens can be boundary-truncated (39 chars), so they
 * resolve by prefix against the full SHAs.
 */
function collectSurvivors(
  runGit: GitRunner,
  touchedFiles: Set<string>,
  debugShas: Set<string>
): Map<string, { file: string; lines: number }[]> {
  const survivorsBySha = new Map<string, { file: string; lines: number }[]>();
  for (const file of touchedFiles) {
    let ownership: Map<string, number>;
    try {
      ownership = blameOwnership(runGit, file);
    } catch (error) {
      // Only the EXPECTED failure (file deleted/renamed away at HEAD) may
      // degrade to "no surviving lines". Anything else — corrupted pack,
      // permission error, git quirk — must surface as a broken run, per the
      // same refuse-don't-false-green stance as the shallow-clone guard.
      if (isMissingPathError(error)) {
        continue;
      }
      throw error;
    }
    for (const [token, lines] of ownership) {
      const sha = resolveShaByPrefix(debugShas, token);
      if (sha === undefined) {
        continue;
      }
      const entry = survivorsBySha.get(sha) ?? [];
      entry.push({ file, lines });
      survivorsBySha.set(sha, entry);
    }
  }
  return survivorsBySha;
}

/**
 * Core measurement — pure given an injected git runner and clock.
 */
export function findStaleDebugCommits(options: StaleDebugOptions = {}): StaleDebugResult {
  const repoRoot = options.repoRoot ?? process.cwd();
  const maxAgeDays = options.maxAgeDays ?? STALE_DEBUG_MAX_AGE_DAYS;
  const runGit = options.runGit ?? defaultGitRunner(repoRoot);
  const nowMs = options.nowMs ?? Date.now();

  // A NaN threshold (typo'd --max-age-days flag) would make every ageDays
  // comparison false and silently disable the fail path — reject it loudly.
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new Error(
      `dev:stale-debug: maxAgeDays must be a non-negative number, got '${String(maxAgeDays)}'`
    );
  }

  // A shallow clone truncates the very history this tool measures — a run
  // there would report "ok" while seeing nothing, which is the silent-tool-rot
  // failure mode the audit system exists to catch. Fail loud instead.
  if (runGit(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error(
      'dev:stale-debug requires full git history (shallow clone detected). ' +
        'Fetch with depth 0 (e.g. actions/checkout fetch-depth: 0) before running.'
    );
  }

  const logRaw = runGit(['log', `--grep=${DEBUG_SUBJECT_GREP}`, '--format=%H|%ct|%s', 'HEAD']);
  const debugCommits = parseDebugLog(logRaw);

  // An explicit retirement declaration excludes a debug commit from the
  // surviving-lines check entirely; it still counts toward the history total.
  const trailerRaw = runGit([
    'log',
    `--format=%(trailers:key=${RETIRES_DEBUG_TRAILER},valueonly,separator=%x20)`,
    'HEAD',
  ]);
  const { retiredShas, ignoredValues } = resolveRetirements(
    new Set(debugCommits.map(c => c.sha)),
    parseRetireTrailers(trailerRaw)
  );

  if (debugCommits.length === 0) {
    return {
      totalDebugCommits: 0,
      liveCommits: [],
      ignoredRetireValues: ignoredValues,
      status: 'ok',
    };
  }

  const trackedCommits = debugCommits.filter(c => !retiredShas.has(c.sha));
  const { addingShas, touchedFiles } = selectAddingCommits(runGit, trackedCommits);
  const survivorsBySha = collectSurvivors(runGit, touchedFiles, addingShas);

  const liveCommits: LiveDebugCommit[] = trackedCommits
    .filter(c => survivorsBySha.has(c.sha))
    .map(c => {
      const ageDays = Math.floor((nowMs - c.committedAtMs) / MS_PER_DAY);
      return {
        sha: c.sha,
        subject: c.subject,
        committedAtMs: c.committedAtMs,
        ageDays,
        stale: ageDays > maxAgeDays,
        survivingFiles: (survivorsBySha.get(c.sha) ?? []).sort((a, b) => b.lines - a.lines),
      };
    })
    .sort((a, b) => a.committedAtMs - b.committedAtMs);

  const anyStale = liveCommits.some(c => c.stale);
  return {
    totalDebugCommits: debugCommits.length,
    liveCommits,
    ignoredRetireValues: ignoredValues,
    status: anyStale ? 'fail' : liveCommits.length > 0 ? 'warn' : 'ok',
  };
}

export interface StaleDebugCliOptions extends StaleDebugOptions {
  summary?: boolean;
  /** Return instead of setting a nonzero exit code (canary/test usage). */
  noFail?: boolean;
}

/**
 * Print the human-readable findings block: either the all-clear line, or one
 * stanza per live debug commit followed by the remove-it hint when any of them
 * is past the age threshold.
 */
function reportLiveCommits(result: StaleDebugResult, maxAgeDays: number): void {
  if (result.liveCommits.length === 0) {
    console.log(
      `✅ No live debug scaffolding (${result.totalDebugCommits} debug commits in history, all fully removed)`
    );
    return;
  }
  console.log(
    `Found ${result.liveCommits.length} debug commit(s) with surviving lines ` +
      `(${result.totalDebugCommits} total in history; stale threshold ${maxAgeDays}d):\n`
  );
  for (const commit of result.liveCommits) {
    const marker = commit.stale ? '❌ STALE' : '⚠️  live';
    console.log(`${marker}  ${commit.sha.slice(0, 9)}  ${commit.ageDays}d  ${commit.subject}`);
    for (const { file, lines } of commit.survivingFiles) {
      console.log(`           ${lines} line(s) still in ${file}`);
    }
  }
  if (result.status === 'fail') {
    console.log(
      `\nScaffolding older than ${maxAgeDays}d is presumed forgotten — remove it with a ` +
        `\`debug(<scope>): remove …\` commit, or re-justify it in place.`
    );
  }
}

/** CLI wrapper: human report, optional JSONL summary line, exit-code contract. */
export function runStaleDebugAudit(options: StaleDebugCliOptions = {}): StaleDebugResult {
  const maxAgeDays = options.maxAgeDays ?? STALE_DEBUG_MAX_AGE_DAYS;
  const result = findStaleDebugCommits(options);

  reportLiveCommits(result, maxAgeDays);

  for (const value of result.ignoredRetireValues) {
    console.log(`ignored ${RETIRES_DEBUG_TRAILER} value "${value}": not a debug commit`);
  }

  if (options.summary === true) {
    emitSummary({
      tool: 'dev:stale-debug',
      status: result.status,
      findings: result.liveCommits.length,
      baseline: 0,
    });
  }

  if (result.status === 'fail' && options.noFail !== true) {
    process.exitCode = 1;
  }
  return result;
}
