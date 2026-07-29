import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  findStaleDebugCommits,
  runStaleDebugAudit,
  STALE_DEBUG_MAX_AGE_DAYS,
  type GitRunner,
} from './stale-debug-audit.js';
import { parseSummary } from '../audits/summary.js';

const SHA_ADD = 'a'.repeat(40);
const SHA_REMOVE = 'b'.repeat(40);
const SHA_OTHER = 'c'.repeat(40);

const NOW_MS = Date.parse('2026-07-29T12:00:00Z');
const DAYS = 24 * 60 * 60 * 1000;

/** Epoch seconds for a commit N days before NOW_MS. */
function epochDaysAgo(days: number): number {
  return Math.floor((NOW_MS - days * DAYS) / 1000);
}

/**
 * Build a fake git runner from canned per-command responses.
 * `diffTree` values use the real `--numstat` shape: `added\tdeleted\tfile`.
 */
function fakeGit(responses: {
  log?: string;
  diffTree?: Record<string, string>;
  blame?: Record<string, string>;
  shallow?: boolean;
}): GitRunner {
  return (args: string[]): string => {
    if (args[0] === 'rev-parse') {
      return responses.shallow === true ? 'true\n' : 'false\n';
    }
    if (args[0] === 'log') {
      return responses.log ?? '';
    }
    if (args[0] === 'diff-tree') {
      const sha = args[args.length - 1];
      return responses.diffTree?.[sha] ?? '';
    }
    if (args[0] === 'blame') {
      const file = args[args.length - 1];
      const blame = responses.blame?.[file];
      if (blame === undefined) {
        throw new Error(`fatal: no such path '${file}' in HEAD`);
      }
      return blame;
    }
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('findStaleDebugCommits', () => {
  it('returns ok when history has no debug commits', () => {
    const result = findStaleDebugCommits({ runGit: fakeGit({ log: '' }), nowMs: NOW_MS });
    expect(result).toEqual({ totalDebugCommits: 0, liveCommits: [], status: 'ok' });
  });

  it('drops grep body-matches whose SUBJECT is not debug-typed', () => {
    // `git log --grep` matches every message line, so a feat commit whose
    // BODY quotes a `debug:` line reaches the parser; the subject anchor
    // must reject it.
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_OTHER}|${epochDaysAgo(20)}|feat(bot-client): quote a debug: line in the body`,
      }),
    });

    expect(result).toEqual({ totalDebugCommits: 0, liveCommits: [], status: 'ok' });
  });

  it('flags a debug commit whose lines survive past the threshold as stale/fail', () => {
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(20)}|debug(clients): add transport probe`,
        diffTree: { [SHA_ADD]: '12\t0\tpackages/clients/src/transport.ts\n' },
        blame: {
          'packages/clients/src/transport.ts': [
            `${SHA_OTHER} 1) const x = 1;`,
            `${SHA_ADD} 2) probe('request-start');`,
            `${SHA_ADD} 3) probe('settled');`,
          ].join('\n'),
        },
      }),
    });

    expect(result.status).toBe('fail');
    expect(result.liveCommits).toHaveLength(1);
    expect(result.liveCommits[0]).toMatchObject({
      sha: SHA_ADD,
      stale: true,
      ageDays: 20,
      survivingFiles: [{ file: 'packages/clients/src/transport.ts', lines: 2 }],
    });
  });

  it('reports a young survivor as warn, not fail (active investigation window)', () => {
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(3)}|debug(bot-client): add forward-shape probes`,
        diffTree: { [SHA_ADD]: '6\t0\tservices/bot-client/src/x.ts\n' },
        blame: { 'services/bot-client/src/x.ts': `${SHA_ADD} 1) probe();` },
      }),
    });

    expect(result.status).toBe('warn');
    expect(result.liveCommits[0].stale).toBe(false);
  });

  it('treats a fully-removed probe (SHA absent from blame) as clean', () => {
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: [
          `${SHA_ADD}|${epochDaysAgo(30)}|debug(bot-client): add probes`,
          `${SHA_REMOVE}|${epochDaysAgo(25)}|debug(bot-client): remove probes`,
        ].join('\n'),
        diffTree: {
          [SHA_ADD]: '6\t0\tservices/bot-client/src/x.ts\n',
          [SHA_REMOVE]: '1\t7\tservices/bot-client/src/x.ts\n',
        },
        blame: { 'services/bot-client/src/x.ts': `${SHA_OTHER} 1) real code;` },
      }),
    });

    expect(result.status).toBe('ok');
    expect(result.liveCommits).toEqual([]);
    expect(result.totalDebugCommits).toBe(2);
  });

  it('never flags a net-deleting debug commit, even when it owns residue at HEAD', () => {
    // A `debug: remove …` commit legitimately owns reflowed neighbors and
    // comment tweaks at HEAD. Flagging that residue would be a permanent
    // false positive — the net-direction filter excludes it up front.
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_REMOVE}|${epochDaysAgo(50)}|debug(bot-client): remove forward-shape diagnostics`,
        diffTree: { [SHA_REMOVE]: '5\t120\tservices/bot-client/src/handlers/MessageHandler.ts\n' },
        blame: {
          'services/bot-client/src/handlers/MessageHandler.ts': `${SHA_REMOVE} 1) const wasHandled = await processor.process(message);`,
        },
      }),
    });

    expect(result.status).toBe('ok');
    expect(result.liveCommits).toEqual([]);
  });

  it('flags a net-zero add commit (probe inserted by replacing a line)', () => {
    // `- await foo();` / `+ await probe(foo());` is 1 del + 1 add — net zero.
    // Excluding it would hide the scaffolding from survivorship forever.
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(20)}|debug: wrap the call in a probe`,
        diffTree: { [SHA_ADD]: '1\t1\ta.ts\n' },
        blame: { 'a.ts': `${SHA_ADD} 1) await probe(foo());` },
      }),
    });

    expect(result.status).toBe('fail');
    expect(result.liveCommits).toHaveLength(1);
  });

  it('rethrows unexpected blame failures instead of degrading to "no survivors"', () => {
    const runGit: GitRunner = args => {
      if (args[0] === 'rev-parse') {
        return 'false\n';
      }
      if (args[0] === 'log') {
        return `${SHA_ADD}|${epochDaysAgo(20)}|debug: add probe`;
      }
      if (args[0] === 'diff-tree') {
        return '3\t0\ta.ts\n';
      }
      throw new Error('fatal: bad object HEAD (corrupted pack)');
    };

    expect(() => findStaleDebugCommits({ nowMs: NOW_MS, runGit })).toThrow(/corrupted pack/);
  });

  it('rejects a non-finite maxAgeDays instead of silently disabling the fail path', () => {
    expect(() =>
      findStaleDebugCommits({ nowMs: NOW_MS, maxAgeDays: Number('2w'), runGit: fakeGit({}) })
    ).toThrow(/maxAgeDays/);
  });

  it('ignores surviving blank lines (blame attributes blanks, but they are not scaffolding)', () => {
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(30)}|debug: add probes since fully removed`,
        diffTree: { [SHA_ADD]: '6\t0\ta.ts\n' },
        blame: {
          'a.ts': [`${SHA_OTHER}   1) real code;`, `${SHA_ADD}   2) `, `${SHA_ADD}   3)`].join(
            '\n'
          ),
        },
      }),
    });

    expect(result.status).toBe('ok');
    expect(result.liveCommits).toEqual([]);
  });

  it('treats a file deleted at HEAD as no surviving lines (blame throws)', () => {
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(30)}|debug: add scratch diagnostics file`,
        diffTree: { [SHA_ADD]: '40\t0\tservices/scratch-probe.ts\n' },
        blame: {},
      }),
    });

    expect(result.status).toBe('ok');
    expect(result.liveCommits).toEqual([]);
  });

  it('resolves boundary-truncated blame tokens (^ + 39 chars) by prefix', () => {
    // git blame -l keeps column width on boundary commits by truncating the
    // SHA to 39 chars behind the ^ marker (verified against real output).
    const truncated = SHA_ADD.slice(0, 39);
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(30)}|debug: add probe at repo root history`,
        diffTree: { [SHA_ADD]: '3\t0\ta.ts\n' },
        blame: { 'a.ts': `^${truncated} 1) probe();` },
      }),
    });

    expect(result.liveCommits).toHaveLength(1);
    expect(result.liveCommits[0].sha).toBe(SHA_ADD);
  });

  it('refuses to run against a shallow clone instead of false-greening', () => {
    expect(() =>
      findStaleDebugCommits({ nowMs: NOW_MS, runGit: fakeGit({ shallow: true }) })
    ).toThrow(/shallow/);
  });

  it('anchors the age threshold at STALE_DEBUG_MAX_AGE_DAYS exactly (at-threshold is not stale)', () => {
    const result = findStaleDebugCommits({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(STALE_DEBUG_MAX_AGE_DAYS)}|debug: add probe`,
        diffTree: { [SHA_ADD]: '3\t0\ta.ts\n' },
        blame: { 'a.ts': `${SHA_ADD} 1) probe();` },
      }),
    });

    expect(result.status).toBe('warn');
    expect(result.liveCommits[0].stale).toBe(false);
  });
});

describe('runStaleDebugAudit', () => {
  it('emits a parseable JSONL summary line with the verdict', () => {
    const captured: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });

    runStaleDebugAudit({
      summary: true,
      noFail: true,
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(20)}|debug: add probe`,
        diffTree: { [SHA_ADD]: '3\t0\ta.ts\n' },
        blame: { 'a.ts': `${SHA_ADD} 1) probe();` },
      }),
    });

    const summaryLine = captured.find(line => line.trim().startsWith('{'));
    expect(summaryLine).toBeDefined();
    const summary = parseSummary(summaryLine as string);
    expect(summary).toMatchObject({ tool: 'dev:stale-debug', status: 'fail', findings: 1 });
  });

  it('sets a nonzero exit code on fail unless noFail is passed', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    runStaleDebugAudit({
      nowMs: NOW_MS,
      runGit: fakeGit({
        log: `${SHA_ADD}|${epochDaysAgo(20)}|debug: add probe`,
        diffTree: { [SHA_ADD]: '3\t0\ta.ts\n' },
        blame: { 'a.ts': `${SHA_ADD} 1) probe();` },
      }),
    });

    expect(process.exitCode).toBe(1);
  });

  it('leaves the exit code untouched on a clean run', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    runStaleDebugAudit({ nowMs: NOW_MS, runGit: fakeGit({ log: '' }) });

    expect(process.exitCode).toBeUndefined();
  });
});
