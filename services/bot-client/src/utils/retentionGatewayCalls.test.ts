import { describe, it, expect, vi } from 'vitest';
import type { BroadcastCompletionSummary } from '@tzurot/common-types/schemas/api/broadcast';

const mockServiceClient = {
  retentionNotifyFilter: vi.fn(),
  retentionNotifyReport: vi.fn(),
  stampUserDmUndeliverable: vi.fn(),
  releaseBroadcastDeliveries: vi.fn(),
};

vi.mock('./gatewayClients.js', () => ({
  getServiceClient: () => mockServiceClient,
}));

import {
  filterNotifyEligible,
  reportNotifyOutcomes,
  reportDeliveries,
  reportPersonaDmUndeliverable,
} from './retentionGatewayCalls.js';
import { makeErr } from '../test/gatewayClientStubs.js';

const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });

describe('filterNotifyEligible', () => {
  it('THROWS on gateway failure (pre-send: BullMQ must retry)', async () => {
    mockServiceClient.retentionNotifyFilter.mockResolvedValue(makeErr(503, 'boom'));
    await expect(filterNotifyEligible(['u-1'], 'warning')).rejects.toThrow(
      'Notify-eligibility filter failed'
    );
  });

  it('forwards { userIds, notice } and returns the eligible subset', async () => {
    mockServiceClient.retentionNotifyFilter.mockResolvedValue(
      ok({ stillEligibleUserIds: ['u-1'] })
    );
    await expect(filterNotifyEligible(['u-1', 'u-2'], 'reminder')).resolves.toEqual(['u-1']);
    expect(mockServiceClient.retentionNotifyFilter).toHaveBeenCalledWith({
      userIds: ['u-1', 'u-2'],
      notice: 'reminder',
    });
  });
});

describe('reportNotifyOutcomes', () => {
  it('retries a transient failure, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      mockServiceClient.retentionNotifyReport
        .mockResolvedValueOnce({ ok: false, kind: 'network', error: 'x', status: 0 })
        .mockResolvedValueOnce(ok({ processed: 1 }));

      const promise = reportNotifyOutcomes([{ userId: 'u-1', status: 'sent', notice: 'warning' }]);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe(true);

      expect(mockServiceClient.retentionNotifyReport).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('NEVER throws after retries exhaust (post-send contract)', async () => {
    vi.useFakeTimers();
    try {
      mockServiceClient.retentionNotifyReport.mockResolvedValue({
        ok: false,
        kind: 'network',
        error: 'x',
        status: 0,
      });

      const promise = reportNotifyOutcomes([{ userId: 'u-1', status: 'sent', notice: 'warning' }]);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up immediately on a non-retryable 4xx', async () => {
    mockServiceClient.retentionNotifyReport.mockResolvedValue(makeErr(400, 'bad request'));

    await expect(
      reportNotifyOutcomes([{ userId: 'u-1', status: 'sent', notice: 'warning' }])
    ).resolves.toBe(false);
    expect(mockServiceClient.retentionNotifyReport).toHaveBeenCalledTimes(1);
  });

  it('returns true immediately for an empty batch without calling the gateway', async () => {
    await expect(reportNotifyOutcomes([])).resolves.toBe(true);
    expect(mockServiceClient.retentionNotifyReport).not.toHaveBeenCalled();
  });
});

describe('fire-and-forget helpers', () => {
  it('reportPersonaDmUndeliverable forwards discordId + errorCode across the seam', async () => {
    mockServiceClient.stampUserDmUndeliverable.mockResolvedValue(ok({ stamped: true }));

    reportPersonaDmUndeliverable('123456789012345678', '50007');
    await Promise.resolve();
    await Promise.resolve();

    expect(mockServiceClient.stampUserDmUndeliverable).toHaveBeenCalledWith({
      discordId: '123456789012345678',
      errorCode: '50007',
    });
  });

  it('reportPersonaDmUndeliverable warns and does not throw on a non-ok result', async () => {
    mockServiceClient.stampUserDmUndeliverable.mockResolvedValue(makeErr(500, 'boom'));

    expect(() => reportPersonaDmUndeliverable('123456789012345678', '50007')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockServiceClient.stampUserDmUndeliverable).toHaveBeenCalledTimes(1);
  });

  it('reportPersonaDmUndeliverable never throws and produces no unhandled rejection when the client rejects', async () => {
    mockServiceClient.stampUserDmUndeliverable.mockRejectedValue(new Error('socket hang up'));

    expect(() => reportPersonaDmUndeliverable('123456789012345678', '50007')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockServiceClient.stampUserDmUndeliverable).toHaveBeenCalledTimes(1);
  });

  it('reportDeliveries retries a transient failure, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      mockServiceClient.releaseBroadcastDeliveries
        .mockResolvedValueOnce({ ok: false, kind: 'network', error: 'x', status: 0 })
        .mockResolvedValueOnce(ok({ updated: 1, autoDisabledUserIds: [], completed: false }));

      const promise = reportDeliveries('release-1', [{ deliveryLogId: 'a', status: 'sent' }]);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toEqual({ completed: false });

      expect(mockServiceClient.releaseBroadcastDeliveries).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reportDeliveries threads the completion summary back to the caller', async () => {
    const summary = {
      version: 'v-1',
      sent: 3,
      failedPermanent: 0,
      failedTransient: 1,
      failedBotLevel: 0,
      optedOut: 0,
    } satisfies BroadcastCompletionSummary;
    mockServiceClient.releaseBroadcastDeliveries.mockResolvedValue(
      ok({ updated: 1, autoDisabledUserIds: [], completed: true, summary })
    );

    await expect(
      reportDeliveries('release-1', [{ deliveryLogId: 'a', status: 'sent' }])
    ).resolves.toEqual({ completed: true, summary });
  });

  it('reportDeliveries NEVER throws after retries exhaust (post-send: a throw would re-DM)', async () => {
    vi.useFakeTimers();
    try {
      mockServiceClient.releaseBroadcastDeliveries.mockResolvedValue({
        ok: false,
        kind: 'network',
        error: 'x',
        status: 0,
      });

      const promise = reportDeliveries('release-1', [{ deliveryLogId: 'a', status: 'sent' }]);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();

      expect(mockServiceClient.releaseBroadcastDeliveries).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reportDeliveries gives up immediately on a non-retryable 4xx', async () => {
    mockServiceClient.releaseBroadcastDeliveries.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'bad',
      status: 400,
    });

    await expect(
      reportDeliveries('release-1', [{ deliveryLogId: 'a', status: 'sent' }])
    ).resolves.toBeUndefined();
    expect(mockServiceClient.releaseBroadcastDeliveries).toHaveBeenCalledTimes(1);
  });
});
