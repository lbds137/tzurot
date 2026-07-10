import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFactExtractionJobUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { FACT_EXTRACTION_QUEUE_NAME, JobType } from '@tzurot/common-types/constants/queue';

const { queueAddMock, queueCloseMock, queryMock } = vi.hoisted(() => ({
  queueAddMock: vi.fn().mockResolvedValue({}),
  queueCloseMock: vi.fn().mockResolvedValue(undefined),
  queryMock: vi.fn(),
}));

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  confirmProductionOperation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({
    prisma: { $queryRawUnsafe: queryMock },
    disconnect: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../inspect/bullmqConnection.js', () => ({
  getRailwayRedisUrl: vi.fn().mockResolvedValue('redis://proxy.example:1234'),
  createInspectorQueue: vi.fn().mockImplementation((_url: string, name: string) => ({
    name,
    add: queueAddMock,
    close: queueCloseMock,
  })),
}));

import { buildWindows, buildJobData, backfillFacts } from './backfill-facts.js';
import { createInspectorQueue } from '../inspect/bullmqConnection.js';
import { confirmProductionOperation } from '../utils/env-runner.js';

const P1 = '4f9b0f66-0000-4000-8000-0000000000a1';
const P2 = '4f9b0f66-0000-4000-8000-0000000000a2';
const PERSONA_X = '4f9b0f66-0000-4000-8000-0000000000b1';
const PERSONA_Y = '4f9b0f66-0000-4000-8000-0000000000b2';
const MEM = (n: number): string =>
  `4f9b0f66-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const row = (id: string, personality: string, persona: string) => ({
  id,
  personality_id: personality,
  persona_id: persona,
});

describe('buildWindows', () => {
  it('groups by (personality, persona) and chunks preserving incoming order', () => {
    const rows = [
      row(MEM(1), P1, PERSONA_X),
      row(MEM(2), P1, PERSONA_X),
      row(MEM(3), P1, PERSONA_X),
      row(MEM(4), P1, PERSONA_Y), // different persona → own group
      row(MEM(5), P2, PERSONA_X), // different personality → own group
    ];

    const windows = buildWindows(rows, 2);

    expect(windows).toEqual([
      {
        personalityId: P1,
        personaId: PERSONA_X,
        sourceMemoryIds: [MEM(1), MEM(2)],
        windowStart: MEM(1),
      },
      { personalityId: P1, personaId: PERSONA_X, sourceMemoryIds: [MEM(3)], windowStart: MEM(3) },
      { personalityId: P1, personaId: PERSONA_Y, sourceMemoryIds: [MEM(4)], windowStart: MEM(4) },
      { personalityId: P2, personaId: PERSONA_X, sourceMemoryIds: [MEM(5)], windowStart: MEM(5) },
    ]);
  });

  it('interleaved group rows still window within their own group in order', () => {
    const rows = [
      row(MEM(1), P1, PERSONA_X),
      row(MEM(2), P1, PERSONA_Y),
      row(MEM(3), P1, PERSONA_X),
    ];

    const windows = buildWindows(rows, 6);

    expect(windows).toContainEqual(
      expect.objectContaining({ personaId: PERSONA_X, sourceMemoryIds: [MEM(1), MEM(3)] })
    );
    expect(windows).toContainEqual(
      expect.objectContaining({ personaId: PERSONA_Y, sourceMemoryIds: [MEM(2)] })
    );
  });

  it.each([0, Number.NaN, 2.5, 101])(
    'rejects invalid window size %s (NaN would silently truncate chunks; >100 exceeds the worker take cap)',
    bad => {
      expect(() => buildWindows([], bad)).toThrow('windowSize must be an integer in 1..100');
    }
  );
});

describe('buildJobData', () => {
  it('produces the exact worker payload: backfill sentinel, budget exemption, deterministic anchor', () => {
    const { jobId, jobData } = buildJobData({
      personalityId: P1,
      personaId: PERSONA_X,
      sourceMemoryIds: [MEM(1), MEM(2)],
      windowStart: MEM(1),
    });

    expect(jobId).toBe(generateFactExtractionJobUuid('backfill', P1, MEM(1)));
    expect(jobData).toEqual({
      requestId: `fact-backfill-${generateFactExtractionJobUuid('backfill', P1, MEM(1))}`,
      jobType: JobType.FactExtraction,
      responseDestination: { type: 'api' },
      version: 1,
      channelId: 'backfill',
      personalityId: P1,
      sourceMemoryIds: [MEM(1), MEM(2)],
      windowStart: MEM(1),
      budgetExempt: true,
    });
  });
});

describe('backfillFacts (the queue.add seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // First query: eligible rows; second query: covered ids.
    queryMock
      .mockResolvedValueOnce([
        row(MEM(1), P1, PERSONA_X),
        row(MEM(2), P1, PERSONA_X),
        row(MEM(3), P1, PERSONA_X),
      ])
      .mockResolvedValueOnce([{ src: MEM(3) }]); // MEM(3) already covered by a fact
  });

  it('enqueues windows with live-parity options plus the backfill deltas', async () => {
    await backfillFacts({ env: 'dev', windowSize: 2 });

    expect(createInspectorQueue).toHaveBeenCalledWith(
      'redis://proxy.example:1234',
      FACT_EXTRACTION_QUEUE_NAME
    );
    // MEM(3) is covered → one window of [MEM(1), MEM(2)]
    expect(queueAddMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledWith(
      JobType.FactExtraction,
      expect.objectContaining({
        channelId: 'backfill',
        budgetExempt: true,
        sourceMemoryIds: [MEM(1), MEM(2)],
      }),
      expect.objectContaining({
        jobId: generateFactExtractionJobUuid('backfill', P1, MEM(1)),
        priority: 10, // live (unprioritized) extraction always jumps the backfill
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      })
    );
    expect(queueCloseMock).toHaveBeenCalled();
  });

  it('dry-run reports scope without touching Redis', async () => {
    await backfillFacts({ env: 'dev', dryRun: true });

    expect(createInspectorQueue).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('--limit caps the enqueued windows (canary)', async () => {
    await backfillFacts({ env: 'dev', windowSize: 1, limit: 1 });

    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  it('a declined prod confirmation ABORTS the run (the gate is real, not decorative)', async () => {
    vi.mocked(confirmProductionOperation).mockResolvedValueOnce(false);

    await backfillFacts({ env: 'prod' });

    expect(createInspectorQueue).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('a NaN --limit fails LOUDLY instead of silently uncapping the canary', async () => {
    // NaN < windows.length is false — without the guard, a mistyped
    // `--limit 5o` would enqueue the FULL budget-exempt run instead of 5.
    await expect(backfillFacts({ env: 'dev', limit: Number('5o') })).rejects.toThrow(
      '--limit must be a positive integer'
    );
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('--personality-id threads the parameterized filter into the eligible query', async () => {
    await backfillFacts({ env: 'dev', windowSize: 3, personalityId: P1, dryRun: true });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('AND personality_id = $1::uuid'),
      P1
    );
  });

  it('--include-covered skips the covered-set subtraction', async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce([
      row(MEM(1), P1, PERSONA_X),
      row(MEM(2), P1, PERSONA_X),
      row(MEM(3), P1, PERSONA_X),
    ]);

    await backfillFacts({ env: 'dev', windowSize: 3, includeCovered: true });

    expect(queryMock).toHaveBeenCalledTimes(1); // no covered query
    expect(queueAddMock).toHaveBeenCalledWith(
      JobType.FactExtraction,
      expect.objectContaining({ sourceMemoryIds: [MEM(1), MEM(2), MEM(3)] }),
      expect.anything()
    );
  });
});
