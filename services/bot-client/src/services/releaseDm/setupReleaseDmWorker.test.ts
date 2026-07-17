/**
 * Tests for the release-DM worker processor (the seam that matters: pending
 * filter → sequential sends with pacing → classified ledger report).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordAPIError, type Client } from 'discord.js';
import { JobType } from '@tzurot/common-types/constants/queue';
import type { ReleaseBroadcastRecipient } from '@tzurot/common-types/types/jobs';
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

const { createReleaseDmProcessor } = await import('./setupReleaseDmWorker.js');

const RELEASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const LOG_A = '223e4567-e89b-42d3-a456-426614174000';
const LOG_B = '323e4567-e89b-42d3-a456-426614174000';
const USER_A = '423e4567-e89b-42d3-a456-426614174000';
const USER_B = '523e4567-e89b-42d3-a456-426614174000';

function makePayload() {
  return {
    requestId: `${RELEASE_ID}:0`,
    jobType: JobType.ReleaseBroadcastDm,
    responseDestination: { type: 'api' },
    releaseId: RELEASE_ID,
    version: 'adhoc-test',
    body: 'Hello from the release pipeline',
    recipients: [
      { deliveryLogId: LOG_A, userId: USER_A, discordUserId: '111111111111111111' },
      { deliveryLogId: LOG_B, userId: USER_B, discordUserId: '222222222222222222' },
    ] as ReleaseBroadcastRecipient[],
  };
}

function makeDeps(sendImpl?: (userId: string) => Promise<unknown>) {
  const send = vi.fn().mockResolvedValue({ id: 'sent-msg-1' });
  const deleteMessage = vi.fn().mockResolvedValue(undefined);
  const createDM = vi.fn().mockResolvedValue({ messages: { delete: deleteMessage } });
  const fetch = vi.fn().mockImplementation((userId: string) =>
    Promise.resolve({
      id: userId,
      send: sendImpl !== undefined ? () => sendImpl(userId) : send,
      createDM,
    })
  );
  const client = { users: { fetch } } as unknown as Client;
  const sleep = vi.fn().mockResolvedValue(undefined);
  const filterPending = vi.fn().mockResolvedValue([LOG_A, LOG_B]);
  const report = vi.fn().mockResolvedValue(undefined);
  return { client, sleep, filterPending, report, fetch, send, createDM, deleteMessage };
}

function asJob(data: unknown): Job {
  return { id: 'job-1', data } as unknown as Job;
}

describe('createReleaseDmProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends to every pending recipient with pacing between sends, then reports sent', async () => {
    const deps = makeDeps();
    const processor = createReleaseDmProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.filterPending).toHaveBeenCalledWith(RELEASE_ID, [LOG_A, LOG_B]);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.send).toHaveBeenCalledTimes(2);
    const sendArg = deps.send.mock.calls[0][0] as { content: string; allowedMentions: unknown };
    expect(sendArg.content).toContain('Hello from the release pipeline');
    // The footer must name the explicit opt-out invocation, not just the
    // command family — that affordance is the spam-report mitigation.
    expect(sendArg.content).toContain('/notifications disable');
    expect(sendArg.allowedMentions).toEqual({ parse: [] });
    // One sleep between two sends, none after the last.
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    // One report PER SEND (crash-window guard) — not one batch at the end.
    expect(deps.report).toHaveBeenNthCalledWith(1, RELEASE_ID, [
      { deliveryLogId: LOG_A, status: 'sent', sentMessageId: 'sent-msg-1' },
    ]);
    expect(deps.report).toHaveBeenNthCalledWith(2, RELEASE_ID, [
      { deliveryLogId: LOG_B, status: 'sent', sentMessageId: 'sent-msg-1' },
    ]);
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
  });

  it('skips recipients the ledger says are no longer pending (stall-rerun guard)', async () => {
    const deps = makeDeps();
    deps.filterPending.mockResolvedValue([LOG_B]);
    const processor = createReleaseDmProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(deps.report).toHaveBeenCalledWith(RELEASE_ID, [
      { deliveryLogId: LOG_B, status: 'sent', sentMessageId: 'sent-msg-1' },
    ]);
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 1 });
  });

  it('classifies a 50007 as failed_permanent and keeps sending to the rest', async () => {
    const blocked = new DiscordAPIError(
      { code: 50007, message: 'Cannot send messages to this user' },
      50007,
      403,
      'POST',
      'url',
      {}
    );
    const deps = makeDeps(userId =>
      userId === '111111111111111111' ? Promise.reject(blocked) : Promise.resolve({ id: 'sent-b' })
    );
    const processor = createReleaseDmProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.report).toHaveBeenNthCalledWith(1, RELEASE_ID, [
      { deliveryLogId: LOG_A, status: 'failed_permanent', errorCode: '50007' },
    ]);
    expect(deps.report).toHaveBeenNthCalledWith(2, RELEASE_ID, [
      { deliveryLogId: LOG_B, status: 'sent', sentMessageId: 'sent-b' },
    ]);
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
  });

  it('classifies a network error as failed_transient', async () => {
    const netError = new Error('reset') as NodeJS.ErrnoException;
    netError.code = 'ECONNRESET';
    const deps = makeDeps(() => Promise.reject(netError));
    const processor = createReleaseDmProcessor(deps);

    const result = await processor(asJob(makePayload()));

    const reportedStatuses = deps.report.mock.calls.map(
      call => (call[1] as { status: string }[])[0].status
    );
    expect(reportedStatuses).toEqual(['failed_transient', 'failed_transient']);
    expect(result).toEqual({ sent: 0, failed: 2, skipped: 0 });
  });

  it('fail-skips an invalid payload without touching Discord or the ledger', async () => {
    const deps = makeDeps();
    const processor = createReleaseDmProcessor(deps);

    const result = await processor(asJob({ nonsense: true }));

    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it('propagates a pending-filter failure so BullMQ retries the batch (nothing sent)', async () => {
    const deps = makeDeps();
    deps.filterPending.mockRejectedValue(new Error('Pending-delivery filter failed: 503'));
    const processor = createReleaseDmProcessor(deps);

    await expect(processor(asJob(makePayload()))).rejects.toThrow('Pending-delivery filter');
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
  });

  describe('previous-DM cleanup (delete-before-send)', () => {
    const PREV_LOG = '623e4567-e89b-42d3-a456-426614174000';

    function payloadWithPreviousDm() {
      const payload = makePayload();
      payload.recipients[0] = {
        ...payload.recipients[0],
        previousDm: { deliveryLogId: PREV_LOG, messageId: 'old-msg-9' },
      };
      return payload;
    }

    it('deletes the prior DM before sending and reports the stamped row', async () => {
      const deps = makeDeps();
      const processor = createReleaseDmProcessor(deps);

      await processor(asJob(payloadWithPreviousDm()));

      expect(deps.deleteMessage).toHaveBeenCalledWith('old-msg-9');
      // Ordering: the old DM must be gone before the new one lands.
      expect(deps.deleteMessage.mock.invocationCallOrder[0]).toBeLessThan(
        deps.send.mock.invocationCallOrder[0]
      );
      expect(deps.report).toHaveBeenNthCalledWith(1, RELEASE_ID, [
        {
          deliveryLogId: LOG_A,
          status: 'sent',
          sentMessageId: 'sent-msg-1',
          deletedPreviousDeliveryLogId: PREV_LOG,
        },
      ]);
    });

    it('treats a 10008 already-gone as deleted', async () => {
      const deps = makeDeps();
      deps.deleteMessage.mockRejectedValue(
        new DiscordAPIError(
          { code: 10008, message: 'Unknown Message' },
          10008,
          404,
          'DELETE',
          'url',
          {}
        )
      );
      const processor = createReleaseDmProcessor(deps);

      await processor(asJob(payloadWithPreviousDm()));

      expect(deps.report).toHaveBeenNthCalledWith(1, RELEASE_ID, [
        expect.objectContaining({ status: 'sent', deletedPreviousDeliveryLogId: PREV_LOG }),
      ]);
    });

    it('still sends when the prior-DM delete fails, without stamping the row', async () => {
      const deps = makeDeps();
      deps.deleteMessage.mockRejectedValue(new Error('network reset'));
      const processor = createReleaseDmProcessor(deps);

      const result = await processor(asJob(payloadWithPreviousDm()));

      expect(deps.send).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });
      const firstEntry = (deps.report.mock.calls[0][1] as Record<string, unknown>[])[0];
      expect(firstEntry.deletedPreviousDeliveryLogId).toBeUndefined();
    });

    it('reports a completed deletion even when the send itself fails', async () => {
      const blocked = new DiscordAPIError(
        { code: 50007, message: 'Cannot send messages to this user' },
        50007,
        403,
        'POST',
        'url',
        {}
      );
      const deps = makeDeps(() => Promise.reject(blocked));
      const processor = createReleaseDmProcessor(deps);

      await processor(asJob(payloadWithPreviousDm()));

      expect(deps.report).toHaveBeenNthCalledWith(1, RELEASE_ID, [
        expect.objectContaining({
          status: 'failed_permanent',
          deletedPreviousDeliveryLogId: PREV_LOG,
        }),
      ]);
    });

    it('never touches createDM for recipients without a previousDm', async () => {
      const deps = makeDeps();
      const processor = createReleaseDmProcessor(deps);

      await processor(asJob(makePayload()));

      expect(deps.createDM).not.toHaveBeenCalled();
      expect(deps.deleteMessage).not.toHaveBeenCalled();
    });
  });

  it('reports nothing when the pending filter empties the batch', async () => {
    const deps = makeDeps();
    deps.filterPending.mockResolvedValue([]);
    const processor = createReleaseDmProcessor(deps);

    const result = await processor(asJob(makePayload()));

    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 2 });
  });

  describe('completion ops report', () => {
    const SUMMARY = {
      version: 'adhoc-test',
      sent: 5,
      failedPermanent: 1,
      failedTransient: 0,
      optedOut: 2,
    };

    it('posts one owner-channel embed when a report flips the blast to completed', async () => {
      const deps = makeDeps();
      // The gateway hands the summary to exactly one report — here, the last.
      deps.report
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ completed: true, summary: SUMMARY });
      const processor = createReleaseDmProcessor(deps);

      await processor(asJob(makePayload()));

      expect(postOwnerChannelEmbedMock).toHaveBeenCalledTimes(1);
      const embed = postOwnerChannelEmbedMock.mock.calls[0][1] as {
        data: { title?: string; description?: string };
      };
      expect(embed.data.title).toContain('Release blast completed');
      expect(embed.data.description).toContain('adhoc-test');
      expect(embed.data.description).toContain('5 sent');
      expect(embed.data.description).toContain('1 permanent-failed');
      expect(embed.data.description).toContain('2 excluded (opted out mid-blast)');
    });

    it('posts nothing when no report claims completion (including lost-report undefined)', async () => {
      const deps = makeDeps(); // report resolves undefined by default
      const processor = createReleaseDmProcessor(deps);

      await processor(asJob(makePayload()));

      expect(postOwnerChannelEmbedMock).not.toHaveBeenCalled();
    });
  });
});
