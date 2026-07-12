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
  classifyQueryStyle,
  stratifiedStyleSample,
  mineConversationGoldens,
  QUERY_STYLES,
  type StyleCandidate,
  type QueryStyle,
} from './mine-conversation-goldens.js';

describe('classifyQueryStyle', () => {
  it('labels very short messages short-reactive', () => {
    expect(classifyQueryStyle('lol yeah')).toBe('short-reactive');
    expect(classifyQueryStyle('wait what')).toBe('short-reactive');
    expect(classifyQueryStyle('nice')).toBe('short-reactive');
  });

  it('length wins over the referential lead-in (a bare "it" is reactive, not referential)', () => {
    // "it" leads with a demonstrative but is 1 word — short-reactive takes priority.
    expect(classifyQueryStyle('it')).toBe('short-reactive');
  });

  it('labels demonstrative-led messages referential', () => {
    expect(classifyQueryStyle('that was a really interesting thing to bring up')).toBe(
      'referential'
    );
    expect(classifyQueryStyle('what about the trip you mentioned to me last week')).toBe(
      'referential'
    );
    expect(classifyQueryStyle('they never actually told you the whole story though')).toBe(
      'referential'
    );
  });

  it('labels multi-clause / multi-sentence messages compound', () => {
    // Two sentence enders.
    expect(classifyQueryStyle('Tell me a longer story please. Make it genuinely scary.')).toBe(
      'compound'
    );
    // A coordinating conjunction in a long message.
    expect(
      classifyQueryStyle('I went to the store and then I saw a movie later that same evening')
    ).toBe('compound');
  });

  it('labels a single self-contained question standalone', () => {
    expect(classifyQueryStyle('Can you explain how photosynthesis works for a plant')).toBe(
      'standalone'
    );
  });

  it('a short message with a conjunction is not compound (needs length)', () => {
    // "you and me" — 3 words → short-reactive wins before the compound check.
    expect(classifyQueryStyle('you and me')).toBe('short-reactive');
  });
});

describe('stratifiedStyleSample', () => {
  const mk = (id: string, style: QueryStyle, dayOffset: number): StyleCandidate => ({
    id,
    style,
    createdAt: new Date(2026, 0, 1 + dayOffset),
  });

  it('samples each style independently up to the quota', () => {
    const candidates: StyleCandidate[] = [
      ...Array.from({ length: 10 }, (_, i) => mk(`ref-${i}`, 'referential', i)),
      ...Array.from({ length: 10 }, (_, i) => mk(`std-${i}`, 'standalone', i)),
      mk('short-0', 'short-reactive', 0),
    ];
    const selected = stratifiedStyleSample(candidates, { perStyleQuota: 3, buckets: 4 });
    const styleOf = (id: string): QueryStyle => candidates.find(c => c.id === id)!.style;
    const counts = new Map<QueryStyle, number>();
    for (const id of selected) {
      counts.set(styleOf(id), (counts.get(styleOf(id)) ?? 0) + 1);
    }
    // referential + standalone each hit the quota of 3; short-reactive has only 1.
    expect(counts.get('referential')).toBe(3);
    expect(counts.get('standalone')).toBe(3);
    expect(counts.get('short-reactive')).toBe(1);
    // compound had no candidates → absent.
    expect(counts.get('compound')).toBeUndefined();
  });

  it('returns ids in a stable style-then-time order', () => {
    const candidates: StyleCandidate[] = [mk('b', 'standalone', 5), mk('a', 'referential', 2)];
    const first = stratifiedStyleSample(candidates, { perStyleQuota: 5, buckets: 4 });
    const second = stratifiedStyleSample(candidates, { perStyleQuota: 5, buckets: 4 });
    expect(first).toEqual(second);
    // 'referential' precedes 'standalone' in QUERY_STYLES → 'a' before 'b'.
    expect(first).toEqual(['a', 'b']);
  });

  it('covers every declared style in QUERY_STYLES', () => {
    expect(QUERY_STYLES).toEqual(['short-reactive', 'referential', 'compound', 'standalone']);
  });
});

