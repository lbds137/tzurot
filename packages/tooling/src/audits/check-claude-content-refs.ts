/**
 * Claude Content Reference Check
 *
 * Walks `.claude/rules/*.md` and `.claude/skills/*\/SKILL.md` and validates
 * the `pnpm ops <command>` references they contain. Hard-fails CI when a
 * referenced command doesn't exist in the actual `pnpm ops` registry.
 *
 * Also emits a warning (not a hard fail) for files whose `lastUpdated`
 * frontmatter is older than `STALE_THRESHOLD_DAYS`.
 *
 * Why this exists: rule/skill files are markdown procedures consumed by
 * LLMs and humans. They reference `pnpm ops` commands that may be renamed
 * or removed without the markdown reference being updated. The pattern
 * mirrors `guard:proposal-links` and `guard:audit-tool-docs`: structural
 * enforcement that the documented system matches the actual system.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { emitSummary } from './summary.js';

/**
 * Threshold beyond which a file's `lastUpdated` frontmatter triggers a
 * staleness warning (NOT a hard fail). 180 days = ~6 months: long enough
 * that genuinely stable docs don't get flagged, short enough that drift
 * is caught before the next release cycle.
 */
const STALE_THRESHOLD_DAYS = 180;

/** Directories to scan, relative to the repo root. */
const SCAN_DIRS = ['.claude/rules', '.claude/skills'];

export interface DanglingCommandRef {
  file: string;
  command: string;
  /** Line number (1-indexed) where this command reference appears. Each occurrence is a separate `DanglingCommandRef`. */
  line: number;
}

export interface StaleEntry {
  file: string;
  lastUpdated: string;
  ageDays: number;
}

export interface ContentRefsCheckResult {
  /** Total markdown files scanned. */
  totalFiles: number;
  /** References to `pnpm ops <cmd>` where <cmd> is not a registered command. */
  danglingRefs: DanglingCommandRef[];
  /** Files whose `lastUpdated` frontmatter exceeds the staleness threshold. */
  stale: StaleEntry[];
}

/**
 * Extract dangling `pnpm ops <command>` references from a file's content.
 * Stops at the FIRST non-command character; uses negative-lookahead to
 * rule out documentation shorthand (`pnpm ops db:*` wildcard, `pnpm ops
 * db:safe-migrate --name <name>` placeholder syntax). Real command refs
 * never end in `:` — the trailing-colon strip handles cases where the
 * regex greedily included it.
 */
function extractDanglingRefs(
  file: string,
  content: string,
  validCommands: ReadonlySet<string>
): DanglingCommandRef[] {
  const refs: DanglingCommandRef[] = [];
  // `matchAll` returns a fresh iterator per call with its own
  // `lastIndex` state — eliminates the manual-reset pattern that
  // the earlier `exec`-based implementation needed between lines.
  const commandRegex = /(?:^|[^\w-])pnpm ops ([a-z][a-z0-9:-]+)(?![*<]|:[^a-z])/g;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const match of lines[i].matchAll(commandRegex)) {
      const cmd = match[1];
      if (cmd.endsWith(':')) continue; // wildcard/prose, not a real ref
      if (!validCommands.has(cmd)) {
        refs.push({ file, command: cmd, line: i + 1 });
      }
    }
  }
  return refs;
}

/**
 * Extract a staleness entry from a file's frontmatter if its
 * `lastUpdated` exceeds the threshold. Returns null when the file
 * either lacks the field or is within the threshold.
 */
function extractStaleEntry(file: string, content: string, now: Date): StaleEntry | null {
  const lastUpdatedMatch = /^lastUpdated:\s*['"](\d{4}-\d{2}-\d{2})['"]/m.exec(content);
  if (lastUpdatedMatch === null) return null;
  const captured = new Date(lastUpdatedMatch[1]);
  const ageMs = now.getTime() - captured.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  if (ageDays <= STALE_THRESHOLD_DAYS) return null;
  return { file, lastUpdated: lastUpdatedMatch[1], ageDays };
}

/**
 * Returns the set of `pnpm ops <command>` references found in markdown
 * files under the scan roots. Exported for testing.
 */
export function findContentRefs(
  repoRoot: string,
  validCommands: ReadonlySet<string>,
  scanDirs: readonly string[] = SCAN_DIRS,
  now: Date = new Date()
): ContentRefsCheckResult {
  const files = collectMarkdownFiles(repoRoot, scanDirs);
  const danglingRefs: DanglingCommandRef[] = [];
  const stale: StaleEntry[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(repoRoot, file), 'utf-8');
    } catch {
      continue;
    }
    danglingRefs.push(...extractDanglingRefs(file, content, validCommands));
    const staleEntry = extractStaleEntry(file, content, now);
    if (staleEntry !== null) stale.push(staleEntry);
  }

  return { totalFiles: files.length, danglingRefs, stale };
}

