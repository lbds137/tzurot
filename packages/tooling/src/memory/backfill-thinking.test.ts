import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryRawMock, executeRawMock, confirmMock, disconnectMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  executeRawMock: vi.fn(),
  confirmMock: vi.fn().mockResolvedValue(undefined),
  disconnectMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  requireProductionConfirmation: confirmMock,
}));

vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({
    prisma: {
      $queryRaw: queryRawMock,
      $executeRaw: executeRawMock,
    },
    disconnect: disconnectMock,
  }),
}));

import {
  backfillThinking,
  classifyCandidateRow,
  type CandidatePairRow,
} from './backfill-thinking.js';

function unpackTaggedCall(call: unknown[]): { sql: string; values: unknown[] } {
  const [strings, ...values] = call as [readonly string[], ...unknown[]];
  return { sql: strings.join('$param'), values };
}

const ID_1 = '00000000-0000-4000-8000-000000000001';
const ID_2 = '00000000-0000-4000-8000-000000000002';
const ID_3 = '00000000-0000-4000-8000-000000000003';
const ID_4 = '00000000-0000-4000-8000-000000000004';
const ID_5 = '00000000-0000-4000-8000-000000000005';
const ID_6 = '00000000-0000-4000-8000-000000000006';
const INITIAL_CURSOR = '00000000-0000-0000-0000-000000000000';

