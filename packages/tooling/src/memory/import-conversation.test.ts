import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  queryRawUnsafe: vi.fn(),
  executeRaw: vi.fn(),
  txExecuteRawUnsafe: vi.fn(),
  txQueryRawUnsafe: vi.fn(),
  txOrder: [] as string[],
  disconnect: vi.fn(),
  getEmbedding: vi.fn(),
  initialize: vi.fn(),
  shutdown: vi.fn(),
  getOwnerId: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  requireProductionConfirmation: mocks.confirm,
}));
vi.mock('../utils/gateway-client.js', () => ({ getBotOwnerDiscordIdForEnv: mocks.getOwnerId }));
vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockImplementation(async () => ({
    prisma: {
      $queryRawUnsafe: mocks.queryRawUnsafe,
      $executeRaw: mocks.executeRaw,
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          $executeRawUnsafe: (...args: unknown[]) => {
            mocks.txOrder.push('execute');
            return mocks.txExecuteRawUnsafe(...args);
          },
          $queryRawUnsafe: (...args: unknown[]) => {
            mocks.txOrder.push('query');
            return mocks.txQueryRawUnsafe(...args);
          },
        }),
    },
    disconnect: mocks.disconnect,
  })),
}));
vi.mock('@tzurot/embeddings', () => ({
  LocalEmbeddingService: class {
    initialize = mocks.initialize;
    getEmbedding = mocks.getEmbedding;
    shutdown = mocks.shutdown;
  },
}));

import { importConversation } from './import-conversation.js';
import {
  buildExpectedRows,
  pairTurns,
  EXTERNAL_IMPORT_SOURCE_SYSTEM,
} from './import-conversation-core.js';
import { requireProductionConfirmation } from '../utils/env-runner.js';
import { UsageError } from '../utils/errors.js';

const MARKER = 'SECRET-MARKER-7f3a';
const PERSONALITY_ID = '22222222-2222-4222-8222-222222222222';
const PERSONA_ID = 'abcdef12-1111-4111-8111-111111111111';

const TURNS = [
  { role: 'user', text: `question one ${MARKER}`, timestamp: '2025-05-17T04:33:38.686Z' },
  { role: 'assistant', text: `answer one ${MARKER}`, timestamp: '2025-05-17T04:33:38.686Z' },
  { role: 'user', text: 'question two', timestamp: '2025-05-17T05:00:00.250Z' },
  { role: 'assistant', text: 'answer two', timestamp: '2025-05-17T05:00:00.250Z' },
];

const EXPECTED = buildExpectedRows(
  pairTurns(TURNS as Parameters<typeof pairTurns>[0]),
  PERSONA_ID,
  PERSONALITY_ID
);

/** Route the glue's lookup queries; `existing` lists ids already in `memories`. */
function routeLookups(
  opts: { existing?: string[]; slug?: boolean; user?: boolean; persona?: boolean } = {}
) {
  const { existing = [], slug = true, user = true, persona = true } = opts;
  mocks.queryRawUnsafe.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM personalities')) return slug ? [{ id: PERSONALITY_ID }] : [];
    if (sql.includes('FROM users')) return user ? [{ default_persona_id: PERSONA_ID }] : [];
    if (sql.includes('FROM personas')) return persona ? [{ id: PERSONA_ID }] : [];
    if (sql.includes('FROM memories')) return existing.map(id => ({ id }));
    return [];
  });
}

