/**
 * Backlog Lint
 *
 * Structural checks on the HOT/COLD backlog layout (see `.claude/rules/06-backlog.md`):
 *  - `now.md` section caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10
 *    (caps are parsed from the `(max N)` in each section heading).
 *  - `cold/queue.md` theme links all resolve to a real `cold/themes/<slug>.md`.
 *  - `cold/follow-ups.md`: surface the oldest DATED rows as an AGING-ESCALATION
 *    nudge, and undated rows separately as a "give this an anchor" prompt.
 *    Per the staleness principle ("aging escalates, never deletes"), both are
 *    informational — a prompt to decide, never a delete flag.
 *
 *    The two groups are reported separately because they compete otherwise:
 *    undated rows used to sort as "oldest" so they'd surface for a decision,
 *    which works until they outnumber the display slots. At 27 undated rows
 *    against 5 slots the escalation showed the same 5 entries every run and the
 *    159 rows filed before July never surfaced once.
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
/** Undated rows are a fix-the-data prompt, so a short sample + the total suffices. */
const UNDATED_SAMPLE_SIZE = 3;
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
 * The date a row was FILED — its aging anchor.
 *
 * Prefers an explicit `Surfaced YYYY-MM-DD` stamp (the file's convention),
 * falling back to the EARLIEST date mentioned. Null when a row carries no date.
 *
 * The stamp match is case-insensitive (rows occasionally read "Originally
 * surfaced …") but `\b`-anchored so it cannot match inside a compound like
 * "resurfaced" — a RE-surfacing date is not the filing date.
 *
 * Deliberately NOT the latest date: annotating a row must not reset its age.
 * `06-backlog.md`'s "aging escalates" is about how long an item has been
 * pending, so a row filed in April that gained a note in July is still an April
 * item and must keep sorting like one.
 * @internal Exported for testing
 */
export function parseRowDate(row: string): string | null {
  const surfaced = /\bSurfaced\s+(\d{4}-\d{2}-\d{2})/i.exec(row);
  if (surfaced !== null) {
    return surfaced[1];
  }
  const dates = row.match(/\d{4}-\d{2}-\d{2}/g);
  if (dates === null || dates.length === 0) {
    return null;
  }
  return [...dates].sort()[0];
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
 * The oldest DATED rows, oldest first.
 *
 * Undated rows are excluded here and reported separately by
 * {@link undatedFollowUps}. Sorting them in as "oldest" (the previous
 * behaviour) starves this list the moment undated rows outnumber the display
 * slots: with 27 undated rows and 5 slots, the escalation showed the same 5
 * undated entries forever and 159 genuinely-old dated rows never surfaced once.
 * @internal Exported for testing
 */
export function oldestFollowUps(
  rows: FollowUpRow[],
  n: number
): (FollowUpRow & { date: string })[] {
  return rows
    .filter((r): r is FollowUpRow & { date: string } => r.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, n);
}

/**
 * Rows with no date at all — they have lost their aging anchor, so they can
 * never be ranked. Reported as their own "needs a date" prompt rather than
 * competing for the escalation slots.
 * @internal Exported for testing
 */
export function undatedFollowUps(rows: FollowUpRow[]): FollowUpRow[] {
  return rows.filter(r => r.date === null);
}

/**
 * A well-formed `| Item | Why |` row has exactly three unescaped delimiters.
 *
 * Deliberately hardcoded rather than derived from the header row: a malformed
 * header would otherwise become the canonical shape and silently disarm the
 * check. If `follow-ups.md` ever gains a column, bump this — it is the single
 * place to update, and leaving it stale fails every row at once.
 */
const WELL_FORMED_PIPE_COUNT = 3;

/**
 * Rows in `follow-ups.md` whose cell count doesn't match the header.
 *
 * Every deviation is content-destroying at render time, and all three observed
 * classes are silent — the table still looks fine:
 *  - **two rows merged onto one line** (a missing newline): the second item
 *    can't be counted, dated, or surfaced by the aging nudge. One hid a real
 *    item for a month.
 *  - **an extra column**: GFM drops cells beyond the header's count, so the
 *    row's trailing `Why` never renders (90 rows were in this state).
 *  - **an unescaped `|` inside an inline code span**: splits the row mid-token,
 *    mangling the displayed text (e.g. a regex alternation `(a|an|any)`).
 *
 * Escaped pipes (`\|`) are stripped first — they are legitimate row prose.
 * @internal Exported for testing
 */
export function findMalformedFollowUpRows(md: string): string[] {
  const problems: string[] = [];
  md.split('\n').forEach((line, index) => {
    if (!line.startsWith('|') || /^\|\s*[-:]+\s*\|/.test(line)) {
      return;
    }
    // Strip escaped BACKSLASHES before escaped pipes. Order matters: a cell
    // ending in a literal backslash (`…\\|`) would otherwise have its trailing
    // `\` + the real delimiter read as one escaped pipe, undercounting by one
    // and silently passing a malformed row — the exact class this guard exists
    // to catch.
    const delimiters = line.replace(/\\\\/g, '').replace(/\\\|/g, '').match(/\|/g)?.length ?? 0;
    if (delimiters !== WELL_FORMED_PIPE_COUNT) {
      problems.push(
        `follow-ups.md:${index + 1}: row has ${delimiters} cell delimiters (expected ${WELL_FORMED_PIPE_COUNT}) — ` +
          'merged rows, an extra column, or an unescaped | inside a code span. All three silently destroy content at render.'
      );
    }
  });
  return problems;
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

/** Parsed follow-up rows, or [] when the file is absent. */
function loadFollowUpRows(rootDir: string): FollowUpRow[] {
  const followPath = join(rootDir, 'backlog/cold/follow-ups.md');
  if (!existsSync(followPath)) {
    return [];
  }
  return parseFollowUpRows(readFileSync(followPath, 'utf-8'));
}

/** Structural table defects in follow-ups.md (gates the exit code). */
function checkFollowUpStructure(rootDir: string): string[] {
  const followPath = join(rootDir, 'backlog/cold/follow-ups.md');
  if (!existsSync(followPath)) {
    return [];
  }
  return findMalformedFollowUpRows(readFileSync(followPath, 'utf-8'));
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

function reportOldest(oldest: (FollowUpRow & { date: string })[]): void {
  if (oldest.length === 0) {
    return;
  }
  console.log('');
  console.log(chalk.yellow.bold("⏳ Oldest follow-ups (aging escalates — decide, don't delete):"));
  for (const row of oldest) {
    console.log(chalk.dim(`   • ${row.date}  ${row.title}`));
  }
}

/**
 * Undated rows, reported separately so they can't crowd out the escalation.
 * Shows a bounded sample plus the total, since the ask is "give these an
 * anchor", not "decide these N specifically".
 */
function reportUndated(undated: FollowUpRow[], sampleSize: number): void {
  if (undated.length === 0) {
    return;
  }
  console.log('');
  console.log(
    chalk.yellow.bold(
      `📅 ${undated.length} follow-up(s) have no date — they can't be aged. Add a \`Surfaced YYYY-MM-DD\`:`
    )
  );
  for (const row of undated.slice(0, sampleSize)) {
    console.log(chalk.dim(`   • ${row.title}`));
  }
  if (undated.length > sampleSize) {
    console.log(chalk.dim(`   … and ${undated.length - sampleSize} more`));
  }
}

/**
 * CLI entry point. Sets a non-zero exit code on structural problems (cap
 * exceeded / dangling theme link); the aging surface is informational only.
 */
export async function runBacklogLint(options: LintOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  const oldestCount = options.oldestCount ?? DEFAULT_OLDEST_COUNT;

  const problems = [
    ...checkNowCaps(rootDir),
    ...checkQueueLinks(rootDir),
    ...checkFollowUpStructure(rootDir),
  ];
  reportProblems(problems);

  const rows = loadFollowUpRows(rootDir);
  reportOldest(oldestFollowUps(rows, oldestCount));
  reportUndated(undatedFollowUps(rows), UNDATED_SAMPLE_SIZE);

  if (problems.length > 0) {
    process.exitCode = 1;
  }
}