describe('mineConversationGoldens (the Prisma + fs seams)', () => {
  const candidateRow = (id: string, content: string, channelId = 'chan-1') => ({
    id,
    channel_id: channelId,
    personality_id: 'char-1',
    content,
    message_metadata: { note: id },
    created_at: new Date('2026-01-10T00:00:00Z'),
  });
  // 3 turns ≥ MIN_PRIOR_TURNS, so every finalist becomes a golden.
  const priorTurns = [
    { role: 'user', content: 'earlier one', created_at: new Date('2026-01-09T00:00:00Z') },
    { role: 'assistant', content: 'earlier reply', created_at: new Date('2026-01-09T00:01:00Z') },
    { role: 'user', content: 'earlier two', created_at: new Date('2026-01-09T00:02:00Z') },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDisconnect.mockResolvedValue(undefined);
    // Call 0 = candidates query; every subsequent call = a finalist's prior-history.
    // One candidate per style so stratification picks all four deterministically.
    mockQueryRaw
      .mockResolvedValueOnce([
        candidateRow('id-short', 'ok cool'), // short-reactive
        candidateRow('id-ref', 'that was a genuinely interesting point'), // referential
        candidateRow('id-comp', 'I went out and then I came back home again later that same day'), // compound
        candidateRow('id-std', 'Can you help me understand this whole topic'), // standalone
      ])
      .mockResolvedValue(priorTurns);
  });

  it('threads the persona id into the candidates query', async () => {
    await mineConversationGoldens({ env: 'dev', personaId: 'persona-xyz', historyWindow: 10 });
    expect(mockQueryRaw.mock.calls[0].slice(1)).toContain('persona-xyz');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('scopes the prior-history window by CHANNEL only — never by personality (prod parity)', async () => {
    await mineConversationGoldens({ env: 'dev', personaId: 'persona-xyz', historyWindow: 10 });
    // Prior-history is call index 1+. Assert the SQL skeleton + the params that crossed.
    const priorCall = mockQueryRaw.mock.calls[1];
    const sql = (priorCall[0] as string[]).join(' ');
    expect(sql).toContain('channel_id');
    // The finding-#1 regression guard: production's getChannelHistory is channel-only,
    // so folding this by personality would diverge on multi-persona channels.
    expect(sql).not.toContain('personality_id');
    const priorValues = priorCall.slice(1);
    expect(priorValues).toContain('chan-1'); // channel scope crossed the seam
    expect(priorValues).toContain(10); // historyWindow → LIMIT
  });

  it('writes goldens with reconstructed fold windows + metadata, bounded by sampleSize', async () => {
    await mineConversationGoldens({
      env: 'dev',
      personaId: 'persona-xyz',
      sampleSize: 2,
      historyWindow: 10,
    });
    expect(mockMkdirSync).toHaveBeenCalledWith('reports/goldens-mining', { recursive: true });
    const write = mockWriteFileSync.mock.calls.find(call =>
      String(call[0]).endsWith('conversation-goldens.json')
    );
    expect(write).toBeDefined();
    const parsed = JSON.parse(String(write![1])) as {
      goldens: { priorHistory: unknown[]; messageMetadata: unknown; message: string }[];
    };
    expect(parsed.goldens).toHaveLength(2); // sampleSize constrains the output
    expect(parsed.goldens[0].priorHistory).toHaveLength(3); // reconstructed fold window
    expect(parsed.goldens[0].messageMetadata).toEqual({ note: expect.any(String) }); // rode along, no N+1
  });

  it('drops a finalist with too-little prior history and backfills the next of that style', async () => {
    // The point of 2x oversampling: a candidate whose fold window is too thin is
    // skipped in favor of the next oversampled candidate of the same style.
    mockQueryRaw.mockReset();
    mockQueryRaw
      .mockResolvedValueOnce([
        { ...candidateRow('id-short-a', 'ok'), created_at: new Date('2026-01-10T00:00:00Z') },
        { ...candidateRow('id-short-b', 'yes'), created_at: new Date('2026-01-11T00:00:00Z') },
      ])
      .mockResolvedValueOnce([priorTurns[0]]) // id-short-a: 1 prior turn < MIN_PRIOR_TURNS → dropped
      .mockResolvedValueOnce(priorTurns); // id-short-b: 3 prior turns → golden
    await mineConversationGoldens({
      env: 'dev',
      personaId: 'persona-xyz',
      sampleSize: 1,
      historyWindow: 10,
    });
    const write = mockWriteFileSync.mock.calls.find(call =>
      String(call[0]).endsWith('conversation-goldens.json')
    );
    const parsed = JSON.parse(String(write![1])) as { goldens: { id: string }[] };
    expect(parsed.goldens).toHaveLength(1);
    expect(parsed.goldens[0].id).toBe('id-short-b'); // the backfill, not the dropped 'id-short-a'
  });
});
