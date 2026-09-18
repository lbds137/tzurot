import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { DigestCandidatePair } from '@tzurot/common-types/services/recentDaysDigestSelection';
import type { SystemModelInvoker } from '../systemModel/systemModelCall.js';

const usageLogMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./recentDaysDigestUsageLog.js', () => ({ writeRecentDaysDigestUsageLog: usageLogMock }));

const { dryRunDigestForPair, printDryRunReport } = await import('./recentDaysDigestDryRun.js');

const PERSONA_ID = '4f9b0f66-6666-4000-8000-00000000000a';
const PERSONALITY_ID = '4f9b0f66-6666-4000-8000-00000000000b';
const OWNER_ID = '4f9b0f66-6666-4000-8000-00000000000c';
const NOW = new Date('2026-09-18T00:00:00.000Z');

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

function fakePrisma(sourceRows: unknown[] = []): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue(sourceRows),
    $executeRaw: vi.fn().mockResolvedValue(1),
  } as unknown as PrismaClient;
}

function modelResult(content: string): {
  content: string;
  tokensIn: number;
  tokensOut: number;
  provider: AIProvider;
  model: string;
} {
  return {
    content,
    tokensIn: 10,
    tokensOut: 5,
    provider: AIProvider.ZaiCoding,
    model: 'z-ai/glm-5.2',
  };
}

describe('dryRunDigestForPair', () => {
  it('a clean first pass produces a success outcome and a populated window', async () => {
    const prisma = fakePrisma([sourceRow()]);
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValue(modelResult(JSON.stringify({ digest: 'Jules and Nova talked.' })));

    const report = await dryRunDigestForPair(prisma, { pair: makePair(), invoke, now: NOW });

    expect(report.outcome.kind).toBe('success');
    expect(report.window.rowCount).toBe(1);
    expect(report.window.inputTokens).toBeGreaterThan(0);
    expect(usageLogMock).not.toHaveBeenCalled();
  });

  it('a first-person first pass then a clean regen produces success with a regen pass', async () => {
    const prisma = fakePrisma([sourceRow()]);
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce(modelResult(JSON.stringify({ digest: 'I promised to help Jules.' })))
      .mockResolvedValueOnce(
        modelResult(JSON.stringify({ digest: 'Nova promised to help Jules.' }))
      );

    const report = await dryRunDigestForPair(prisma, { pair: makePair(), invoke, now: NOW });

    expect(report.outcome.kind).toBe('success');
    expect(report.outcome.regen).toBeDefined();
    expect(usageLogMock).not.toHaveBeenCalled();
  });

  it('a parse failure carries the unparseable raw text and never calls the usage log', async () => {
    const prisma = fakePrisma([sourceRow()]);
    const invoke = vi.fn<SystemModelInvoker>().mockResolvedValue(modelResult('not json'));

    const report = await dryRunDigestForPair(prisma, { pair: makePair(), invoke, now: NOW });

    expect(report.outcome.kind).toBe('parse_failure');
    expect(report.outcome.firstPass.raw).toBe('not json');
    expect(usageLogMock).not.toHaveBeenCalled();
  });
});

describe('printDryRunReport', () => {
  async function buildReport(
    invoke: SystemModelInvoker
  ): Promise<Awaited<ReturnType<typeof dryRunDigestForPair>>> {
    const prisma = fakePrisma([sourceRow()]);
    return dryRunDigestForPair(prisma, { pair: makePair(), invoke, now: NOW });
  }

  it('prints the no-write header line', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValue(modelResult(JSON.stringify({ digest: 'Jules and Nova talked.' })));
    const output = printDryRunReport(await buildReport(invoke));
    expect(output).toContain(
      'DRY RUN — no digest row written, no usage row written; the model call WAS billed'
    );
    expect(output).toContain('(raw, 10 tokens in, 5 tokens out,');
    expect(output).toContain('estimatedInputTokens=');
  });

  it('prints each pass raw text verbatim', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce(modelResult(JSON.stringify({ digest: 'I promised to help Jules.' })))
      .mockResolvedValueOnce(
        modelResult(JSON.stringify({ digest: 'Nova promised to help Jules.' }))
      );
    const output = printDryRunReport(await buildReport(invoke));
    expect(output).toContain(JSON.stringify({ digest: 'I promised to help Jules.' }));
    expect(output).toContain(JSON.stringify({ digest: 'Nova promised to help Jules.' }));
  });

  it('a failed outcome renders both the class and the detail', async () => {
    const invoke = vi
      .fn<SystemModelInvoker>()
      .mockResolvedValueOnce(modelResult(JSON.stringify({ digest: 'I promised to help Jules.' })))
      .mockResolvedValueOnce(modelResult(JSON.stringify({ digest: 'We promised to help Jules.' })));
    const output = printDryRunReport(await buildReport(invoke));
    expect(output).toContain('final: failed first_person: We');
  });

  it('a parse failure renders "(did not parse)"', async () => {
    const invoke = vi.fn<SystemModelInvoker>().mockResolvedValue(modelResult('not json'));
    const output = printDryRunReport(await buildReport(invoke));
    expect(output).toContain('verdict: (did not parse)');
    expect(output).toContain('final: parse_failure');
  });
});
