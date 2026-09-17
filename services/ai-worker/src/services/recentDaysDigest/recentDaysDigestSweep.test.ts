import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import type { DigestCandidatePair } from '@tzurot/common-types/services/recentDaysDigestSelection';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { SystemModelInvoker } from '../systemModel/systemModelCall.js';

const resolveSystemModelRouteMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ provider: 'zai-coding' })
);
vi.mock('../systemModel/systemModelCall.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../systemModel/systemModelCall.js')>();
  return { ...actual, resolveSystemModelRoute: resolveSystemModelRouteMock };
});

const selectDigestCandidatePairsMock = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/services/recentDaysDigestSelection', () => ({
  selectDigestCandidatePairs: selectDigestCandidatePairsMock,
}));

const storeMocks = vi.hoisted(() => ({
  materializePendingRows: vi.fn(),
  storeDigestSuccess: vi.fn(),
  recordDigestFailure: vi.fn(),
  readDigestStatus: vi.fn(),
}));
vi.mock('./recentDaysDigestStore.js', () => storeMocks);

const usageLogMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./recentDaysDigestUsageLog.js', () => ({ writeRecentDaysDigestUsageLog: usageLogMock }));

const { sweepRecentDaysDigests } = await import('./recentDaysDigestSweep.js');

const PERSONA_ID = '4f9b0f66-5555-4000-8000-00000000000a';
const PERSONALITY_ID = '4f9b0f66-5555-4000-8000-00000000000b';
const OWNER_ID = '4f9b0f66-5555-4000-8000-00000000000c';
const DIGEST_ROW_ID = '4f9b0f66-5555-4000-8000-00000000000d';

function setSettings(overrides: Record<string, unknown> = {}): void {
  const values: Record<string, unknown> = {
    recentDaysDigestEnabled: true,
    recentDaysDigestPersonalities: ['nova'],
    ...overrides,
  };
  registerSystemSettings({ get: (key: string) => values[key] } as unknown as SystemSettingsService);
}

function makePair(overrides: Partial<DigestCandidatePair> = {}): DigestCandidatePair {
  return {
    personaId: PERSONA_ID,
    personalityId: PERSONALITY_ID,
    personalitySlug: 'nova',
    ownerId: OWNER_ID,
    ownerTimezone: 'UTC',
    personaName: 'Jules',
    personaPreferredName: null,
    personalityName: 'Nova',
    personalityDisplayName: null,
    epoch: null,
    newestRowAt: new Date('2026-09-17T00:00:00.000Z'),
    windowRowCount: 1,
    digestId: null,
    digestStatus: null,
    digestAttempts: 0,
    sourceWatermark: null,
    generatedAt: null,
    requestedAt: null,
    ...overrides,
  };
}

function makeInvoker(digest: string): SystemModelInvoker {
  return vi.fn().mockResolvedValue({
    content: JSON.stringify({ digest }),
    tokensIn: 10,
    tokensOut: 5,
    provider: AIProvider.ZaiCoding,
    model: 'z-ai/glm-5.2',
  });
}

function fakePrisma(sourceRows: unknown[] = []): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue(sourceRows),
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as unknown as PrismaClient;
}

function sourceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'row-1',
    role: 'user',
    content: 'hello there',
    created_at: new Date('2026-09-17T00:00:00.000Z'),
    channel_id: 'c1',
    guild_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveSystemModelRouteMock.mockReturnValue({ provider: 'zai-coding' });
  storeMocks.materializePendingRows.mockResolvedValue(
    new Map([[`${PERSONA_ID}:${PERSONALITY_ID}`, DIGEST_ROW_ID]])
  );
  storeMocks.storeDigestSuccess.mockResolvedValue(1);
  storeMocks.recordDigestFailure.mockResolvedValue(1);
  storeMocks.readDigestStatus.mockResolvedValue('failed');
});

afterEach(() => resetSystemSettingsRegistration());