/**
 * Collect all markdown files under the scan roots, repo-relative paths.
 */
function collectMarkdownFiles(repoRoot: string, scanDirs: readonly string[]): string[] {
  const results: string[] = [];
  for (const dir of scanDirs) {
    const full = join(repoRoot, dir);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    walkDir(full, repoRoot, results);
  }
  return results;
}

/**
 * Recursively walk `dir`, collecting markdown files that match the
 * project's rule/skill conventions:
 *
 * - `.claude/rules/*.md` — any markdown file at the rules level
 * - `.claude/skills/<name>/SKILL.md` — only the named SKILL.md per skill,
 *   NOT auxiliary markdown that might live alongside (e.g., a future
 *   `NOTES.md` for internal session state should not be audited)
 *
 * The shape-based gate keeps the audit focused on load-bearing
 * procedural docs and avoids scanning incidental markdown that
 * happens to live under the scan roots.
 */
function walkDir(dir: string, repoRoot: string, results: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, repoRoot, results);
    } else if (entry.isFile() && isScannable(full, entry.name)) {
      results.push(relative(repoRoot, full));
    }
  }
}

/**
 * Decide whether a markdown file at `fullPath` (basename `name`) should
 * be audited. Encodes the rule/skill conventions described in
 * `walkDir`'s docstring.
 */
function isScannable(fullPath: string, name: string): boolean {
  if (!name.endsWith('.md')) return false;
  // Rules: any .md under .claude/rules/ is in scope
  if (fullPath.includes('.claude/rules/') || fullPath.includes('.claude\\rules\\')) {
    return true;
  }
  // Skills: only SKILL.md is in scope
  if (fullPath.includes('.claude/skills/') || fullPath.includes('.claude\\skills\\')) {
    return name === 'SKILL.md';
  }
  // Outside the known conventions (e.g., canary fixtures passing a
  // synthetic scanDir): accept all .md to preserve test flexibility.
  // Callers passing custom `scanDirs` own their own scope — the
  // fallthrough accepts everything because we have no convention
  // to enforce against arbitrary roots.
  return true;
}

/**
 * Parse the output of `pnpm ops --help` into the set of registered
 * command names. The CAC help format lists commands as
 * `  <command-name>[ args...]   description...` — we extract the first
 * whitespace-delimited token after the leading indent.
 *
 * Exported for testing.
 */
export function parseRegisteredCommands(helpOutput: string): Set<string> {
  const commands = new Set<string>();
  // Match lines like `  db:status                Description...`
  // The 2-space leading indent + command-name format is consistent across
  // CAC output. Commands always start with a letter; args/options start
  // with `<` or `[` which we'll allow trailing whitespace before.
  const commandLineRegex = /^ {2}([a-z][a-z0-9:-]+)(?=\s|$)/;
  for (const line of helpOutput.split('\n')) {
    const match = commandLineRegex.exec(line);
    if (match !== null) {
      commands.add(match[1]);
    }
  }
  return commands;
}

/**
 * Fetch the registered command set by invoking `pnpm ops --help` and
 * parsing the output. Spawns the actual CLI so the audit catches the
 * same commands `pnpm ops` would surface in interactive use.
 */
