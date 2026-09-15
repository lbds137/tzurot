import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEDGER_PATH,
  computePassStatus,
  dayNumber,
  isOverdue,
  localDateString,
  parseLedger,
  runCadenceMark,
  runCadenceStatus,
  type CadenceIo,
  type CadencePass,
} from './cadence.js';

function pass(overrides: Partial<CadencePass> = {}): CadencePass {
  return {
    name: 'doc-audit',
    what: 'keeps docs honest',
    cadenceDays: 30,
    lastRun: null,
    trigger: '/tzurot-doc-audit',
    ...overrides,
  };
}

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop() as string, { recursive: true, force: true });
  }
});

/** A throwaway repo root holding `backlog/cadence-ledger.json` with the given body. */
function ledgerRoot(body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'cadence-'));
  fixtures.push(root);
  mkdirSync(join(root, 'backlog'));
  writeFileSync(join(root, LEDGER_PATH), body);
  return root;
}

function ledgerBody(passes: unknown[]): string {
  return `${JSON.stringify({ passes }, null, 2)}\n`;
}

function captureIo(): CadenceIo & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return { logs, errors, log: line => logs.push(line), error: line => errors.push(line) };
}

/** Noon UTC is the same calendar date in every zone from UTC-11 to UTC+11. */
const NOON_UTC_SEP_15 = new Date('2026-09-15T12:00:00Z');

describe('localDateString', () => {
  it('returns the local calendar date, not the UTC one, for an evening run', () => {
    const instant = new Date('2026-09-15T02:30:00Z');
    expect(localDateString(instant, 'America/New_York')).toBe('2026-09-14');
  });

  it('returns the UTC date for the same instant when the zone is UTC', () => {
    expect(localDateString(new Date('2026-09-15T02:30:00Z'), 'UTC')).toBe('2026-09-15');
  });
});

describe('dayNumber', () => {
  it('counts calendar days across a DST transition without an off-by-one', () => {
    expect((dayNumber('2026-03-09') as number) - (dayNumber('2026-03-07') as number)).toBe(2);
    expect((dayNumber('2026-11-02') as number) - (dayNumber('2026-10-31') as number)).toBe(2);
  });

  it('rejects rollover dates and malformed text', () => {
    expect(dayNumber('2026-02-30')).toBeNull();
    expect(dayNumber('2026-9-15')).toBeNull();
    expect(dayNumber('yesterday')).toBeNull();
  });
});

describe('computePassStatus', () => {
  it('is ok when exactly cadenceDays have passed', () => {
    const status = computePassStatus(
      pass({ cadenceDays: 30, lastRun: '2026-08-16' }),
      '2026-09-15'
    );
    expect(status.daysSince).toBe(30);
    expect(status.state).toEqual({ kind: 'ok' });
    expect(isOverdue(status)).toBe(false);
  });

  it('is overdue by the excess once daysSince exceeds cadenceDays', () => {
    const status = computePassStatus(
      pass({ cadenceDays: 30, lastRun: '2026-08-15' }),
      '2026-09-15'
    );
    expect(status.daysSince).toBe(31);
    expect(status.state).toEqual({ kind: 'overdue', by: 1 });
    expect(isOverdue(status)).toBe(true);
  });

  it('treats a null lastRun as never recorded, which counts as overdue', () => {
    const status = computePassStatus(pass({ lastRun: null }), '2026-09-15');
    expect(status.daysSince).toBeNull();
    expect(status.state).toEqual({ kind: 'never' });
    expect(isOverdue(status)).toBe(true);
  });
});

describe('parseLedger', () => {
  it('returns the same object it was given', () => {
    const raw = { passes: [pass()], note: 'kept' };
    expect(parseLedger(raw)).toBe(raw);
  });

  it('rejects a duplicate name, a non-positive cadence, and a malformed lastRun', () => {
    expect(() => parseLedger({ passes: [pass(), pass()] })).toThrow(
      'duplicate pass name "doc-audit"'
    );
    expect(() => parseLedger({ passes: [pass({ cadenceDays: 0 })] })).toThrow('cadenceDays');
    expect(() => parseLedger({ passes: [pass({ lastRun: '2026-13-01' })] })).toThrow('lastRun');
    expect(() => parseLedger({ entries: [] })).toThrow('"passes" array');
  });

  it('accepts the committed ledger', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const ledger = parseLedger(JSON.parse(readFileSync(join(repoRoot, LEDGER_PATH), 'utf-8')));
    expect(ledger.passes.length).toBeGreaterThan(0);
  });
});

