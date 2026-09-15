/**
 * Periodic-maintenance cadence ledger: which recurring process passes exist,
 * how often each should run, and when each last ran.
 *
 * The passes themselves (doc audit, memory prune, economy pass, session
 * mining, arch audit, usage audit, ratchet tightening) are skills that only
 * run when someone remembers to ask for them. The ledger turns "remember" into
 * a nag: `cadence:status` computes overdue state, the session-start hook prints
 * the overdue rows, and each pass ends by stamping itself with `cadence:mark`.
 *
 * This is a nag, not a gate. Overdue state never changes the exit code; only
 * an unreadable ledger or an operator mistake does.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Repo-relative ledger path. Under `backlog/` so a stamp commits straight to develop. */
export const LEDGER_PATH = 'backlog/cadence-ledger.json';

export interface CadencePass {
  name: string;
  /** One-line value the pass buys. */
  what: string;
  cadenceDays: number;
  /** Local calendar date `YYYY-MM-DD` of the last run, or null when never recorded. */
  lastRun: string | null;
  /** The skill or section that runs the pass. */
  trigger: string;
}

export interface CadenceLedger {
  passes: CadencePass[];
}

export type PassState = { kind: 'never' } | { kind: 'overdue'; by: number } | { kind: 'ok' };

export interface PassStatus {
  pass: CadencePass;
  /** Whole calendar days from `lastRun` to today; null when never recorded. */
  daysSince: number | null;
  state: PassState;
}

/** Output sinks, injectable so tests can capture what a command prints. */
export interface CadenceIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

const DEFAULT_IO: CadenceIo = {
  log: line => console.log(line),
  error: line => console.error(line),
};

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * The calendar date `now` falls on in `timeZone` (the process's local zone
 * when omitted), as `YYYY-MM-DD`. A pass happens on the owner's day, so the
 * stamp is the local date; a UTC slice of the ISO string would stamp an
 * evening run as tomorrow.
 */
export function localDateString(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Day number of a `YYYY-MM-DD` calendar date, or null when the text is not a
 * real date. Both sides of every subtraction go through this, so the
 * arithmetic is on calendar dates and a DST transition cannot shift a count.
 * Rejects a rollover date — a day past the end of its month — by round-
 * tripping the parts back through `Date.UTC`.
 */
export function dayNumber(text: string): number | null {
  const match = DATE_SHAPE.exec(text);
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms / MS_PER_DAY;
}

/** Overdue state of one pass as of the calendar date `today`. */
export function computePassStatus(pass: CadencePass, today: string): PassStatus {
  const todayNumber = dayNumber(today);
  const lastNumber = pass.lastRun === null ? null : dayNumber(pass.lastRun);
  if (lastNumber === null || todayNumber === null) {
    return { pass, daysSince: null, state: { kind: 'never' } };
  }
  const daysSince = todayNumber - lastNumber;
  if (daysSince > pass.cadenceDays) {
    return { pass, daysSince, state: { kind: 'overdue', by: daysSince - pass.cadenceDays } };
  }
  return { pass, daysSince, state: { kind: 'ok' } };
}

export function isOverdue(status: PassStatus): boolean {
  return status.state.kind !== 'ok';
}

function describeState(state: PassState): string {
  switch (state.kind) {
    case 'never':
      return 'never recorded';
    case 'overdue':
      return `OVERDUE ${state.by}d`;
    case 'ok':
      return 'ok';
  }
}

/**
 * Validate parsed JSON as a ledger. Returns the SAME object it was given, so
 * a later write preserves any extra keys and their order.
 */
export function parseLedger(raw: unknown): CadenceLedger {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as CadenceLedger).passes)) {
    throw new Error(`${LEDGER_PATH}: expected an object with a "passes" array`);
  }
  const seen = new Set<string>();
  for (const [index, entry] of (raw as { passes: unknown[] }).passes.entries()) {
    const problem = describeEntryProblem(entry);
    if (problem !== null) {
      throw new Error(`${LEDGER_PATH}: passes[${index}] ${problem}`);
    }
    const { name } = entry as CadencePass;
    if (seen.has(name)) {
      throw new Error(`${LEDGER_PATH}: duplicate pass name "${name}"`);
    }
    seen.add(name);
  }
  return raw as CadenceLedger;
}

