import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import {
  EMPTY_ROSTER_BLURB_CARD_HASH,
  hashRosterBlurbCard,
  ROSTER_BLURB_CARD_FIELDS,
  type RosterBlurbCard,
} from '@tzurot/common-types/utils/rosterBlurbCard';
import { sweepRosterBlurbs } from './rosterBlurbSweep.js';
import type { SystemModelInvoker } from '../services/systemModel/systemModelCall.js';

function setSettings(rosterBlurbEnabled: boolean): void {
  const values: Record<string, unknown> = {
    rosterBlurbEnabled,
    extractionModel: 'z-ai/glm-5.2',
  };
  registerSystemSettings({
    get: (key: string) => values[key],
  } as unknown as SystemSettingsService);
}

afterEach(() => resetSystemSettingsRegistration());

const EMPTY_CARD = Object.fromEntries(
  ROSTER_BLURB_CARD_FIELDS.map(k => [k, null])
) as RosterBlurbCard;

interface Row extends RosterBlurbCard {
  id: string;
  ownerId: string;
  cardSourceHash: string | null;
}

function row(overrides: Partial<Row> = {}): Row {
  const base: Row = {
    ...EMPTY_CARD,
    id: '4f9b0f66-0000-4000-8000-0000000000aa',
    ownerId: '4f9b0f66-0000-4000-8000-0000000000bb',
    cardSourceHash: null,
    name: 'Ilana',
    characterInfo: 'A dry-witted archivist.',
    ...overrides,
  };
  // Default the stamp to the card's real digest, which is what every write
  // path guarantees — a test that wants a mismatch must say so explicitly.
  return overrides.cardSourceHash === undefined
    ? { ...base, cardSourceHash: hashRosterBlurbCard(base) }
    : base;
}

/**
 * Prisma double.
 *
 * `stale` is what the raw staleness query returns; `unstamped` is what the
 * transitional stamping pass finds. `findMany` serves whichever the sweep is
 * asking for, in call order: stamping pass first, then the batch fetch.
 */
function makePrisma(options: { stale?: Row[]; unstamped?: Row[] } = {}): {
  prisma: PrismaClient;
  executeRaw: Mock;
  queryRaw: Mock;
  usageCreate: Mock;
} {
  const stale = options.stale ?? [];
  const unstamped = options.unstamped ?? [];
  const executeRaw = vi.fn().mockResolvedValue(1);
  const usageCreate = vi.fn().mockResolvedValue({});
  const queryRaw = vi.fn().mockResolvedValue(stale.map(r => ({ id: r.id })));
  const findMany = vi
    .fn()
    .mockResolvedValueOnce(unstamped)
    .mockResolvedValueOnce(stale)
    .mockResolvedValue([]);
  const prisma = {
    personality: { findMany },
    usageLog: { create: usageCreate },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  } as unknown as PrismaClient;
  return { prisma, executeRaw, queryRaw, usageCreate };
}

function invokerReturning(content: string): Mock<SystemModelInvoker> {
  return vi.fn<SystemModelInvoker>().mockResolvedValue({
    content,
    tokensIn: 100,
    tokensOut: 20,
    provider: AIProvider.OpenRouter,
  });
}