describe('backfillThinking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(undefined);
    disconnectMock.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('writes nothing and does not call $executeRaw on --dry-run while counting writable rows', async () => {
    const rows: CandidatePairRow[] = [
      {
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'private reasoning trace',
        guard_ok: true,
      },
      {
        id: ID_2,
        user_found: false,
        assistant_role: null,
        thinking_content: null,
        guard_ok: null,
      },
    ];
    queryRawMock.mockResolvedValueOnce(rows);

    const result = await backfillThinking({ env: 'dev', dryRun: true });

    expect(executeRawMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      candidates: 2,
      paired: 1,
      skipped_no_history: 1,
      skipped_interleaved: 0,
      skipped_guard: 0,
      skipped_no_trace: 0,
      writable: 1,
      updated: 0,
    });
    expect(disconnectMock).toHaveBeenCalledOnce();
  });

  it('skips and counts rows that fail the head-40 content guard', async () => {
    const rows: CandidatePairRow[] = [
      {
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'reasoning for mismatched turn',
        guard_ok: false,
      },
    ];
    queryRawMock.mockResolvedValueOnce(rows);

    const result = await backfillThinking({ env: 'dev' });

    const { sql } = unpackTaggedCall(queryRawMock.mock.calls[0]);
    expect(sql).toContain(
      '(length(a.content) > 0 AND position(left(a.content, 40) IN m.content) > 0)'
    );
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      candidates: 1,
      paired: 1,
      skipped_no_history: 0,
      skipped_interleaved: 0,
      skipped_guard: 1,
      skipped_no_trace: 0,
      writable: 0,
      updated: 0,
    });
  });

  it('carries thinking_content IS NULL and omits updated_at in UPDATE SQL', async () => {
    const row: CandidatePairRow = {
      id: ID_1,
      user_found: true,
      assistant_role: 'assistant',
      thinking_content: 'captured chain of thought',
      guard_ok: true,
    };
    let storedThinking: string | null = null;
    executeRawMock.mockImplementation((strings: TemplateStringsArray, trace: string) => {
      const sql = strings.join('$param');
      if (sql.includes('thinking_content IS NULL') && storedThinking !== null) {
        return Promise.resolve(0);
      }
      storedThinking = trace;
      return Promise.resolve(1);
    });

    queryRawMock.mockResolvedValueOnce([row]);
    const firstRun = await backfillThinking({ env: 'dev' });

    expect(firstRun.writable).toBe(1);
    expect(firstRun.updated).toBe(1);
    expect(executeRawMock).toHaveBeenCalledOnce();

    const { sql: updateSql, values } = unpackTaggedCall(executeRawMock.mock.calls[0]);
    expect(updateSql).toContain('UPDATE memories');
    expect(updateSql).toContain('SET thinking_content =');
    expect(updateSql).toContain('thinking_content IS NULL');
    expect(updateSql.toLowerCase()).not.toContain('updated_at');
    expect(values).toEqual(['captured chain of thought', ID_1]);

    queryRawMock.mockResolvedValueOnce([row]);
    const secondRun = await backfillThinking({ env: 'dev' });
    expect(secondRun.writable).toBe(1);
    expect(secondRun.updated).toBe(0);
  });

  it('aggregates counts across cursor batches and passes bound query params', async () => {
    const batch1: CandidatePairRow[] = [
      {
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'secret trace one',
        guard_ok: true,
      },
      {
        id: ID_2,
        user_found: true,
        assistant_role: 'user',
        thinking_content: 'not an assistant row',
        guard_ok: false,
      },
    ];
    const batch2: CandidatePairRow[] = [
      {
        id: ID_3,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: '   ',
        guard_ok: true,
      },
      {
        id: ID_4,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'secret trace two',
        guard_ok: false,
      },
    ];
    const batch3: CandidatePairRow[] = [
      {
        id: ID_5,
        user_found: false,
        assistant_role: null,
        thinking_content: null,
        guard_ok: null,
      },
      {
        id: ID_6,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'secret trace three',
        guard_ok: true,
      },
    ];

    queryRawMock
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValueOnce(batch3)
      .mockResolvedValueOnce([]);
    executeRawMock.mockResolvedValue(1);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = await backfillThinking({ env: 'dev', batchSize: 2 });

    expect(result).toEqual({
      candidates: 6,
      paired: 4,
      skipped_no_history: 1,
      skipped_interleaved: 1,
      skipped_guard: 1,
      skipped_no_trace: 1,
      writable: 2,
      updated: 2,
    });
    expect(result.updated).toBe(result.writable);

    expect(queryRawMock).toHaveBeenCalledTimes(4);
    const call1 = unpackTaggedCall(queryRawMock.mock.calls[0]);
    const call2 = unpackTaggedCall(queryRawMock.mock.calls[1]);
    const call3 = unpackTaggedCall(queryRawMock.mock.calls[2]);
    const call4 = unpackTaggedCall(queryRawMock.mock.calls[3]);

    expect(call1.sql).toContain('u.id IS NOT NULL AS user_found');
    expect(call1.sql).toContain(
      'SELECT u.id, u.channel_id, u.personality_id, u.persona_id, u.created_at'
    );
    expect(call1.sql).toContain('AND a.persona_id = u.persona_id');
    expect(call1.sql).toContain("m.source_system = 'tzurot-v3'");
    expect(call1.sql).toContain('coalesce(m.chunk_index, 0) = 0');
    expect(call1.sql).toContain('m.thinking_content IS NULL');
    expect(call1.sql).toContain('m.message_ids[1] IS NOT NULL');
    expect(call1.sql).toContain('m.message_ids[1] = ANY(u.discord_message_id)');
    expect(call1.sql).toContain("interval '30 minutes'");
    expect(call1.sql).not.toContain('ASSISTANT_ROW_OFFSET_MS');

    expect(call1.values).toEqual([INITIAL_CURSOR, 2]);
    expect(call2.values).toEqual([ID_2, 2]);
    expect(call3.values).toEqual([ID_4, 2]);
    expect(call4.values).toEqual([ID_6, 2]);

    expect(executeRawMock).toHaveBeenCalledTimes(2);
    const [update1, update2] = executeRawMock.mock.calls;
    expect(unpackTaggedCall(update1).values).toEqual(['secret trace one', ID_1]);
    expect(unpackTaggedCall(update2).values).toEqual(['secret trace three', ID_6]);

    const loggedOutput = logSpy.mock.calls.map(args => args.join(' ')).join('\n');
    expect(loggedOutput).toContain('candidates: 6');
    expect(loggedOutput).toContain('paired: 4');
    expect(loggedOutput).toContain('skipped_no_history: 1');
    expect(loggedOutput).toContain('skipped_interleaved: 1');
    expect(loggedOutput).toContain('skipped_guard: 1');
    expect(loggedOutput).toContain('skipped_no_trace: 1\n   writable: 2\n   updated: 2');
    expect(loggedOutput).not.toContain('secret trace');
  });

  it('refuses prod execution without --force when confirmation is declined', async () => {
    confirmMock.mockRejectedValueOnce(new Error('exit: declined'));

    await expect(backfillThinking({ env: 'prod' })).rejects.toThrow('exit: declined');

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('skips prod confirmation when --force or --dry-run is set', async () => {
    queryRawMock.mockResolvedValue([]);

    await backfillThinking({ env: 'prod', force: true });
    await backfillThinking({ env: 'prod', dryRun: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-positive or non-integer batchSize', async () => {
    await expect(backfillThinking({ env: 'dev', batchSize: 0 })).rejects.toThrow(
      '--batch-size must be a positive integer'
    );
    await expect(backfillThinking({ env: 'dev', batchSize: 1.5 })).rejects.toThrow(
      '--batch-size must be a positive integer'
    );
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});

describe('classifyCandidateRow', () => {
  it('returns no_history when user_found is false or null', () => {
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: false,
        assistant_role: null,
        thinking_content: null,
        guard_ok: null,
      })
    ).toEqual({ verdict: 'no_history' });
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: null,
        assistant_role: 'assistant',
        thinking_content: 'reasoning trace',
        guard_ok: true,
      })
    ).toEqual({ verdict: 'no_history' });
  });

  it('returns interleaved when user_found is true and assistant_role is not assistant', () => {
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: true,
        assistant_role: null,
        thinking_content: 'reasoning trace',
        guard_ok: true,
      })
    ).toEqual({ verdict: 'interleaved' });
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: true,
        assistant_role: 'user',
        thinking_content: 'reasoning trace',
        guard_ok: true,
      })
    ).toEqual({ verdict: 'interleaved' });
  });

  it('returns no_trace when thinking_content is null or whitespace-only', () => {
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: null,
        guard_ok: true,
      })
    ).toEqual({ verdict: 'no_trace' });
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: '   \t\n  ',
        guard_ok: true,
      })
    ).toEqual({ verdict: 'no_trace' });
  });

  it('returns guard when guard_ok is false or null', () => {
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'reasoning trace',
        guard_ok: false,
      })
    ).toEqual({ verdict: 'guard' });
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'reasoning trace',
        guard_ok: null,
      })
    ).toEqual({ verdict: 'guard' });
  });

  it('returns write when assistant row has non-empty trace and guard_ok is true', () => {
    expect(
      classifyCandidateRow({
        id: ID_1,
        user_found: true,
        assistant_role: 'assistant',
        thinking_content: 'reasoning trace',
        guard_ok: true,
      })
    ).toEqual({ verdict: 'write', trace: 'reasoning trace' });
  });
});