describe('runCadenceStatus', () => {
  const mixed = [
    pass({ name: 'fresh', cadenceDays: 30, lastRun: '2026-09-10' }),
    pass({ name: 'late', cadenceDays: 7, lastRun: '2026-09-01' }),
    pass({ name: 'unrecorded', lastRun: null }),
  ];

  it('exits 0 even when passes are overdue or never recorded', () => {
    const io = captureIo();
    const code = runCadenceStatus({
      rootDir: ledgerRoot(ledgerBody(mixed)),
      now: NOON_UTC_SEP_15,
      io,
    });
    expect(code).toBe(0);
    expect(io.errors).toEqual([]);
  });

  it('lists every pass with its state in the full view', () => {
    const io = captureIo();
    runCadenceStatus({ rootDir: ledgerRoot(ledgerBody(mixed)), now: NOON_UTC_SEP_15, io });
    const output = io.logs.join('\n');
    expect(output).toMatch(/fresh\s+30d\s+2026-09-10\s+5\s+ok/);
    expect(output).toMatch(/late\s+7d\s+2026-09-01\s+14\s+OVERDUE 7d/);
    expect(output).toMatch(/unrecorded\s+30d\s+—\s+—\s+never recorded/);
  });

  it('prints only overdue rows with --overdue-only', () => {
    const io = captureIo();
    runCadenceStatus({
      rootDir: ledgerRoot(ledgerBody(mixed)),
      now: NOON_UTC_SEP_15,
      overdueOnly: true,
      io,
    });
    const output = io.logs.join('\n');
    expect(output).toContain('late');
    expect(output).toContain('unrecorded');
    expect(output).not.toContain('fresh');
  });

  it('prints nothing at all with --overdue-only when nothing is overdue', () => {
    const io = captureIo();
    const code = runCadenceStatus({
      rootDir: ledgerRoot(ledgerBody([pass({ name: 'fresh', lastRun: '2026-09-10' })])),
      now: NOON_UTC_SEP_15,
      overdueOnly: true,
      io,
    });
    expect(code).toBe(0);
    expect(io.logs).toEqual([]);
  });

  it('exits 1 with a message when the ledger is missing or malformed', () => {
    const missing = mkdtempSync(join(tmpdir(), 'cadence-missing-'));
    fixtures.push(missing);
    const io = captureIo();
    expect(runCadenceStatus({ rootDir: missing, io })).toBe(1);
    expect(io.errors.join('\n')).toContain('Cannot read the cadence ledger');

    const malformed = captureIo();
    expect(runCadenceStatus({ rootDir: ledgerRoot('{ not json'), io: malformed })).toBe(1);
    expect(malformed.errors.join('\n')).toContain('Cannot read the cadence ledger');
  });
});

describe('runCadenceMark', () => {
  const three = [
    pass({ name: 'first', lastRun: '2026-08-01' }),
    pass({ name: 'middle', lastRun: null }),
    pass({ name: 'last', cadenceDays: 7, lastRun: '2026-09-01' }),
  ];

  it('stamps the named pass and preserves every other entry and key order', () => {
    const root = ledgerRoot(ledgerBody(three));
    const io = captureIo();
    const code = runCadenceMark({
      rootDir: root,
      name: 'middle',
      date: '2026-09-14',
      now: NOON_UTC_SEP_15,
      io,
    });

    expect(code).toBe(0);
    const expected = ledgerBody([three[0], { ...three[1], lastRun: '2026-09-14' }, three[2]]);
    expect(readFileSync(join(root, LEDGER_PATH), 'utf-8')).toBe(expected);
    expect(io.logs.join('\n')).toContain(`git add ${LEDGER_PATH}`);
  });

  it('keeps unknown top-level and per-entry keys through a write', () => {
    const body = `${JSON.stringify(
      { version: 1, passes: [{ ...three[0], owner: 'me' }] },
      null,
      2
    )}\n`;
    const root = ledgerRoot(body);
    runCadenceMark({
      rootDir: root,
      name: 'first',
      date: '2026-09-14',
      now: NOON_UTC_SEP_15,
      io: captureIo(),
    });
    expect(readFileSync(join(root, LEDGER_PATH), 'utf-8')).toBe(
      body.replace('2026-08-01', '2026-09-14')
    );
  });

  it("defaults the stamp to today's local date", () => {
    const root = ledgerRoot(ledgerBody(three));
    runCadenceMark({ rootDir: root, name: 'first', now: NOON_UTC_SEP_15, io: captureIo() });
    const ledger = JSON.parse(readFileSync(join(root, LEDGER_PATH), 'utf-8')) as {
      passes: CadencePass[];
    };
    expect(ledger.passes[0].lastRun).toBe('2026-09-15');
  });

  it('exits 1 on an unknown name, lists the valid names, and leaves the file untouched', () => {
    const body = ledgerBody(three);
    const root = ledgerRoot(body);
    const io = captureIo();
    const code = runCadenceMark({ rootDir: root, name: 'nope', now: NOON_UTC_SEP_15, io });

    expect(code).toBe(1);
    expect(readFileSync(join(root, LEDGER_PATH), 'utf-8')).toBe(body);
    expect(io.errors.join('\n')).toContain('Valid names: first, middle, last');
  });

  it.each([['2026-02-30'], ['09/14/2026'], ['2026-09-16']])(
    'exits 1 on the invalid or future --date %s and leaves the file untouched',
    date => {
      const body = ledgerBody(three);
      const root = ledgerRoot(body);
      const io = captureIo();
      const code = runCadenceMark({ rootDir: root, name: 'first', date, now: NOON_UTC_SEP_15, io });

      expect(code).toBe(1);
      expect(readFileSync(join(root, LEDGER_PATH), 'utf-8')).toBe(body);
      expect(io.errors.join('\n')).toContain(`Invalid --date "${date}"`);
    }
  );
});
