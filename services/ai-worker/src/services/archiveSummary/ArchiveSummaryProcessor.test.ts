import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { ArchiveSummaryJobData } from '@tzurot/common-types/types/jobs';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import type { SystemModelInvoker, SystemModelResult } from '../systemModel/systemModelCall.js';
import type { ArchiveSummaryBudget } from './ArchiveSummaryBudget.js';
import { ROUTE_ERROR_LOG_INTERVAL_MS } from './constants.js';

const resolveSystemModelRouteMock = vi.hoisted(() =>
  // 'zai-coding' inlined rather than AIProvider.ZaiCoding: vi.hoisted() runs
  // before the module's own imports are evaluated, so referencing an
  // imported binding here throws a TDZ ReferenceError.
  vi.fn().mockReturnValue({ provider: 'zai-coding' })
);
vi.mock('../systemModel/systemModelCall.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../systemModel/systemModelCall.js')>();
  return { ...actual, resolveSystemModelRoute: resolveSystemModelRouteMock };
});

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: mockLoggerError,
      debug: vi.fn(),
      fatal: vi.fn(),
    }),
  };
});

const { ArchiveSummaryProcessor, __resetRouteErrorThrottleForTests } =
  await import('./ArchiveSummaryProcessor.js');

const MEMORY_ID = '4f9b0f66-4444-4000-8000-00000000000a';
const PERSONALITY_ID = '4f9b0f66-4444-4000-8000-00000000000b';
const PERSONA_ID = '4f9b0f66-4444-4000-8000-00000000000c';
const OWNER_ID = '4f9b0f66-4444-4000-8000-00000000000d';

function setSettings(overrides: Record<string, unknown> = {}): void {
  const values: Record<string, unknown> = {
    archiveSummaryModelEnabled: true,
    archiveSummaryDailyCap: 2000,
    ...overrides,
  };
  registerSystemSettings({ get: (key: string) => values[key] } as unknown as SystemSettingsService);
}