function describeEntryProblem(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) {
    return 'is not an object';
  }
  const pass = entry as Record<string, unknown>;
  for (const key of ['name', 'what', 'trigger']) {
    const value = pass[key];
    if (typeof value !== 'string' || value.length === 0) {
      return `needs a non-empty string "${key}"`;
    }
  }
  if (
    typeof pass.cadenceDays !== 'number' ||
    !Number.isInteger(pass.cadenceDays) ||
    pass.cadenceDays < 1
  ) {
    return 'needs a positive integer "cadenceDays"';
  }
  if (
    pass.lastRun !== null &&
    (typeof pass.lastRun !== 'string' || dayNumber(pass.lastRun) === null)
  ) {
    return 'needs "lastRun" as YYYY-MM-DD or null';
  }
  return null;
}

/** Status table lines. With `overdueOnly`, only overdue rows — and no lines at all when none are. */
export function formatStatusTable(statuses: PassStatus[], overdueOnly: boolean): string[] {
  const shown = overdueOnly ? statuses.filter(isOverdue) : statuses;
  if (shown.length === 0) {
    return [];
  }
  const header = ['pass', 'cadence', 'last run', 'days since', 'state', 'trigger'];
  const rows = shown.map(s => [
    s.pass.name,
    `${s.pass.cadenceDays}d`,
    s.pass.lastRun ?? '—',
    s.daysSince === null ? '—' : String(s.daysSince),
    describeState(s.state),
    s.pass.trigger,
  ]);
  const widths = header.map((cell, col) =>
    Math.max(cell.length, ...rows.map(row => row[col].length))
  );
  const render = (row: string[]): string =>
    row.map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(widths[col]))).join('  ');
  return [
    render(header),
    ...rows.map(render),
    'After a pass runs: pnpm ops cadence:mark <pass>, then commit the ledger to develop.',
  ];
}

export interface LedgerFileOptions {
  rootDir?: string;
  now?: Date;
  io?: CadenceIo;
}

type LoadResult = { ok: true; ledger: CadenceLedger; path: string } | { ok: false };

function loadLedger(rootDir: string, io: CadenceIo): LoadResult {
  const path = join(rootDir, LEDGER_PATH);
  try {
    return { ok: true, ledger: parseLedger(JSON.parse(readFileSync(path, 'utf-8'))), path };
  } catch (error) {
    io.error(
      `Cannot read the cadence ledger: ${error instanceof Error ? error.message : String(error)}`
    );
    return { ok: false };
  }
}

/**
 * `cadence:status`. Returns the exit code: 0 whatever the overdue state, 1
 * only when the ledger itself cannot be read — so the session-start hook's
 * failure branch fires on a broken ledger instead of printing nothing.
 */
export function runCadenceStatus(options: LedgerFileOptions & { overdueOnly?: boolean }): number {
  const io = options.io ?? DEFAULT_IO;
  const loaded = loadLedger(options.rootDir ?? process.cwd(), io);
  if (!loaded.ok) {
    return 1;
  }
  const today = localDateString(options.now ?? new Date());
  const statuses = loaded.ledger.passes.map(pass => computePassStatus(pass, today));
  for (const line of formatStatusTable(statuses, options.overdueOnly === true)) {
    io.log(line);
  }
  return 0;
}

/**
 * `cadence:mark`. Stamps one pass's `lastRun` (default: today's local date)
 * and rewrites the ledger with every other entry and key order intact.
 * Returns 1 without writing on an unknown name, an invalid or future date, or
 * an unreadable ledger.
 */
export function runCadenceMark(
  options: LedgerFileOptions & { name: string; date?: string }
): number {
  const io = options.io ?? DEFAULT_IO;
  const loaded = loadLedger(options.rootDir ?? process.cwd(), io);
  if (!loaded.ok) {
    return 1;
  }
  const pass = loaded.ledger.passes.find(p => p.name === options.name);
  if (pass === undefined) {
    const valid = loaded.ledger.passes.map(p => p.name).join(', ');
    io.error(`Unknown pass "${options.name}". Valid names: ${valid}`);
    return 1;
  }
  const today = localDateString(options.now ?? new Date());
  const date = options.date ?? today;
  const dateNumber = dayNumber(date);
  if (dateNumber === null) {
    io.error(`Invalid --date "${date}": expected a real calendar date as YYYY-MM-DD`);
    return 1;
  }
  if (dateNumber > (dayNumber(today) ?? dateNumber)) {
    io.error(`Invalid --date "${date}": it is after today (${today})`);
    return 1;
  }
  const previous = pass.lastRun;
  pass.lastRun = date;
  writeFileSync(loaded.path, `${JSON.stringify(loaded.ledger, null, 2)}\n`);
  io.log(`Marked ${pass.name}: lastRun ${previous ?? 'never recorded'} → ${date}`);
  io.log(
    `Commit it to develop: git add ${LEDGER_PATH} && git commit -m "docs(backlog): stamp ${pass.name}"`
  );
  return 0;
}