function captureConsole() {
  const lines: string[] = [];
  const grab = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  for (const method of ['log', 'error', 'warn', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation(grab);
  }
  return lines;
}

const base = { env: 'dev' as const, file: '/tmp/x.json', personality: 'test-slug' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.txOrder.length = 0;
  mocks.readFile.mockResolvedValue(JSON.stringify(TURNS));
  mocks.getOwnerId.mockReturnValue('900000000000000001');
  mocks.initialize.mockResolvedValue(true);
  mocks.getEmbedding.mockResolvedValue(new Float32Array([0.1, 0.2]));
  mocks.executeRaw.mockResolvedValue(1);
  mocks.shutdown.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.confirm.mockResolvedValue(undefined);
  routeLookups();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('importConversation', () => {
  it('dry run writes nothing and reports pair count and date range', async () => {
    const lines = captureConsole();

    await importConversation(base);

    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.getEmbedding).not.toHaveBeenCalled();
    const out = lines.join('\n');
    expect(out).toContain('Pairs: 2');
    expect(out).toContain('2025-05-17T04:33:38.686Z');
    expect(out).toContain('2025-05-17T05:00:00.250Z');
    expect(out).toContain('DRY RUN');
    expect(out).toContain('abcdef12');
    expect(mocks.disconnect).toHaveBeenCalled();
  });

  it('apply inserts every pair with the prompt timestamp and the source tag', async () => {
    captureConsole();

    await importConversation({ ...base, apply: true });

    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    for (const [i, call] of mocks.executeRaw.mock.calls.entries()) {
      const values = call.slice(1);
      expect(values[0]).toBe(EXPECTED[i].id);
      expect(values[1]).toBe(PERSONA_ID);
      expect(values[2]).toBe(PERSONALITY_ID);
      expect(values[3]).toBe(EXPECTED[i].content);
      expect((values[5] as Date).getTime()).toBe(EXPECTED[i].createdAt.getTime());
      expect(values[7]).toBe(EXPECTED_TAG);
    }
    expect(mocks.shutdown).toHaveBeenCalled();
  });

  it('a re-run where every id exists inserts and embeds nothing', async () => {
    const lines = captureConsole();
    routeLookups({ existing: EXPECTED.map(row => row.id) });

    await importConversation({ ...base, apply: true });

    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.getEmbedding).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('Inserted: 0');
    expect(lines.join('\n')).toContain('Already existed: 2');
  });

  it('only embeds the pairs that are not yet present', async () => {
    captureConsole();
    routeLookups({ existing: [EXPECTED[0].id] });

    await importConversation({ ...base, apply: true });

    expect(mocks.getEmbedding).toHaveBeenCalledTimes(1);
    expect(mocks.getEmbedding).toHaveBeenCalledWith(EXPECTED[1].content);
  });

  it('refuses an unknown personality slug', async () => {
    routeLookups({ slug: false });
    await expect(importConversation(base)).rejects.toBeInstanceOf(UsageError);
  });

  it('refuses when the owner user row is missing', async () => {
    routeLookups({ user: false });
    await expect(importConversation(base)).rejects.toBeInstanceOf(UsageError);
  });

  it('refuses when the owner persona row is missing', async () => {
    routeLookups({ persona: false });
    await expect(importConversation(base)).rejects.toBeInstanceOf(UsageError);
  });

  it('asks for confirmation on prod apply, and skips it with --force', async () => {
    captureConsole();
    await importConversation({ ...base, env: 'prod', apply: true });
    expect(requireProductionConfirmation).toHaveBeenCalledWith('import conversation memories');

    vi.mocked(requireProductionConfirmation).mockClear();
    await importConversation({ ...base, env: 'prod', apply: true, force: true });
    expect(requireProductionConfirmation).not.toHaveBeenCalled();
  });

  it('does not ask for confirmation on a prod dry run', async () => {
    captureConsole();
    await importConversation({ ...base, env: 'prod' });
    expect(requireProductionConfirmation).not.toHaveBeenCalled();
  });

  it('counts an embedding failure and an insert failure by index and exits 1', async () => {
    const lines = captureConsole();
    mocks.getEmbedding.mockResolvedValueOnce(undefined);
    mocks.executeRaw.mockRejectedValueOnce(new Error('boom'));

    await importConversation({ ...base, apply: true });

    expect(lines.join('\n')).toContain('Pair 0: embedding failed');
    expect(lines.join('\n')).toContain('Pair 1: insert failed (Error)');
    expect(lines.join('\n')).toContain('Failed: 2');
    expect(process.exitCode).toBe(1);
  });

  it('rejects malformed JSON without echoing the file text', async () => {
    mocks.readFile.mockResolvedValue(`{"role": "${MARKER}" oops`);

    const error = await importConversation(base).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).not.toContain(MARKER);
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('validates the file before opening any DB connection', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify([TURNS[1]]));
    await expect(importConversation(base)).rejects.toBeInstanceOf(UsageError);
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
  });

  describe('--verify', () => {
    function verifyRows(overrides: { content?: string } = {}) {
      mocks.txQueryRawUnsafe.mockImplementation(async (sql: string) => {
        if (sql.includes('id <> ALL')) return [];
        return EXPECTED.map((row, i) => ({
          id: row.id,
          content: i === 0 && overrides.content !== undefined ? overrides.content : row.content,
          created_at: row.createdAt,
          personality_id: PERSONALITY_ID,
          persona_id: PERSONA_ID,
        }));
      });
    }

    it('runs SET TRANSACTION READ ONLY first and prints PASS lines', async () => {
      const lines = captureConsole();
      verifyRows();

      await importConversation({ ...base, verify: true });

      expect(mocks.txOrder[0]).toBe('execute');
      expect(mocks.txExecuteRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
      const out = lines.join('\n');
      expect(out).toContain('PASS (a) count: 2/2 rows, 0 extra');
      expect(out).toContain('PASS (d) target');
      expect(process.exitCode).toBeUndefined();
    });

    it('passes the tag and resolved target into the extras query', async () => {
      captureConsole();
      verifyRows();

      await importConversation({ ...base, verify: true });

      const extrasCall = mocks.txQueryRawUnsafe.mock.calls.find(c =>
        String(c[0]).includes('id <> ALL')
      );
      expect(extrasCall?.slice(1, 4)).toEqual([EXPECTED_TAG, PERSONALITY_ID, PERSONA_ID]);
    });

    it('exits 1 on a FAIL', async () => {
      const lines = captureConsole();
      verifyRows({ content: 'drifted' });

      await importConversation({ ...base, verify: true });

      expect(lines.join('\n')).toContain('FAIL (b) content: mismatching pair indexes 0');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('privacy', () => {
    it('never emits turn text in output or errors across dry-run, apply, failures and verify', async () => {
      const lines = captureConsole();
      const thrown: string[] = [];
      const run = async (options: Parameters<typeof importConversation>[0]) => {
        await importConversation(options).catch((e: unknown) => {
          thrown.push(e instanceof Error ? e.message : String(e));
        });
      };

      await run(base);

      mocks.getEmbedding.mockResolvedValueOnce(undefined);
      mocks.executeRaw.mockRejectedValueOnce(new Error(`params leaked ${MARKER}`));
      await run({ ...base, apply: true });

      mocks.executeRaw.mockRejectedValueOnce(Object.assign(new Error(MARKER), { code: 'P2010' }));
      await run({ ...base, apply: true });

      mocks.txQueryRawUnsafe.mockImplementation(async (sql: string) =>
        sql.includes('id <> ALL')
          ? []
          : EXPECTED.map(row => ({
              id: row.id,
              content: `${MARKER} drifted`,
              created_at: row.createdAt,
              personality_id: PERSONALITY_ID,
              persona_id: PERSONA_ID,
            }))
      );
      await run({ ...base, verify: true });

      mocks.readFile.mockResolvedValue(
        JSON.stringify([{ role: 'assistant', text: MARKER, timestamp: '2025-05-17T04:00:00Z' }])
      );
      await run(base);

      mocks.readFile.mockResolvedValue(`not json ${MARKER}`);
      await run(base);

      expect(lines.length).toBeGreaterThan(0);
      expect(thrown.length).toBe(2);
      expect(lines.join('\n')).not.toContain(MARKER);
      expect(thrown.join('\n')).not.toContain(MARKER);
    });
  });
});

const EXPECTED_TAG = EXTERNAL_IMPORT_SOURCE_SYSTEM;
