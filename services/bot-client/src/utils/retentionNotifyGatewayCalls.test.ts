import { describe, it, expect, vi } from 'vitest';

const mockServiceClient = {
  retentionNotifyFilter: vi.fn(),
  retentionNotifyReport: vi.fn(),
};

vi.mock('./gatewayClients.js', () => ({
  getServiceClient: () => mockServiceClient,
}));

import { filterNotifyEligible, reportNotifyOutcomes } from './retentionNotifyGatewayCalls.js';
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
