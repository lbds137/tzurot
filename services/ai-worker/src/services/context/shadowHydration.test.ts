import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return { ...actual, createLogger: () => mockLogger };
});

import { isShadowHydrationEnabled, shadowHydrateAndDiff } from './shadowHydration.js';
import type { ContextDataSource } from './types.js';
import type { JobContext, ResolvedConfigOverrides } from '@tzurot/common-types';

function makeDataSource(overrides: Partial<ContextDataSource> = {}): ContextDataSource {
  return {
    getChannelHistory: vi.fn().mockResolvedValue([]),
    getCrossChannelHistory: vi.fn().mockResolvedValue([]),
    getUserTimezone: vi.fn().mockResolvedValue('UTC'),
    getContextEpoch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeOverrides(partial: Partial<ResolvedConfigOverrides> = {}): ResolvedConfigOverrides {
  return {
    maxMessages: 20,
    maxAge: null,
    maxImages: 5,
    memoryScoreThreshold: 0.3,
    memoryLimit: 20,
    focusModeEnabled: false,
    crossChannelHistoryEnabled: false,
    shareLtmAcrossPersonalities: false,
    showModelFooter: false,
    voiceResponseMode: 'never',
    voiceTranscriptionEnabled: false,
    ...partial,
  } as ResolvedConfigOverrides;
}

function makeJobContext(partial: Partial<JobContext> = {}): JobContext {
  return {
    userId: 'discord-user-1',
    userInternalId: 'internal-1',
    channelId: 'chan-1',
    activePersonaId: 'persona-1',
    conversationHistory: [
      { id: 'm1', role: 'user', content: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello' },
    ],
    ...partial,
  } as JobContext;
}

describe('isShadowHydrationEnabled', () => {
  it('is enabled only by the exact string "true"', () => {
    expect(
      isShadowHydrationEnabled({ CONTEXT_SHADOW_HYDRATION: 'true' } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(isShadowHydrationEnabled({ CONTEXT_SHADOW_HYDRATION: '1' } as NodeJS.ProcessEnv)).toBe(
      false
    );
    expect(isShadowHydrationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('shadowHydrateAndDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a matched summary when hydration agrees with the payload', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext(),
      personalityId: 'pers-1',
      configOverrides: makeOverrides(),
      dataSource,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        historyDiff: expect.objectContaining({ missingFromHydrated: 0, extraInHydrated: 0 }),
        timezoneMatch: true,
      }),
      expect.stringContaining('matched')
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('tolerates extra hydrated rows (post-fetch persistence drift) as a match', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }, { id: 'm3-new' }]),
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext(),
      personalityId: 'pers-1',
      configOverrides: makeOverrides(),
      dataSource,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        historyDiff: expect.objectContaining({ extraInHydrated: 1, missingFromHydrated: 0 }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('warns when payload rows are missing from hydration', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }]),
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext(),
      personalityId: 'pers-1',
      configOverrides: makeOverrides(),
      dataSource,
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        historyDiff: expect.objectContaining({ missingFromHydrated: 1 }),
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('warns on a timezone mismatch', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
      getUserTimezone: vi.fn().mockResolvedValue('America/New_York'),
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext({ userTimezone: undefined }),
      personalityId: 'pers-1',
      configOverrides: makeOverrides(),
      dataSource,
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timezoneMatch: false }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('passes the hydrated epoch into the history query', async () => {
    const epoch = new Date('2026-05-01T00:00:00Z');
    const getChannelHistory = vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    const dataSource = makeDataSource({
      getContextEpoch: vi.fn().mockResolvedValue(epoch),
      getChannelHistory,
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext(),
      personalityId: 'pers-1',
      configOverrides: makeOverrides({ maxMessages: 30, maxAge: 7200 }),
      dataSource,
    });

    expect(getChannelHistory).toHaveBeenCalledWith('chan-1', 30, epoch, 7200);
  });

  it('hydrates cross-channel groups only when enabled and not weigh-in', async () => {
    const getCrossChannelHistory = vi.fn().mockResolvedValue([{ channelId: 'other' }]);
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
      getCrossChannelHistory,
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext({ isWeighIn: true }),
      personalityId: 'pers-1',
      configOverrides: makeOverrides({ crossChannelHistoryEnabled: true }),
      dataSource,
    });
    expect(getCrossChannelHistory).not.toHaveBeenCalled();

    await shadowHydrateAndDiff({
      jobId: 'job-2',
      jobContext: makeJobContext(),
      personalityId: 'pers-1',
      configOverrides: makeOverrides({ crossChannelHistoryEnabled: true }),
      dataSource,
    });
    expect(getCrossChannelHistory).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'persona-1', excludeChannelId: 'chan-1' })
    );
  });

  it('warns when hydration sees FEWER cross-channel groups than the payload', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
      getCrossChannelHistory: vi.fn().mockResolvedValue([]),
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext({
        crossChannelHistory: [
          {
            channelEnvironment: {
              type: 'guild',
              channel: { id: 'other-1', name: 'general', type: 'text' },
            },
            messages: [],
          },
          {
            channelEnvironment: {
              type: 'guild',
              channel: { id: 'other-2', name: 'random', type: 'text' },
            },
            messages: [],
          },
        ],
      }),
      personalityId: 'pers-1',
      configOverrides: makeOverrides({ crossChannelHistoryEnabled: true }),
      dataSource,
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        crossChannelDiff: { payloadGroups: 2, hydratedGroups: 0 },
      }),
      expect.stringContaining('DIVERGED')
    );
  });

  it('tolerates hydration seeing MORE cross-channel groups (timing drift)', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
      getCrossChannelHistory: vi.fn().mockResolvedValue([{ channelId: 'other-1' }]),
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext(),
      personalityId: 'pers-1',
      configOverrides: makeOverrides({ crossChannelHistoryEnabled: true }),
      dataSource,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        crossChannelDiff: { payloadGroups: 0, hydratedGroups: 1 },
      }),
      expect.stringContaining('matched')
    );
  });

  it('excludes id-less hydrated rows from the diff (symmetric filtering)', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }, { id: undefined }]),
    });

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext(),
      personalityId: 'pers-1',
      configOverrides: makeOverrides(),
      dataSource,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        historyDiff: expect.objectContaining({ hydratedCount: 2, extraInHydrated: 0 }),
      }),
      expect.stringContaining('matched')
    );
  });

  it('no-ops without a channelId', async () => {
    const dataSource = makeDataSource();

    await shadowHydrateAndDiff({
      jobId: 'job-1',
      jobContext: makeJobContext({ channelId: undefined }),
      personalityId: 'pers-1',
      configOverrides: makeOverrides(),
      dataSource,
    });

    expect(dataSource.getChannelHistory).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('swallows hydration errors into a debug log (never throws)', async () => {
    const dataSource = makeDataSource({
      getChannelHistory: vi.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(
      shadowHydrateAndDiff({
        jobId: 'job-1',
        jobContext: makeJobContext(),
        personalityId: 'pers-1',
        configOverrides: makeOverrides(),
        dataSource,
      })
    ).resolves.toBeUndefined();

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      expect.stringContaining('ignored')
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
