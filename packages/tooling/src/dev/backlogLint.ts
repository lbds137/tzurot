/**
 * Backlog Lint
 *
 * Structural checks on the HOT/COLD backlog layout (see `.claude/rules/06-backlog.md`):
 *  - `now.md` section caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10
 *    (caps are parsed from the `(max N)` in each section heading).
 *  - `cold/queue.md` theme links all resolve to a real `cold/themes/<slug>.md`.
 *  - `cold/follow-ups.md`: surface the oldest rows as an AGING-ESCALATION nudge.
 *    Per the staleness principle ("aging escalates, never deletes"), this is
 *    informational — a prompt to decide on the oldest items, never a delete flag.
 *
 * Run via `pnpm ops backlog`. Exits non-zero on a STRUCTURAL problem (a cap
 * exceeded or a dangling theme link) so it can gate if wired into CI; the aging
 * surface never affects the exit code. This is a binary "is the layout in sync?"
 * check, NOT an audit-class tool — no baseline / WHY.md / canary
 * (see `.claude/rules/05-tooling.md` on the audit-class criteria).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

const DEFAULT_OLDEST_COUNT = 5;
const TITLE_PREVIEW_LENGTH = 80;

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
 * Extract `themes/<slug>.md` link targets from `queue.md`.
 * @internal Exported for testing
 */
export function extractThemeLinks(queueMd: string): string[] {
  const links: string[] = [];
  const pattern = /\]\(themes\/([\w.-]+\.md)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(queueMd)) !== null) {
    links.push(match[1]);
  }
  return links;
}

/**
 * The latest `YYYY-MM-DD` date mentioned in a row — its freshness anchor.
 * Returns null when a row carries no date (it has lost its anchor → treated
 * as oldest, so it surfaces for a decision).
 * @internal Exported for testing
 */
export function parseRowDate(row: string): string | null {
  const dates = row.match(/\d{4}-\d{2}-\d{2}/g);
  if (dates === null || dates.length === 0) {
    return null;
  }
  return [...dates].sort()[dates.length - 1];
}

/** @internal Exported for testing */
export interface FollowUpRow {
  title: string;
  date: string | null;
}

/**
 * Parse `follow-ups.md` table data rows into `{ title, date }`.
 * @internal Exported for testing
 */
export function parseFollowUpRows(md: string): FollowUpRow[] {
  const rows: FollowUpRow[] = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|') || /^\|\s*[-:]+\s*\|/.test(line) || /^\|\s*Item\s*\|/i.test(line)) {
      continue;
    }
    const title = line.split('|')[1]?.replace(/`/g, '').trim().slice(0, TITLE_PREVIEW_LENGTH);
    if (title === undefined || title.length === 0) {
      continue;
    }
    rows.push({ title, date: parseRowDate(line) });
  }
  return rows;
}

/**
 * Oldest-dated rows first; undated rows sort oldest (lost their anchor).
 * @internal Exported for testing
 */
export function oldestFollowUps(rows: FollowUpRow[], n: number): FollowUpRow[] {
  return [...rows]
    .sort((a, b) => (a.date ?? '0000-00-00').localeCompare(b.date ?? '0000-00-00'))
    .slice(0, n);
}

interface LintOptions {
  /** Repo root (defaults to cwd) */
  rootDir?: string;
  /** How many oldest follow-ups to surface */
  oldestCount?: number;
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

/** queue.md theme links that don't resolve to a real cold/themes/<slug>.md. */
function checkQueueLinks(rootDir: string): string[] {
  const queuePath = join(rootDir, 'backlog/cold/queue.md');
  if (!existsSync(queuePath)) {
    return [];
  }
  const themesDir = join(rootDir, 'backlog/cold/themes');
  const existing = existsSync(themesDir) ? new Set(readdirSync(themesDir)) : new Set<string>();
  return extractThemeLinks(readFileSync(queuePath, 'utf-8'))
    .filter(link => !existing.has(link))
    .map(link => `queue.md: dangling theme link → themes/${link} (file missing)`);
}

/** Oldest follow-ups for the aging-escalation nudge (informational). */
function loadOldestFollowUps(rootDir: string, n: number): FollowUpRow[] {
  const followPath = join(rootDir, 'backlog/cold/follow-ups.md');
  if (!existsSync(followPath)) {
    return [];
  }
  return oldestFollowUps(parseFollowUpRows(readFileSync(followPath, 'utf-8')), n);
}

function reportProblems(problems: string[]): void {
  if (problems.length === 0) {
    console.log(chalk.green('✓ Backlog layout in sync (caps respected, no dangling theme links)'));
    return;
  }
  console.log(chalk.red.bold('✖ Backlog structural problems:'));
  for (const problem of problems) {
    console.log(chalk.red(`   - ${problem}`));
  }
}

function reportOldest(oldest: FollowUpRow[]): void {
  if (oldest.length === 0) {
    return;
  }
  console.log('');
  console.log(chalk.yellow.bold("⏳ Oldest follow-ups (aging escalates — decide, don't delete):"));
  for (const row of oldest) {
    console.log(chalk.dim(`   • ${row.date ?? 'no-date'}  ${row.title}`));
  }
}

/**
 * CLI entry point. Sets a non-zero exit code on structural problems (cap
 * exceeded / dangling theme link); the aging surface is informational only.
 */
export async function runBacklogLint(options: LintOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  const oldestCount = options.oldestCount ?? DEFAULT_OLDEST_COUNT;

  const problems = [...checkNowCaps(rootDir), ...checkQueueLinks(rootDir)];
  reportProblems(problems);
  reportOldest(loadOldestFollowUps(rootDir, oldestCount));

  if (problems.length > 0) {
    process.exitCode = 1;
  }
}