describe('sweepRosterBlurbs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing at all when the runtime switch is off', async () => {
    setSettings(false);
    const { prisma, queryRaw } = makePrisma({ stale: [row()] });
    const invoke = invokerReturning('{"blurb":"x"}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.enabled).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('asks the database for the stale set rather than hashing to find it', async () => {
    setSettings(true);
    const { prisma, queryRaw } = makePrisma();

    await sweepRosterBlurbs(prisma, invokerReturning('{"blurb":"x"}'));

    // The comparison must be SQL, and it must be IS DISTINCT FROM: plain `!=`
    // yields null when either side is null, so a never-generated blurb — the
    // row that most needs generating — would never be selected.
    const sqlParts = (queryRaw.mock.calls[0][0] as { raw?: string[] }).raw ?? [];
    const sql = sqlParts.join(' ');
    expect(sql).toContain('IS DISTINCT FROM');
    expect(sql).toContain('card_source_hash');
  });

  it('stamps pre-existing unstamped rows without generating them the same tick', async () => {
    setSettings(true);
    const unstamped = row({ cardSourceHash: null });
    const { prisma, executeRaw } = makePrisma({ unstamped: [unstamped] });
    const invoke = invokerReturning('{"blurb":"x"}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.stamped).toBe(1);
    expect(stats.generated).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
    const writeArgs = executeRaw.mock.calls[0] as unknown[];
    expect(writeArgs).toContain(hashRosterBlurbCard(unstamped));
  });

  it('stores the blurb against the stamp the write path recorded', async () => {
    setSettings(true);
    const stale = row();
    const { prisma, executeRaw, usageCreate } = makePrisma({ stale: [stale] });
    const invoke = invokerReturning('{"blurb":"Ilana is a dry-witted archivist."}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats).toMatchObject({ staleFound: 1, generated: 1, failed: 0 });
    const writeArgs = executeRaw.mock.calls[0] as unknown[];
    expect(writeArgs).toContain('Ilana is a dry-witted archivist.');
    expect(writeArgs).toContain(stale.cardSourceHash);
    expect(usageCreate).toHaveBeenCalledTimes(1);
  });

  it('marks an empty card current without paying for a blurb about nothing', async () => {
    setSettings(true);
    const empty = row({ name: null, characterInfo: null });
    expect(empty.cardSourceHash).toBe(EMPTY_ROSTER_BLURB_CARD_HASH);
    const { prisma, executeRaw } = makePrisma({ stale: [empty] });
    const invoke = invokerReturning('{"blurb":"x"}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats).toMatchObject({ stampedEmpty: 1, generated: 0 });
    expect(invoke).not.toHaveBeenCalled();
    // Marked anyway — otherwise every tick would rediscover it as stale.
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('bills a failed parse and stores nothing', async () => {
    setSettings(true);
    const { prisma, executeRaw, usageCreate } = makePrisma({ stale: [row()] });
    const invoke = invokerReturning('not json at all');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats).toMatchObject({ failed: 1, generated: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(usageCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps going when one row's model call throws", async () => {
    setSettings(true);
    const a = row({ id: '4f9b0f66-0000-4000-8000-0000000000a1' });
    const b = row({ id: '4f9b0f66-0000-4000-8000-0000000000a2' });
    const { prisma, executeRaw } = makePrisma({ stale: [a, b] });
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockRejectedValueOnce(new Error('429 rate limited'))
      .mockResolvedValue({
        content: '{"blurb":"Ilana is an archivist."}',
        tokensIn: 100,
        tokensOut: 20,
        provider: AIProvider.OpenRouter,
      });

    const stats = await sweepRosterBlurbs(prisma, invoke);

    // The throw costs its own row, not the rest of the tick.
    expect(stats.failed).toBe(1);
    expect(stats.generated).toBe(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('survives a usage-row failure rather than losing the blurb', async () => {
    setSettings(true);
    const { prisma, executeRaw, usageCreate } = makePrisma({ stale: [row()] });
    usageCreate.mockRejectedValue(new Error('db hiccup'));
    const invoke = invokerReturning('{"blurb":"Ilana is an archivist."}');

    const stats = await sweepRosterBlurbs(prisma, invoke);

    expect(stats.generated).toBe(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('bounds the stale query itself rather than trimming after the fetch', async () => {
    setSettings(true);
    const { prisma, queryRaw } = makePrisma();

    await sweepRosterBlurbs(prisma, invokerReturning('{"blurb":"x"}'));

    // The per-tick spend bound is the LIMIT, not a break in the loop — the
    // database never hands back more rows than this tick may pay for.
    expect(queryRaw.mock.calls[0]).toContain(10);
  });
});
