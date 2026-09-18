import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { DigestCandidatePair } from '@tzurot/common-types/services/recentDaysDigestSelection';
import type { SystemModelInvoker, SystemModelResult } from '../systemModel/systemModelCall.js';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import type { DigestPromptInput } from './recentDaysDigestPrompt.js';
import type { DigestSourceRow } from './recentDaysDigestInput.js';

const usageLogMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./recentDaysDigestUsageLog.js', () => ({ writeRecentDaysDigestUsageLog: usageLogMock }));

const { runGeneration, buildPairGenerationContext } =
  await import('./recentDaysDigestGeneration.js');

const PERSONA_ID = '4f9b0f66-5555-4000-8000-00000000000a';
const PERSONALITY_ID = '4f9b0f66-5555-4000-8000-00000000000b';
const OWNER_ID = '4f9b0f66-5555-4000-8000-00000000000c';

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

function fakePrisma(): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as unknown as PrismaClient;
}

function makePromptInput(): DigestPromptInput {
  return {
    personaLabel: 'Jules',
    characterLabel: 'Nova',
    lines: ['[2026-09-17] [DMs] Jules: hello there'],
    truncated: false,
    windowStart: new Date('2026-09-17T00:00:00.000Z'),
    tz: 'UTC',
  };
}

function modelResult(overrides: Partial<SystemModelResult> = {}): SystemModelResult {
  return {
    content: JSON.stringify({ digest: 'Nova and Jules talked about the weekend.' }),
    tokensIn: 10,
    tokensOut: 5,
    provider: AIProvider.ZaiCoding,
    model: 'z-ai/glm-5.2',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runGeneration', () => {
  it('a clean first pass succeeds without a regeneration', async () => {
    const invoke = vi.fn<SystemModelInvoker>().mockResolvedValue(modelResult());
    const outcome = await runGeneration({
      prisma: fakePrisma(),
      pair: makePair(),
      invoke,
      promptInput: makePromptInput(),
      assistantContents: [],
    });

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.text).toBe('Nova and Jules talked about the weekend.');
      expect(outcome.regen).toBeUndefined();
    }
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('a first-person first pass regenerates cleanly', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce(
        modelResult({ content: JSON.stringify({ digest: 'I promised to help.' }) })
      )
      .mockResolvedValueOnce(
        modelResult({ content: JSON.stringify({ digest: 'Nova promised to help.' }) })
      );

    const outcome = await runGeneration({
      prisma: fakePrisma(),
      pair: makePair(),
      invoke,
      promptInput: makePromptInput(),
      assistantContents: [],
    });

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.text).toBe('Nova promised to help.');
      expect(outcome.regen).toBeDefined();
    }
    expect(outcome.firstPass.validation).toEqual({
      ok: false,
      cls: 'first_person',
      detail: 'I',
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('a first-pass parse failure is terminal, raw text preserved, no regeneration', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValue(modelResult({ content: 'not json' }));

    const outcome = await runGeneration({
      prisma: fakePrisma(),
      pair: makePair(),
      invoke,
      promptInput: makePromptInput(),
      assistantContents: [],
    });

    expect(outcome.kind).toBe('parse_failure');
    expect(outcome.firstPass.raw).toBe('not json');
    expect(outcome.firstPass.parsed).toBeNull();
    expect(outcome.regen).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('a regen-pass parse failure carries both passes, regen.raw preserved', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce(
        modelResult({ content: JSON.stringify({ digest: 'I promised to help.' }) })
      )
      .mockResolvedValueOnce(modelResult({ content: 'still not json' }));

    const outcome = await runGeneration({
      prisma: fakePrisma(),
      pair: makePair(),
      invoke,
      promptInput: makePromptInput(),
      assistantContents: [],
    });

    expect(outcome.kind).toBe('parse_failure');
    expect(outcome.firstPass).toBeDefined();
    expect(outcome.regen).toBeDefined();
    expect(outcome.regen?.raw).toBe('still not json');
    expect(outcome.regen?.parsed).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('a final validation failure returns failed with cls/detail', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce(
        modelResult({ content: JSON.stringify({ digest: 'I promised to help.' }) })
      )
      .mockResolvedValueOnce(
        modelResult({ content: JSON.stringify({ digest: 'We promised to help.' }) })
      );

    const outcome = await runGeneration({
      prisma: fakePrisma(),
      pair: makePair(),
      invoke,
      promptInput: makePromptInput(),
      assistantContents: [],
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.cls).toBe('first_person');
      expect(outcome.detail).toBe('We');
    }
  });

  it('writeUsage: false bills the model but never writes a usage row', async () => {
    const invoke = vi.fn<SystemModelInvoker>().mockResolvedValue(modelResult());

    await runGeneration({
      prisma: fakePrisma(),
      pair: makePair(),
      invoke,
      promptInput: makePromptInput(),
      assistantContents: [],
      writeUsage: false,
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(usageLogMock).not.toHaveBeenCalled();
  });

  it('writeUsage default (true) writes one usage row per pass', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce(
        modelResult({ content: JSON.stringify({ digest: 'I promised to help.' }) })
      )
      .mockResolvedValueOnce(
        modelResult({ content: JSON.stringify({ digest: 'Nova promised to help.' }) })
      );

    await runGeneration({
      prisma: fakePrisma(),
      pair: makePair(),
      invoke,
      promptInput: makePromptInput(),
      assistantContents: [],
    });

    expect(usageLogMock).toHaveBeenCalledTimes(2);
  });
});

function digestRow(overrides: Partial<DigestSourceRow> = {}): DigestSourceRow {
  return {
    id: 'row-1',
    role: MessageRole.User,
    content: 'hello there',
    createdAt: new Date('2026-09-17T00:00:00.000Z'),
    channelId: 'c1',
    guildId: null,
    ...overrides,
  };
}

describe('buildPairGenerationContext', () => {
  it('prefers the preferred/display names and falls back to the raw names', () => {
    const fellBack = buildPairGenerationContext(
      makePair({ personaPreferredName: null, personalityDisplayName: null }),
      [digestRow()]
    );
    expect(fellBack.promptInput.personaLabel).toBe('Jules');
    expect(fellBack.promptInput.characterLabel).toBe('Nova');

    const preferred = buildPairGenerationContext(
      makePair({ personaPreferredName: 'Julia', personalityDisplayName: 'Nova Prime' }),
      [digestRow()]
    );
    expect(preferred.promptInput.personaLabel).toBe('Julia');
    expect(preferred.promptInput.characterLabel).toBe('Nova Prime');
  });

  it('collects only the assistant rows content, in row order', () => {
    const ctx = buildPairGenerationContext(makePair(), [
      digestRow({ id: 'r1', role: MessageRole.User, content: 'user one' }),
      digestRow({ id: 'r2', role: MessageRole.Assistant, content: 'assistant one' }),
      digestRow({ id: 'r3', role: MessageRole.User, content: 'user two' }),
      digestRow({ id: 'r4', role: MessageRole.Assistant, content: 'assistant two' }),
    ]);

    expect(ctx.assistantContents).toEqual(['assistant one', 'assistant two']);
  });

  it('agrees with the window on truncation, both ways', () => {
    const underCap = buildPairGenerationContext(
      makePair(),
      Array.from({ length: RECENT_DAYS_DIGEST.MAX_SOURCE_MESSAGES }, (_unused, index) =>
        digestRow({ id: `row-${index}`, content: 'hi' })
      )
    );
    expect(underCap.windowInput.truncated).toBe(false);
    expect(underCap.promptInput.truncated).toBe(false);

    const overCap = buildPairGenerationContext(
      makePair(),
      Array.from({ length: RECENT_DAYS_DIGEST.MAX_SOURCE_MESSAGES + 1 }, (_unused, index) =>
        digestRow({ id: `row-${index}`, content: 'hi' })
      )
    );
    expect(overCap.windowInput.truncated).toBe(true);
    expect(overCap.promptInput.truncated).toBe(true);
  });
});
