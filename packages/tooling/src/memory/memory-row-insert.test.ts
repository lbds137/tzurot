import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  shutdown: vi.fn(),
  getEmbedding: vi.fn(),
}));

vi.mock('@tzurot/embeddings', () => ({
  LocalEmbeddingService: class {
    initialize = mocks.initialize;
    getEmbedding = mocks.getEmbedding;
    shutdown = mocks.shutdown;
  },
}));

import {
  describeError,
  insertMemoryRow,
  withLocalEmbeddings,
  type MemoryRowInsert,
} from './memory-row-insert.js';

describe('describeError', () => {
  it('returns name and code for an Error carrying a string code', () => {
    const error = Object.assign(new Error('secret memory text'), { code: 'P2010' });
    expect(describeError(error)).toBe('Error P2010');
  });

  it('returns only the name for an Error without a code', () => {
    expect(describeError(new TypeError('secret memory text'))).toBe('TypeError');
  });

  it('returns Unknown for a non-Error', () => {
    expect(describeError('secret memory text')).toBe('Unknown');
  });
});

const ROW: MemoryRowInsert = {
  id: '11111111-1111-4111-8111-111111111111',
  personaId: '22222222-2222-4222-8222-222222222222',
  personalityId: '33333333-3333-4333-8333-333333333333',
  content: '{user}: hi\n{assistant}: hello',
  embedding: new Float32Array([0.5, 0.25]),
  channelId: 'ch-1',
  guildId: null,
  messageIds: ['m1', 'm2'],
  createdAt: new Date('2026-02-10T12:00:00Z'),
  sourceSystem: 'test-source',
};

describe('insertMemoryRow', () => {
  function makePrisma(result: number) {
    return { $executeRaw: vi.fn().mockResolvedValue(result) };
  }

  it('writes the 19-column row with every value bound in column order', async () => {
    const prisma = makePrisma(1);

    await insertMemoryRow(prisma as never, ROW);

    const [strings, ...values] = prisma.$executeRaw.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain(
      'id, persona_id, personality_id, content, embedding,\n' +
        '      is_summarized, session_id, canon_scope, summary_type,\n' +
        '      channel_id, guild_id, message_ids, senders,\n' +
        '      created_at, updated_at, source_system, type, is_locked, visibility'
    );
    expect(sql).toContain("false, NULL, 'personal', NULL,");
    expect(sql).toContain('ARRAY[]::text[]');
    expect(sql).toContain("'memory', false, 'normal'");
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(values).toHaveLength(11);
    expect(values.slice(0, 8)).toEqual([
      ROW.id,
      ROW.personaId,
      ROW.personalityId,
      ROW.content,
      '[0.5,0.25]',
      'ch-1',
      null,
      ['m1', 'm2'],
    ]);
    expect(values[8]).toEqual(ROW.createdAt);
    expect(values[9]).toBeInstanceOf(Date);
    expect(values[10]).toBe('test-source');
  });

  it('returns true when a row was written and false when ON CONFLICT skipped it', async () => {
    expect(await insertMemoryRow(makePrisma(1) as never, ROW)).toBe(true);
    expect(await insertMemoryRow(makePrisma(0) as never, ROW)).toBe(false);
  });
});

describe('withLocalEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initialize.mockResolvedValue(true);
    mocks.shutdown.mockResolvedValue(undefined);
  });

  it('hands the initialized service to fn, returns its value and shuts down', async () => {
    mocks.getEmbedding.mockResolvedValue(new Float32Array([1]));

    const result = await withLocalEmbeddings(async service => service.getEmbedding('x'));

    expect(result).toEqual(new Float32Array([1]));
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shuts down and throws without running fn when initialize returns false', async () => {
    mocks.initialize.mockResolvedValue(false);
    const fn = vi.fn();

    await expect(withLocalEmbeddings(fn)).rejects.toThrow('Failed to initialize embedding service');

    expect(fn).not.toHaveBeenCalled();
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shuts down when fn throws', async () => {
    await expect(
      withLocalEmbeddings(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });
});