function makeJobHandle(): {
  id: string;
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
} {
  return {
    id: 'job-1',
    moveToDelayed: vi
      .fn<(timestamp: number, token?: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function makeJobData(overrides: Partial<ArchiveSummaryJobData> = {}): ArchiveSummaryJobData {
  return {
    requestId: 'req-1',
    jobType: JobType.ArchiveSummary,
    responseDestination: { type: 'api' },
    version: 1,
    memoryId: MEMORY_ID,
    personalityId: PERSONALITY_ID,
    reason: 'write',
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEMORY_ID,
    content: '{user}: hi there\n{assistant}: hello!',
    personality_id: PERSONALITY_ID,
    persona_id: PERSONA_ID,
    owner_id: OWNER_ID,
    summary_status: null,
    summary_attempts: 0,
    source_content_hash: null,
    summary_prompt_version: null,
    persona_name: 'Jules',
    personality_name: 'Nova',
    ...overrides,
  };
}

function makePrisma(row: Record<string, unknown> | null): PrismaClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue(row === null ? [] : [row]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    usageLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PrismaClient;
}

/** `refundSpy` is exposed alongside the mock so tests can assert the
 *  per-charge refund closure was actually invoked — asserting on the budget
 *  object's own (nonexistent) `refund` method would silently pass. */
function makeBudget(
  allowed = true
): ArchiveSummaryBudget & { refundSpy: ReturnType<typeof vi.fn> } {
  const refundSpy = vi.fn().mockResolvedValue(undefined);
  return {
    tryConsume: vi.fn().mockResolvedValue({ allowed, refund: refundSpy }),
    refundSpy,
  } as unknown as ArchiveSummaryBudget & { refundSpy: ReturnType<typeof vi.fn> };
}

function makeInvoker(content: string): SystemModelInvoker {
  return vi.fn().mockResolvedValue({
    content,
    tokensIn: 10,
    tokensOut: 20,
    provider: AIProvider.ZaiCoding,
    model: 'z-ai/glm-5.2',
  } satisfies SystemModelResult);
}

// MEM-ARCH-013 (the enqueue decision itself) is enforced upstream by
// ArchiveSummaryTrigger/PgvectorMemoryAdapter — this suite covers
// post-enqueue processing only.
describe('ArchiveSummaryProcessor', () => {
  beforeEach(() => {
    setSettings();
    resolveSystemModelRouteMock.mockReturnValue({ provider: AIProvider.ZaiCoding });
  });

  afterEach(() => {
    resetSystemSettingsRegistration();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('missing row: returns skipped, makes no model call', async () => {
    const prisma = makePrisma(null);
    const budget = makeBudget();
    const invokeModel = makeInvoker('{"summary": "x"}');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'skipped' });
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it('already-current skip: matching hash, prompt version, and done status skips with no call', async () => {
    const content = '{user}: hi there\n{assistant}: hello!';
    const hash = (await import('crypto')).createHash('sha256').update(content).digest('hex');
    const prisma = makePrisma(
      makeRow({
        content,
        source_content_hash: hash,
        summary_prompt_version: 1,
        summary_status: 'done',
      })
    );
    const budget = makeBudget();
    const invokeModel = makeInvoker('{"summary": "x"}');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'skipped' });
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-014: the model-switch-off gate delays without a model call', async () => {
    setSettings({ archiveSummaryModelEnabled: false });
    const prisma = makePrisma(makeRow());
    const budget = makeBudget();
    const invokeModel = makeInvoker('{"summary": "x"}');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });
    const job = makeJobHandle();

    await expect(processor.process(job, 'tok', makeJobData())).rejects.toThrow();

    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it('the OpenRouter-route gate delays, logs once inside the throttle window, and logs again past it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    __resetRouteErrorThrottleForTests();
    mockLoggerError.mockClear();
    resolveSystemModelRouteMock.mockReturnValue({ provider: AIProvider.OpenRouter });
    const prisma = makePrisma(makeRow());
    const budget = makeBudget();
    const invokeModel = makeInvoker('{"summary": "x"}');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    await expect(processor.process(makeJobHandle(), 'tok', makeJobData())).rejects.toThrow();
    await expect(processor.process(makeJobHandle(), 'tok', makeJobData())).rejects.toThrow();

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ provider: AIProvider.OpenRouter }),
      expect.any(String)
    );
    expect(invokeModel).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime() + ROUTE_ERROR_LOG_INTERVAL_MS);

    await expect(processor.process(makeJobHandle(), 'tok', makeJobData())).rejects.toThrow();

    expect(mockLoggerError).toHaveBeenCalledTimes(2);
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it('budget-exhausted gate delays without a model call and refunds the denied charge', async () => {
    const prisma = makePrisma(makeRow());
    const budget = makeBudget(false);
    const invokeModel = makeInvoker('{"summary": "x"}');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });
    const job = makeJobHandle();

    await expect(processor.process(job, 'tok', makeJobData())).rejects.toThrow();
    expect(invokeModel).not.toHaveBeenCalled();
    expect(budget.refundSpy).toHaveBeenCalledTimes(1);
  });

  it('MEM-ARCH-015: no-template content is marked dead with the invoker never called, and consumes no budget', async () => {
    const prisma = makePrisma(makeRow({ content: 'not the template shape at all' }));
    const budget = makeBudget();
    const invokeModel = makeInvoker('{"summary": "x"}');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'dead' });
    expect(invokeModel).not.toHaveBeenCalled();
    expect(budget.tryConsume).not.toHaveBeenCalled();
  });

  it('a content edit under the job (0 rows affected) yields superseded, not done', async () => {
    const prisma = makePrisma(makeRow());
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const budget = makeBudget();
    const invokeModel = makeInvoker(
      '{"summary": "Jules greeted Nova and Nova greeted them back."}'
    );
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'superseded' });
  });

  it('MEM-ARCH-023: writes a usage row even when the response fails to parse (a parse failure still spent tokens)', async () => {
    const prisma = makePrisma(makeRow());
    const budget = makeBudget();
    const invokeModel = makeInvoker('not json at all');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'failed' });
    expect(prisma.usageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestType: 'archive_summary', userId: OWNER_ID }),
      })
    );
  });

  it('MEM-ARCH-017: a summary still over the hard cap after regeneration is a billed overflow failure, never truncated', async () => {
    const longSummary = `{"summary": "${'word '.repeat(150).trim()}"}`;
    const prisma = makePrisma(makeRow());
    const budget = makeBudget();
    const invokeModel = vi.fn().mockResolvedValue({
      content: longSummary,
      tokensIn: 10,
      tokensOut: 200,
      provider: AIProvider.ZaiCoding,
      model: 'z-ai/glm-5.2',
    } satisfies SystemModelResult);
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'failed' });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('MEM-ARCH-018: a summary still first-person after regeneration is a billed first_person failure', async () => {
    const prisma = makePrisma(makeRow());
    const budget = makeBudget();
    const invokeModel = vi
      .fn()
      // first pass: first-person leak triggers regeneration
      .mockResolvedValueOnce({
        content: '{"summary": "I really enjoyed that conversation."}',
        tokensIn: 10,
        tokensOut: 10,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult)
      // regeneration: STILL first-person
      .mockResolvedValueOnce({
        content: '{"summary": "I still really enjoyed that conversation."}',
        tokensIn: 10,
        tokensOut: 10,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult);
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'failed' });
    expect(invokeModel).toHaveBeenCalledTimes(2);
    // Assert the SQL args crossing the store seam carry the first_person error
    // class and the content guard — not just the return value, which a wiring
    // bug could fake.
    const executeRawCalls = (prisma.$executeRaw as ReturnType<typeof vi.fn>).mock.calls;
    const lastCallArgs = executeRawCalls[executeRawCalls.length - 1] as unknown[];
    expect(lastCallArgs.slice(1)).toContain('first_person');
    expect(lastCallArgs.slice(1)).toContain('{user}: hi there\n{assistant}: hello!');
  });

  it('a clean short summary succeeds on the first pass', async () => {
    const prisma = makePrisma(makeRow());
    const budget = makeBudget();
    const invokeModel = makeInvoker(
      '{"summary": "Jules greeted Nova and Nova greeted them back."}'
    );
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'done' });
    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('MEM-ARCH-019: the referent check runs only for referenced rows', async () => {
    const withRef = makePrisma(
      makeRow({
        content:
          '{user}: yeah lets do it\n\n[Referenced content: a prior plan to hike]\n{assistant}: great, see you then',
      })
    );
    const budget = makeBudget();
    const invokeModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: '{"summary": "Jules confirmed the hiking plan with Nova."}',
        tokensIn: 10,
        tokensOut: 10,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult)
      .mockResolvedValueOnce({
        content: '{"dangling": []}',
        tokensIn: 5,
        tokensOut: 5,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult);
    const processor = new ArchiveSummaryProcessor({ prisma: withRef, budget, invokeModel });

    await processor.process(makeJobHandle(), undefined, makeJobData());
    expect(invokeModel).toHaveBeenCalledTimes(2);

    const noRef = makePrisma(makeRow());
    const invokeModel2 = makeInvoker('{"summary": "Jules greeted Nova."}');
    const processor2 = new ArchiveSummaryProcessor({
      prisma: noRef,
      budget,
      invokeModel: invokeModel2,
    });
    await processor2.process(makeJobHandle(), undefined, makeJobData());
    expect(invokeModel2).toHaveBeenCalledTimes(1);
  });

  it('a rejecting invoker is a zero-spend throw: refunds the budget, writes nothing, rethrows', async () => {
    const prisma = makePrisma(makeRow());
    const budget = makeBudget();
    const invokeModel = vi.fn().mockRejectedValue(new Error('timeout'));
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    await expect(processor.process(makeJobHandle(), undefined, makeJobData())).rejects.toThrow(
      'timeout'
    );

    expect(budget.refundSpy).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('a throw after a billed call does not refund: the write fails post-invoke, error rethrows', async () => {
    const prisma = makePrisma(makeRow());
    // The store writers are raw SQL; failing $executeRaw fails the success
    // write AFTER the model call already returned and was billed.
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('write failed'));
    const budget = makeBudget();
    const invokeModel = makeInvoker('{"summary": "Jules greeted Nova."}');
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    await expect(processor.process(makeJobHandle(), undefined, makeJobData())).rejects.toThrow(
      'write failed'
    );

    expect(invokeModel).toHaveBeenCalledTimes(1);
    expect(budget.refundSpy).not.toHaveBeenCalled();
  });

  it('MEM-ARCH-019: the regeneration path carries the dangling names into the invoker prompt', async () => {
    const prisma = makePrisma(
      makeRow({
        content:
          '{user}: yeah lets do it\n\n[Referenced content: a prior plan to hike]\n{assistant}: great, see you then',
      })
    );
    const budget = makeBudget();
    const invokeModel = vi
      .fn()
      // first summarizer call — long enough to force regeneration
      .mockResolvedValueOnce({
        content: `{"summary": "${'word '.repeat(90).trim()}"}`,
        tokensIn: 10,
        tokensOut: 10,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult)
      // referent check on first pass — dangling
      .mockResolvedValueOnce({
        content: '{"dangling": ["the plan"]}',
        tokensIn: 5,
        tokensOut: 5,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult)
      // regeneration call
      .mockResolvedValueOnce({
        content: '{"summary": "Jules confirmed the hiking plan with Nova."}',
        tokensIn: 10,
        tokensOut: 10,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult)
      // referent check on regenerated summary — clean
      .mockResolvedValueOnce({
        content: '{"dangling": []}',
        tokensIn: 5,
        tokensOut: 5,
        provider: AIProvider.ZaiCoding,
        model: 'z-ai/glm-5.2',
      } satisfies SystemModelResult);
    const processor = new ArchiveSummaryProcessor({ prisma, budget, invokeModel });

    const result = await processor.process(makeJobHandle(), undefined, makeJobData());

    expect(result).toEqual({ outcome: 'done' });
    expect(invokeModel).toHaveBeenCalledTimes(4);
    const regeneratePrompt = invokeModel.mock.calls[2][0] as string;
    expect(regeneratePrompt).toContain('the plan');
  });
});