function fetchRegisteredCommands(repoRoot: string): Set<string> {
  let output: string;
  try {
    output = execFileSync('pnpm', ['ops', '--help'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // pnpm ops --help may exit non-zero on the unsupported-engine warning,
    // but stdout still has the help text. execFileSync surfaces stdout
    // on the error object in that case.
    //
    // Defensive check: require non-empty stdout. If pnpm itself fails to
    // start (missing dependency, broken install) and produces no output,
    // parseRegisteredCommands('') returns an empty set — and every
    // pnpm ops reference looks dangling, masking the real cause behind
    // a confusing avalanche of false-positive findings. Throw with the
    // original error attached so the failure is attributable.
    const rawStdout = (err as { stdout?: unknown }).stdout;
    if (typeof rawStdout === 'string' && rawStdout.length > 0) {
      output = rawStdout;
    } else {
      throw new Error('Failed to fetch pnpm ops command list', { cause: err });
    }
  }
  return parseRegisteredCommands(output);
}

export interface CheckClaudeContentRefsOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  repoRoot?: string;
  /** Output only the JSONL audit-summary line (for the audit-aggregator). */
  summary?: boolean;
  /**
   * @internal Canary-test seam.
   *
   * Override the set of valid commands. Canary tests pass an explicit
   * set so the check runs against fixture data without depending on
   * `pnpm ops --help` being available. Production callers should omit.
   */
  validCommands?: ReadonlySet<string>;
  /**
   * @internal Canary-test seam.
   *
   * Override the directories scanned. Production callers should omit
   * (defaults to `.claude/rules` and `.claude/skills`).
   */
  scanDirs?: readonly string[];
}

/**
 * CLI entry point. Prints findings in human-readable form (or JSONL
 * summary line in `--summary` mode) and exits non-zero on dangling
 * command refs. Stale `lastUpdated` is a WARNING only — surfaced in
 * output but doesn't fail CI.
 */
export async function checkClaudeContentRefs(
  options: CheckClaudeContentRefsOptions = {}
): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const validCommands = options.validCommands ?? fetchRegisteredCommands(repoRoot);
  const { totalFiles, danglingRefs, stale } = findContentRefs(
    repoRoot,
    validCommands,
    options.scanDirs
  );

  if (options.summary) {
    // `findings` counts only the hard-fail dangling-command refs.
    // Staleness is informational and doesn't gate; aggregator sees it
    // as a separate observability signal in future versions.
    emitSummary({
      tool: 'guard:claude-content-refs',
      status: danglingRefs.length > 0 ? 'fail' : 'ok',
      findings: danglingRefs.length,
      baseline: 0,
    });
    if (danglingRefs.length > 0) {
      process.exit(1);
    }
    return;
  }

  console.log(`\n🔍 Checking ${totalFiles} rule/skill files for command references...\n`);

  if (danglingRefs.length === 0 && stale.length === 0) {
    console.log(`✅ All ${totalFiles} files reference valid commands.`);
    console.log(`   No files exceed the ${STALE_THRESHOLD_DAYS}-day staleness threshold.\n`);
    return;
  }

  if (danglingRefs.length > 0) {
    console.log(`❌ Found ${danglingRefs.length} dangling command reference(s):\n`);
    for (const ref of danglingRefs) {
      console.log(`   ${ref.file}:${ref.line}  → \`pnpm ops ${ref.command}\` (not registered)`);
    }
    console.log();
  }

  if (stale.length > 0) {
    console.log(
      `⚠️  Found ${stale.length} file(s) with stale \`lastUpdated\` (> ${STALE_THRESHOLD_DAYS} days):\n`
    );
    for (const entry of stale) {
      console.log(
        `   ${entry.file}  (lastUpdated: ${entry.lastUpdated}, ${entry.ageDays} days ago)`
      );
    }
    console.log();
  }

  if (danglingRefs.length > 0) {
    console.log(`Dangling command references break the documented system → actual system contract.
Fix one of:
  - Update the markdown to reference an existing command
  - Rename the command in source (and re-run \`pnpm ops --help\` to verify)
  - Delete the obsolete documentation if the workflow no longer applies
`);
    process.exit(1);
  }

  // Staleness alone doesn't gate — exit 0 with the warning surfaced.
  console.log(
    `Stale \`lastUpdated\` is a warning, not a hard fail. Review the listed files; ` +
      `edit them (the pre-commit hook will bump \`lastUpdated\` to today) or accept ` +
      `the staleness if the content is genuinely stable.\n`
  );
}
