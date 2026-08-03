import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryRaw = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('../memory/prisma-env.js', () => ({
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
}));

import { mineVoiceProbes } from './mine-voice-probes.js';
import type { VoiceProbeFile } from './voice-probes.js';

const OWNER_ID = '278863839632818186';
const OWNER_PERSONA = 'persona-owner';
const OTHER_PERSONA = 'persona-other';
const JSON_PROTOCOL = JSON.stringify({
  permissions: ['p'],
  characterDirectives: ['d'],
  formattingRules: ['f'],
});

/** One assistant anchor per depth; windows built on demand by the dispatcher. */
interface Fixture {
  ownerRows: { id: string }[];
  personaRows: { id: string; name: string; preferred_name: string | null }[];
  activityRows: { personality_id: string; persona_id: string; n: number }[];
  detailRows: Record<string, { id: string; slug: string; name: string; protocol: string | null }>;
  anchorRows: { id: string; channel_id: string; persona_id: string; created_at: Date }[];
  windowsByAnchor: Record<string, unknown[]>;
}

function windowRow(
  id: string,
  role: string,
  personaId: string,
  minutesAgo: number
): Record<string, unknown> {
  return {
    id,
    role,
    content: `${role} says ${id}`,
    created_at: new Date(Date.UTC(2026, 6, 15, 12, 0) - minutesAgo * 60_000),
    persona_id: personaId,
    personality_id: 'char-1',
    discord_message_id: [],
    message_metadata: {},
    token_count: 10,
    persona_name: 'Vee',
    persona_preferred_name: personaId === OWNER_PERSONA ? 'V' : null,
    personality_name: 'Char One',
  };
}

/** A full, owner-only window: trigger (user) + depth prior turns. */
function ownerWindow(depth: number): unknown[] {
  const rows: unknown[] = [windowRow('trigger', 'user', OWNER_PERSONA, 1)];
  for (let i = 0; i < depth; i++) {
    rows.push(windowRow(`prior-${i}`, i % 2 === 0 ? 'assistant' : 'user', OWNER_PERSONA, 2 + i));
  }
  return rows;
}

/** Dispatch $queryRaw by SQL content — sequence-based mocking is unreadable for
 * a seven-query flow. The first arg of a tagged template call is the strings array. */
function installDispatcher(fixture: Fixture): void {
  mockQueryRaw.mockImplementation((...args: unknown[]) => {
    const sql = (args[0] as string[]).join(' ');
    if (sql.includes('FROM users')) {
      return Promise.resolve(fixture.ownerRows);
    }
    if (sql.includes('FROM personas WHERE owner_id')) {
      return Promise.resolve(fixture.personaRows);
    }
    if (sql.includes('GROUP BY personality_id')) {
      return Promise.resolve(fixture.activityRows);
    }
    if (sql.includes('FROM personalities p')) {
      const id = args.slice(1).find(value => typeof value === 'string') as string;
      const detail = fixture.detailRows[id];
      return Promise.resolve(detail === undefined ? [] : [detail]);
    }
    if (sql.includes("role = 'assistant'") && sql.includes('ORDER BY created_at ASC')) {
      return Promise.resolve(fixture.anchorRows);
    }
    if (sql.includes('(ch.created_at, ch.id) <')) {
      // Window query — the anchor id is the last string param (…::uuid).
      const params = args.slice(1).filter(value => typeof value === 'string');
      const anchorId = params[params.length - 1] as string;
      return Promise.resolve(fixture.windowsByAnchor[anchorId] ?? []);
    }
    if (sql.includes('WHERE id =')) {
      const anchorId = args.slice(1).find(value => typeof value === 'string') as string;
      const anchor = fixture.anchorRows.find(row => row.id === anchorId);
      return Promise.resolve(
        anchor === undefined
          ? []
          : [
              {
                id: anchor.id,
                content: `reference reply for ${anchor.id}`,
                guild_id: 'guild-1',
                created_at: anchor.created_at,
              },
            ]
      );
    }
    throw new Error(`Unmatched SQL in test dispatcher: ${sql}`);
  });
}

function baseFixture(): Fixture {
  return {
    ownerRows: [{ id: 'user-uuid' }],
    personaRows: [{ id: OWNER_PERSONA, name: 'Vee', preferred_name: 'V' }],
    activityRows: [{ personality_id: 'char-1', persona_id: OWNER_PERSONA, n: 50 }],
    detailRows: {
      'char-1': { id: 'char-1', slug: 'char-one', name: 'Char One', protocol: JSON_PROTOCOL },
    },
    anchorRows: [
      {
        id: 'anchor-1',
        channel_id: 'chan-1',
        persona_id: OWNER_PERSONA,
        created_at: new Date('2026-07-15T12:00:00Z'),
      },
    ],
    windowsByAnchor: { 'anchor-1': ownerWindow(5) },
  };
}

function writtenFile(): VoiceProbeFile {
  const write = mockWriteFileSync.mock.calls.find(call => String(call[0]).endsWith('probes.json'));
  expect(write).toBeDefined();
  return JSON.parse(String(write![1])) as VoiceProbeFile;
}

