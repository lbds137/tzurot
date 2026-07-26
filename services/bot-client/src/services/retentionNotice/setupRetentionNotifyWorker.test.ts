/**
 * Tests for the retention notify worker processor (the seams that matter:
 * still-eligible filter → sequential sends with pacing → per-recipient
 * outcome report that drives the grace clock and the unreachable re-route).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordAPIError, type Client } from 'discord.js';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { Job } from 'bullmq';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const postOwnerChannelEmbedMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: postOwnerChannelEmbedMock,
}));

const { createRetentionNotifyProcessor } = await import('./setupRetentionNotifyWorker.js');

const USER_A = '423e4567-e89b-42d3-a456-426614174000';
const USER_B = '523e4567-e89b-42d3-a456-426614174000';

function makePayload() {
  return {
    requestId: 'run-1:0',
    jobType: JobType.RetentionNotifyDm,
    responseDestination: { type: 'api' },
    runId: 'run-1',
    recipients: [
      { userId: USER_A, discordUserId: '111111111111111111' },
      { userId: USER_B, discordUserId: '222222222222222222' },
    ],
  };
}

function makeDeps(sendImpl?: (discordId: string) => Promise<unknown>) {
  const send = vi.fn().mockResolvedValue({ id: 'sent-msg-1' });
  const fetch = vi.fn().mockImplementation((discordId: string) =>
    Promise.resolve({
      id: discordId,
      send: sendImpl !== undefined ? () => sendImpl(discordId) : send,
    })
  );
  const client = { users: { fetch } } as unknown as Client;
  const sleep = vi.fn().mockResolvedValue(undefined);
  const filterEligible = vi.fn().mockResolvedValue([USER_A, USER_B]);
  const report = vi.fn().mockResolvedValue(true);
  return { client, sleep, filterEligible, report, fetch, send };
}

function asJob(data: unknown): Job {
  return { id: 'job-1', data } as unknown as Job;
}

describe('createRetentionNotifyProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends to every still-eligible recipient with pacing, reporting each immediately', async () => {
    const deps = makeDeps();
    const processor = createRetentionNotifyProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.filterEligible).toHaveBeenCalledWith([USER_A, USER_B]);
    expect(deps.send).toHaveBeenCalledTimes(2);
    const sendArg = deps.send.mock.calls[0][0] as { content: string; allowedMentions: unknown };
    // The notice carries the policy numbers, the self-serve affordances, and
    // the exclusion footer — never an export link (they expire in 24h).
    expect(sendArg.content).toContain('180 days');
    expect(sendArg.content).toContain('/settings data export');
    expect(sendArg.content).toContain('/settings data delete');
    expect(sendArg.content).toContain('data-retention notice');
    expect(sendArg.content).not.toContain('/exports/');
    expect(sendArg.allowedMentions).toEqual({ parse: [] });
    // One sleep between two sends, none after the last.
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    // One report PER SEND (crash-window guard) — the seam that stamps grace.
    expect(deps.report).toHaveBeenNthCalledWith(1, [{ userId: USER_A, status: 'sent' }]);
    expect(deps.report).toHaveBeenNthCalledWith(2, [{ userId: USER_B, status: 'sent' }]);
    expect(result).toEqual({ sent: 2, bounced: 0, skipped: 0 });
  });

  it('skips recipients no longer notify-eligible (activity since resolution / stall re-run)', async () => {
    const deps = makeDeps();
    deps.filterEligible.mockResolvedValue([USER_B]);
    const processor = createRetentionNotifyProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledWith([{ userId: USER_B, status: 'sent' }]);
    expect(result).toEqual({ sent: 1, bounced: 0, skipped: 1 });
  });

  it('reports a 50278 bounce as failed_permanent — the cohort-discovery yield', async () => {
    const gone = new DiscordAPIError(
      { code: 50278, message: 'No mutual guilds' },
      50278,
      403,
      'POST',
      'url',
      {}
    );
    const deps = makeDeps(discordId =>
      discordId === '111111111111111111' ? Promise.reject(gone) : Promise.resolve({ id: 's' })
    );
    const processor = createRetentionNotifyProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.report).toHaveBeenNthCalledWith(1, [
      { userId: USER_A, status: 'failed_permanent', errorCode: '50278' },
    ]);
    expect(result).toEqual({ sent: 1, bounced: 1, skipped: 0 });
  });

  it('reports a 20026 as failed_bot_level — never a user-state signal (dev quarantine)', async () => {
    const quarantined = new DiscordAPIError(
      { code: 20026, message: 'Bot cannot initiate DMs' },
      20026,
      403,
      'POST',
      'url',
      {}
    );
    const deps = makeDeps(() => Promise.reject(quarantined));
    const processor = createRetentionNotifyProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.report).toHaveBeenNthCalledWith(1, [
      { userId: USER_A, status: 'failed_bot_level', errorCode: '20026' },
    ]);
    expect(result).toEqual({ sent: 0, bounced: 0, skipped: 0 });
  });

  it('posts the owner-channel batch tally (delivery results outlive the CLI call)', async () => {
    const deps = makeDeps();
    const processor = createRetentionNotifyProcessor(deps);

    await processor(asJob(makePayload()));

    expect(postOwnerChannelEmbedMock).toHaveBeenCalledTimes(1);
    const embed = postOwnerChannelEmbedMock.mock.calls[0][1] as {
      toJSON: () => { description?: string };
    };
    expect(embed.toJSON().description).toContain('2 warned');
  });

  it('fail-skips an invalid payload without touching Discord or the gateway', async () => {
    const deps = makeDeps();
    const processor = createRetentionNotifyProcessor(deps);

    const result = await processor(asJob({ nope: true }));

    expect(deps.filterEligible).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, bounced: 0, skipped: 0 });
  });

  it('propagates a filter failure so BullMQ retries the batch (nothing sent)', async () => {
    const deps = makeDeps();
    deps.filterEligible.mockRejectedValue(new Error('gateway down'));
    const processor = createRetentionNotifyProcessor(deps);

    await expect(processor(asJob(makePayload()))).rejects.toThrow('gateway down');
    expect(deps.send).not.toHaveBeenCalled();
  });
});