describe('sweepRecentDaysDigests gates', () => {
  it('disabled: skips before selecting, invoker never called', async () => {
    setSettings({ recentDaysDigestEnabled: false });
    const invoke = makeInvoker('x');
    const stats = await sweepRecentDaysDigests(fakePrisma(), invoke);
    expect(stats.skipped).toBe('disabled');
    expect(selectDigestCandidatePairsMock).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('empty personality list: skipped no_personalities', async () => {
    setSettings({ recentDaysDigestPersonalities: [] });
    const stats = await sweepRecentDaysDigests(fakePrisma(), makeInvoker('x'));
    expect(stats.skipped).toBe('no_personalities');
    expect(selectDigestCandidatePairsMock).not.toHaveBeenCalled();
  });

  it('an OpenRouter route: skipped route, no write', async () => {
    setSettings();
    resolveSystemModelRouteMock.mockReturnValue({ provider: 'openrouter' });
    const invoke = makeInvoker('x');
    const stats = await sweepRecentDaysDigests(fakePrisma(), invoke);
    expect(stats.skipped).toBe('route');
    expect(selectDigestCandidatePairsMock).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(storeMocks.storeDigestSuccess).not.toHaveBeenCalled();
    expect(storeMocks.recordDigestFailure).not.toHaveBeenCalled();
  });

  it('no candidates: selected 0, nothing else runs', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([]);
    const stats = await sweepRecentDaysDigests(fakePrisma(), makeInvoker('x'));
    expect(stats.selected).toBe(0);
    expect(storeMocks.materializePendingRows).not.toHaveBeenCalled();
  });
});

describe('sweepRecentDaysDigests generation', () => {
  it('a clean digest is stored as generated', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([makePair()]);
    const prisma = fakePrisma([sourceRow()]);
    const invoke = makeInvoker('Jules and Nova talked about the weekend.');

    const stats = await sweepRecentDaysDigests(prisma, invoke);

    expect(stats.generated).toBe(1);
    expect(storeMocks.storeDigestSuccess).toHaveBeenCalledTimes(1);
    expect(usageLogMock).toHaveBeenCalledTimes(1);
  });

  it('C7: a generation with one regeneration writes exactly two usage rows', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([makePair()]);
    const prisma = fakePrisma([sourceRow()]);
    // First pass: contains "I" (first person) -> triggers exactly one regen.
    // Second pass: clean.
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce({
        content: JSON.stringify({ digest: 'I promised to help Jules.' }),
        tokensIn: 10,
        tokensOut: 5,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ digest: 'Nova promised to help Jules.' }),
        tokensIn: 10,
        tokensOut: 5,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      });

    await sweepRecentDaysDigests(prisma, invoke);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(usageLogMock).toHaveBeenCalledTimes(2);
    for (const call of usageLogMock.mock.calls) {
      expect(call[2]).toMatchObject({ ownerId: OWNER_ID, personalityId: PERSONALITY_ID });
    }
  });

  it('C8: a soft-cap-length-alone first pass triggers exactly one regeneration and stores the second digest', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([makePair()]);
    const prisma = fakePrisma([sourceRow()]);

    // First pass: valid on every validator (third person, no lifted
    // assistant 8-gram) but its token count sits strictly between the soft
    // and hard caps — confirmed via countTextTokens so the fixture can't
    // silently drift out of the band.
    const overSoftDigest = 'word '.repeat(400);
    const overSoftTokens = countTextTokens(overSoftDigest);
    expect(overSoftTokens).toBeGreaterThan(RECENT_DAYS_DIGEST.SOFT_CAP_TOKENS);
    expect(overSoftTokens).toBeLessThanOrEqual(RECENT_DAYS_DIGEST.HARD_CAP_TOKENS);

    const secondDigest = 'Nova and Jules talked about weekend plans.';
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce({
        content: JSON.stringify({ digest: overSoftDigest }),
        tokensIn: 10,
        tokensOut: 5,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ digest: secondDigest }),
        tokensIn: 10,
        tokensOut: 5,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      });

    await sweepRecentDaysDigests(prisma, invoke);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(usageLogMock).toHaveBeenCalledTimes(2);
    expect(storeMocks.storeDigestSuccess).toHaveBeenCalledTimes(1);
    expect(storeMocks.storeDigestSuccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: secondDigest })
    );
  });

  it('a parse failure records a billed failure and never regenerates', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([makePair()]);
    const prisma = fakePrisma([sourceRow()]);
    const invoke = vi.fn<SystemModelInvoker>().mockResolvedValue({
      content: 'not json',
      tokensIn: 10,
      tokensOut: 5,
      provider: AIProvider.ZaiCoding,
      model: 'z-ai/glm-5.2',
    });

    const stats = await sweepRecentDaysDigests(prisma, invoke);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(storeMocks.recordDigestFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorClass: 'parse_failure' })
    );
    expect(stats.failedBilled).toBe(1);
  });

  it('a failure write reported dead by readDigestStatus counts toward stats.dead', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([makePair()]);
    storeMocks.readDigestStatus.mockResolvedValue('dead');
    const prisma = fakePrisma([sourceRow()]);
    const invoke = vi.fn<SystemModelInvoker>().mockResolvedValue({
      content: 'not json',
      tokensIn: 10,
      tokensOut: 5,
      provider: AIProvider.ZaiCoding,
      model: 'z-ai/glm-5.2',
    });

    const stats = await sweepRecentDaysDigests(prisma, invoke);
    expect(stats.dead).toBe(1);
    expect(stats.failedBilled).toBe(0);
  });

  it('a 0-affected success write counts as a guard miss, not a generation', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([makePair()]);
    storeMocks.storeDigestSuccess.mockResolvedValue(0);
    const prisma = fakePrisma([sourceRow()]);
    const invoke = makeInvoker('Jules and Nova talked.');

    const stats = await sweepRecentDaysDigests(prisma, invoke);
    expect(stats.guardMisses).toBe(1);
    expect(stats.generated).toBe(0);
  });

  it('a per-pair exception is caught, counted failedZeroSpend, and the loop continues', async () => {
    setSettings();
    selectDigestCandidatePairsMock.mockResolvedValue([
      makePair(),
      makePair({ personalityId: 'other' }),
    ]);
    storeMocks.materializePendingRows.mockResolvedValue(
      new Map([
        [`${PERSONA_ID}:${PERSONALITY_ID}`, DIGEST_ROW_ID],
        [`${PERSONA_ID}:other`, 'other-digest-id'],
      ])
    );
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValue([sourceRow()]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    } as unknown as PrismaClient;
    const invoke = makeInvoker('Jules and Nova talked.');

    const stats = await sweepRecentDaysDigests(prisma, invoke);
    expect(stats.failedZeroSpend).toBe(1);
    expect(stats.generated).toBe(1);
  });
});
