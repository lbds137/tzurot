import { describe, it, expect, vi } from 'vitest';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { type JobContext } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { hydrateChannelHistory } from './channelHistoryHydration.js';
import type { ContextDataSource } from './types.js';

const PERSONALITY = { id: 'pers-1', name: 'Lila' } as LoadedPersonality;

function makeJobContext(partial: Partial<JobContext> = {}): JobContext {
  return {
    userId: 'user-1',
    userName: 'user',
    channelId: 'chan-1',
    ...partial,
  } as JobContext;
}

function mockDataSource(): ContextDataSource {
  return {
    getChannelHistoryWindow: vi.fn().mockResolvedValue({
      messages: [],
      meta: { inScopeCount: 0, evicted: 0, take: 0, chunk: 0, headRowId: null, degraded: false },
    }),
  } as unknown as ContextDataSource;
}

describe('hydrateChannelHistory', () => {
  it('derives cap from configOverrides.maxMessages, clamped to MAX_EXTENDED_CONTEXT', async () => {
    const dataSource = mockDataSource();
    const { cap } = await hydrateChannelHistory({
      dataSource,
      jobContext: makeJobContext(),
      personality: PERSONALITY,
      configOverrides: { maxMessages: 30 } as ResolvedConfigOverrides,
      channelId: 'chan-1',
      contextEpoch: undefined,
    });
    expect(cap).toBe(30);
  });

  it('forwards excludeDiscordMessageId from jobContext.triggerMessageId', async () => {
    const dataSource = mockDataSource();
    await hydrateChannelHistory({
      dataSource,
      jobContext: makeJobContext({ triggerMessageId: 'd-trigger' }),
      personality: PERSONALITY,
      configOverrides: undefined,
      channelId: 'chan-1',
      contextEpoch: undefined,
    });
    expect(dataSource.getChannelHistoryWindow).toHaveBeenCalledWith(
      expect.objectContaining({ excludeDiscordMessageId: 'd-trigger' })
    );
  });

  describe('history-scoping (shareHistoryAcrossPersonalities × DM/guild)', () => {
    // `expectIsolatedDm` is NOT a restatement of `expectPersonalityId`: the DB
    // read is scoped in guilds too, while the flag that drops the live-channel
    // extended-context read is DM-only. The two 'dms-only'/'never' guild rows
    // are where they diverge.
    const cases: Array<{
      mode: ResolvedConfigOverrides['shareHistoryAcrossPersonalities'] | undefined;
      serverId: string | undefined;
      expectPersonalityId: string | undefined;
      expectIsolatedDm: boolean;
    }> = [
      {
        mode: undefined,
        serverId: undefined,
        expectPersonalityId: undefined,
        expectIsolatedDm: false,
      }, // default 'always'
      {
        mode: 'always',
        serverId: undefined,
        expectPersonalityId: undefined,
        expectIsolatedDm: false,
      },
      {
        mode: 'always',
        serverId: 'guild-1',
        expectPersonalityId: undefined,
        expectIsolatedDm: false,
      },
      {
        mode: 'guilds-only',
        serverId: undefined,
        expectPersonalityId: 'pers-1',
        expectIsolatedDm: true,
      }, // DM -> scoped
      {
        mode: 'guilds-only',
        serverId: 'guild-1',
        expectPersonalityId: undefined,
        expectIsolatedDm: false,
      },
      {
        mode: 'dms-only',
        serverId: undefined,
        expectPersonalityId: undefined,
        expectIsolatedDm: false,
      },
      {
        mode: 'dms-only',
        serverId: 'guild-1',
        expectPersonalityId: 'pers-1',
        expectIsolatedDm: false,
      },
      { mode: 'never', serverId: undefined, expectPersonalityId: 'pers-1', expectIsolatedDm: true },
      {
        mode: 'never',
        serverId: 'guild-1',
        expectPersonalityId: 'pers-1',
        expectIsolatedDm: false,
      },
    ];

    it.each(cases)(
      'mode=$mode serverId=$serverId -> personalityId=$expectPersonalityId isolatedDm=$expectIsolatedDm',
      async ({ mode, serverId, expectPersonalityId, expectIsolatedDm }) => {
        const dataSource = mockDataSource();
        const { isolatedDm } = await hydrateChannelHistory({
          dataSource,
          jobContext: makeJobContext({ serverId }),
          personality: PERSONALITY,
          configOverrides:
            mode === undefined
              ? undefined
              : ({ shareHistoryAcrossPersonalities: mode } as ResolvedConfigOverrides),
          channelId: 'chan-1',
          contextEpoch: undefined,
        });
        expect(dataSource.getChannelHistoryWindow).toHaveBeenCalledWith(
          expect.objectContaining({ personalityId: expectPersonalityId })
        );
        expect(isolatedDm).toBe(expectIsolatedDm);
      }
    );
  });
});