describe('mineVoiceProbes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDisconnect.mockResolvedValue(undefined);
  });

  it('mines a probe end-to-end: trigger + chronological prior history + reference reply', async () => {
    installDispatcher(baseFixture());
    await mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, depths: [5] });

    const file = writtenFile();
    expect(file.probes).toHaveLength(1);
    const probe = file.probes[0];
    expect(probe.depth).toBe(5);
    expect(probe.trigger.role).toBe('user');
    expect(probe.priorHistory).toHaveLength(5);
    // Chronological: oldest first, and strictly before the trigger.
    const times = probe.priorHistory.map(entry => new Date(entry.createdAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[times.length - 1]).toBeLessThan(new Date(probe.trigger.createdAt).getTime());
    expect(probe.referenceReply.content).toBe('reference reply for anchor-1');
    // Names joined for speaker attribution (preferred_name wins).
    expect(probe.trigger.personaName).toBe('V');
    expect(probe.personality.protocolFormat).toBe('json');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('PRIVACY GATE: drops any candidate whose window contains a non-owner persona turn', async () => {
    const fixture = baseFixture();
    const tainted = ownerWindow(5);
    tainted[3] = windowRow('foreign', 'user', OTHER_PERSONA, 4);
    fixture.windowsByAnchor = { 'anchor-1': tainted };
    installDispatcher(fixture);

    await mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, depths: [5] });
    expect(writtenFile().probes).toHaveLength(0);
  });

  it('PRIVACY GATE: anchors from non-owner personas never become candidates', async () => {
    const fixture = baseFixture();
    fixture.anchorRows = [{ ...fixture.anchorRows[0], persona_id: OTHER_PERSONA }];
    installDispatcher(fixture);

    await mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, depths: [5] });
    expect(writtenFile().probes).toHaveLength(0);
  });

  it('drops candidates whose immediately-preceding row is not a user turn', async () => {
    const fixture = baseFixture();
    const window = ownerWindow(5);
    window[0] = windowRow('trigger', 'assistant', OWNER_PERSONA, 1);
    fixture.windowsByAnchor = { 'anchor-1': window };
    installDispatcher(fixture);

    await mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, depths: [5] });
    expect(writtenFile().probes).toHaveLength(0);
  });

  it('drops candidates with insufficient history for the depth stratum', async () => {
    const fixture = baseFixture();
    fixture.windowsByAnchor = { 'anchor-1': ownerWindow(3) }; // 4 rows < depth 5 + 1
    installDispatcher(fixture);

    await mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, depths: [5] });
    expect(writtenFile().probes).toHaveLength(0);
  });

  it('hard-errors on an unknown owner discord id (a typo must not read as "no data")', async () => {
    const fixture = baseFixture();
    fixture.ownerRows = [];
    installDispatcher(fixture);

    await expect(mineVoiceProbes({ env: 'dev', ownerDiscordId: 'wrong' })).rejects.toThrow(
      /No user row/
    );
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('hard-errors on an unknown --personalities slug', async () => {
    installDispatcher(baseFixture());
    await expect(
      mineVoiceProbes({
        env: 'dev',
        ownerDiscordId: OWNER_ID,
        personalitySlugs: ['no-such-slug'],
      })
    ).rejects.toThrow(/no owner-conversation activity/);
  });

  it('rejects an invalid cutoff before touching the DB', async () => {
    installDispatcher(baseFixture());
    await expect(
      mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, cutoff: 'not-a-date' })
    ).rejects.toThrow(/not a valid ISO instant/);
  });

  it('PRIVACY GATE: refuses an --out that escapes the gitignored reports/ tree', async () => {
    installDispatcher(baseFixture());
    await expect(
      mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, outDir: 'docs/probes' })
    ).rejects.toThrow(/must resolve under reports\//);
    await expect(
      mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, outDir: 'reports-evil' })
    ).rejects.toThrow(/must resolve under reports\//);
    await expect(
      mineVoiceProbes({ env: 'dev', ownerDiscordId: OWNER_ID, outDir: 'reports/../secrets' })
    ).rejects.toThrow(/must resolve under reports\//);
  });

  it('warns (without blocking) when an EXPLICIT slug has no protocol', async () => {
    const fixture = baseFixture();
    fixture.detailRows['char-1'] = { ...fixture.detailRows['char-1'], protocol: null };
    installDispatcher(fixture);
    await mineVoiceProbes({
      env: 'dev',
      ownerDiscordId: OWNER_ID,
      personalitySlugs: ['char-one'],
      depths: [5],
    });
    const file = writtenFile();
    expect(file.meta.personalities.map(p => p.slug)).toEqual(['char-one']);
    expect(file.meta.warnings.some(warning => warning.includes('no protocol'))).toBe(true);
  });

  it('records the cutoff, depths, personalities, and warnings in meta', async () => {
    installDispatcher(baseFixture());
    await mineVoiceProbes({
      env: 'dev',
      ownerDiscordId: OWNER_ID,
      depths: [5],
      cutoff: '2026-08-01T00:00:00Z',
    });
    const file = writtenFile();
    expect(file.meta.cutoff).toBe('2026-08-01T00:00:00.000Z');
    expect(file.meta.depths).toEqual([5]);
    expect(file.meta.personalities.map(p => p.slug)).toEqual(['char-one']);
    expect(mockMkdirSync).toHaveBeenCalledWith('reports/voice-consistency', { recursive: true });
  });
});
