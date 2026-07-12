import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryRaw = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn(async () => ({
    prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
    disconnect: mockDisconnect,
  })),
}));

const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  readFileSync: vi.fn(),
}));

import {
  mineGoldens,
  stratifySample,
  topPersonalities,
  MIN_CONTENT_CHARS,
  type MemoryMetaRow,
} from './mine-goldens.js';

function meta(
  id: string,
  personalityId: string,
  createdAt: string,
  contentChars = MIN_CONTENT_CHARS + 100
): MemoryMetaRow {
  return { id, personalityId, createdAt: new Date(createdAt), contentChars };
}

/** A time-ordered pool of n rows for one personality, one day apart. */
function pool(personalityId: string, n: number): MemoryMetaRow[] {
  return Array.from({ length: n }, (_, i) =>
    meta(
      `${personalityId}-${i}`,
      personalityId,
      new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString()
    )
  );
}

describe('stratifySample', () => {
  it('is deterministic (same input → same sample)', () => {
    const rows = pool('p1', 500);
    const options = { sampleSize: 60, personalityIds: ['p1'] };
    expect(stratifySample(rows, options)).toEqual(stratifySample(rows, options));
  });

  it('returns everything when the eligible pool is at or under target', () => {
    const rows = pool('p1', 40);
    const ids = stratifySample(rows, { sampleSize: 40, personalityIds: ['p1'] });
    expect(ids).toHaveLength(40);
  });

  it('applies the length floor and the personality filter', () => {
    const rows = [
      meta('short', 'p1', '2025-01-01', MIN_CONTENT_CHARS - 1),
      meta('other', 'p2', '2025-01-02'),
      ...pool('p1', 30),
    ];
    const ids = stratifySample(rows, { sampleSize: 100, personalityIds: ['p1'] });
    expect(ids).not.toContain('short');
    expect(ids).not.toContain('other');
    expect(ids).toHaveLength(30);
  });

  it('samples across the whole time range, not just one end', () => {
    const rows = pool('p1', 1200);
    const ids = stratifySample(rows, { sampleSize: 120, personalityIds: ['p1'] });
    const indices = ids.map(id => Number(id.split('-')[1]));
    expect(Math.min(...indices)).toBeLessThan(120);
    expect(Math.max(...indices)).toBeGreaterThan(1080);
    expect(ids.length).toBeLessThanOrEqual(120);
  });

  it('splits the target proportionally across personalities (quota enforced exactly)', () => {
    // 900:300 pool at target 120 → proportional quotas are 90:30. The old
    // step-based picker drifted to 108:12 here (over-picking per bucket, then
    // starving the later personality via the global cap) — pin the exact
    // quota behavior so that regression class stays dead.
    const rows = [...pool('big', 900), ...pool('small', 300)];
    const ids = stratifySample(rows, { sampleSize: 120, personalityIds: ['big', 'small'] });
    const bigCount = ids.filter(id => id.startsWith('big-')).length;
    const smallCount = ids.filter(id => id.startsWith('small-')).length;
    expect(bigCount).toBe(90);
    expect(smallCount).toBe(30);
  });

  it('personality order does not change proportional shares', () => {
    const rows = [...pool('big', 900), ...pool('small', 300)];
    const reversed = stratifySample(rows, {
      sampleSize: 120,
      personalityIds: ['small', 'big'],
    });
    expect(reversed.filter(id => id.startsWith('small-')).length).toBe(30);
    expect(reversed.filter(id => id.startsWith('big-')).length).toBe(90);
  });
});

describe('topPersonalities', () => {
  it('ranks by eligible (length-floored) row count', () => {
    const rows = [
      ...pool('busy', 50),
      ...pool('quiet', 10),
      // A personality whose rows are all under the floor never ranks.
      ...Array.from({ length: 80 }, (_, i) =>
        meta(`frag-${i}`, 'fragments', '2025-01-01', MIN_CONTENT_CHARS - 1)
      ),
    ];
    expect(topPersonalities(rows, 2)).toEqual(['busy', 'quiet']);
  });
});

describe('mineGoldens (the Prisma + fs seams)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDisconnect.mockResolvedValue(undefined);
    // First $queryRaw call = metadata; second = content for the sampled ids.
    mockQueryRaw
      .mockResolvedValueOnce([
        {
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          personality_id: 'pers-1',
          created_at: new Date('2025-01-01'),
          content_chars: MIN_CONTENT_CHARS + 50,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'aaaaaaaa-0000-0000-0000-000000000001',
          personality_id: 'pers-1',
          created_at: new Date('2025-01-01'),
          content: 'Vladlena visited Rome. Vladlena loved it.',
          senders: ['realuser'],
        },
      ]);
  });

  it('threads the persona id into the metadata query and the sampled ids into the content query', async () => {
    await mineGoldens({ env: 'dev', personaId: 'persona-uuid-123' });

    // Tagged-template calls: (strings, ...values). Assert what crossed the seam.
    const metaValues = mockQueryRaw.mock.calls[0].slice(1);
    expect(metaValues).toContain('persona-uuid-123');
    const contentValues = mockQueryRaw.mock.calls[1].slice(1);
    expect(contentValues[0]).toEqual(['aaaaaaaa-0000-0000-0000-000000000001']);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('writes all three artifacts, with detected entities reaching the swap map and report', async () => {
    await mineGoldens({ env: 'dev', personaId: 'persona-uuid-123' });

    expect(mockMkdirSync).toHaveBeenCalledWith('reports/goldens-mining', { recursive: true });
    const writes = new Map(
      mockWriteFileSync.mock.calls.map(call => [String(call[0]), String(call[1])])
    );
    const paths = [...writes.keys()];
    expect(paths.some(p => p.endsWith('corpus-raw.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('swap-map.proposed.json'))).toBe(true);
    expect(paths.some(p => p.endsWith('entity-report.md'))).toBe(true);

    const corpus = JSON.parse(
      writes.get([...writes.keys()].find(p => p.endsWith('corpus-raw.json'))!)!
    ) as { content: string }[];
    expect(corpus[0].content).toContain('Vladlena');

    const swapMap = JSON.parse(
      writes.get([...writes.keys()].find(p => p.endsWith('swap-map.proposed.json'))!)!
    ) as { swaps: { from: string }[] };
    // 'Vladlena' appears twice (above the floor); 'realuser' rides in as a sender.
    expect(swapMap.swaps.some(s => s.from === 'Vladlena')).toBe(true);
    expect(swapMap.swaps.some(s => s.from === 'realuser')).toBe(true);

    const report = writes.get([...writes.keys()].find(p => p.endsWith('entity-report.md'))!)!;
    expect(report).toContain('Vladlena');
    expect(report).toContain('cp swap-map.proposed.json swap-map.json');
  });
});
