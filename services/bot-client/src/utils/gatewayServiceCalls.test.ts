import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobStatus } from '@tzurot/common-types/constants/queue';
import {
  TimeoutError,
  AudioTooLongError,
  SttUnavailableError,
} from '@tzurot/common-types/utils/errors';

// Mock the ServiceClient factory + the service-secret accessor so the helpers
// run without real config/network. (The context write-path helpers live in
// gatewayWriteHelpers.ts with their own colocated tests.)
const mockServiceClient = {
  getChannelSettings: vi.fn(),
  getAdminSettingsInternal: vi.fn(),
  setDmSession: vi.fn(),
  lookupPersonalityFromMessage: vi.fn(),
  updateDiagnosticResponseIds: vi.fn(),
  aiGenerate: vi.fn(),
  aiConfirmDelivery: vi.fn(),
  releaseBroadcastPending: vi.fn(),
  releaseBroadcastDeliveries: vi.fn(),
};

vi.mock('./gatewayClients.js', () => ({
  getServiceClient: () => mockServiceClient,
}));

vi.mock('../startup.js', () => ({
  getValidatedServiceSecret: () => 'test-secret',
}));

import {
  getChannelSettingsCached,
  getAdminSettingsCached,
  setDmSessionPersonality,
  lookupPersonalityFromMessage,
  updateDiagnosticResponseIds,
  generate,
  confirmDelivery,
  filterPendingDeliveries,
  reportDeliveries,
  transcribe,
  healthCheck,
  invalidateChannelSettingsCache,
  invalidateAdminSettingsCache,
  clearAllChannelSettingsCache,
  _clearAdminSettingsCacheForTesting,
} from './gatewayServiceCalls.js';

const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });
const err = (status: number): { ok: false; error: string; status: number } => ({
  ok: false,
  error: 'boom',
  status,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearAllChannelSettingsCache();
  _clearAdminSettingsCacheForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getChannelSettingsCached', () => {
  it('fetches on miss, caches, and serves the second call from cache', async () => {
    const data = { hasSettings: true, settings: { activatedPersonalityId: 'p-1' } };
    mockServiceClient.getChannelSettings.mockResolvedValue(ok(data));

    const first = await getChannelSettingsCached('chan-1');
    const second = await getChannelSettingsCached('chan-1');

    expect(first).toEqual(data);
    expect(second).toEqual(data);
    // Only one network call despite two reads — cache hit on the second.
    expect(mockServiceClient.getChannelSettings).toHaveBeenCalledTimes(1);
    expect(mockServiceClient.getChannelSettings).toHaveBeenCalledWith('chan-1');
  });

  it('returns null (no throw) on a gateway error and does not cache it', async () => {
    mockServiceClient.getChannelSettings.mockResolvedValue(err(500));

    expect(await getChannelSettingsCached('chan-err')).toBeNull();
    // A subsequent call still tries again (error was not cached).
    await getChannelSettingsCached('chan-err');
    expect(mockServiceClient.getChannelSettings).toHaveBeenCalledTimes(2);
  });

  it('invalidateChannelSettingsCache forces a re-fetch for that channel', async () => {
    mockServiceClient.getChannelSettings.mockResolvedValue(ok({ hasSettings: false }));
    await getChannelSettingsCached('chan-2');
    invalidateChannelSettingsCache('chan-2');
    await getChannelSettingsCached('chan-2');
    expect(mockServiceClient.getChannelSettings).toHaveBeenCalledTimes(2);
  });
});

describe('getAdminSettingsCached', () => {
  it('caches the singleton across calls; invalidate forces re-fetch', async () => {
    mockServiceClient.getAdminSettingsInternal.mockResolvedValue(
      ok({ configDefaults: { voiceTranscriptionEnabled: true } })
    );

    await getAdminSettingsCached();
    await getAdminSettingsCached();
    expect(mockServiceClient.getAdminSettingsInternal).toHaveBeenCalledTimes(1);

    invalidateAdminSettingsCache();
    await getAdminSettingsCached();
    expect(mockServiceClient.getAdminSettingsInternal).toHaveBeenCalledTimes(2);
  });

  it('returns null on error', async () => {
    mockServiceClient.getAdminSettingsInternal.mockResolvedValue(err(503));
    expect(await getAdminSettingsCached()).toBeNull();
  });
});

describe('setDmSessionPersonality', () => {
  it('invalidates the channel cache on success', async () => {
    mockServiceClient.getChannelSettings.mockResolvedValue(ok({ hasSettings: true }));
    mockServiceClient.setDmSession.mockResolvedValue(ok({}));

    // Prime the cache, then set the DM session — the cache entry must be cleared.
    await getChannelSettingsCached('dm-1');
    await setDmSessionPersonality('dm-1', 'lila');
    await getChannelSettingsCached('dm-1');

    expect(mockServiceClient.setDmSession).toHaveBeenCalledWith({
      channelId: 'dm-1',
      personalitySlug: 'lila',
    });
    // Re-fetched after invalidation (2 total getChannelSettings calls).
    expect(mockServiceClient.getChannelSettings).toHaveBeenCalledTimes(2);
  });

  it('does not throw and does not invalidate on failure', async () => {
    mockServiceClient.getChannelSettings.mockResolvedValue(ok({ hasSettings: true }));
    mockServiceClient.setDmSession.mockResolvedValue(err(500));

    await getChannelSettingsCached('dm-2');
    await expect(setDmSessionPersonality('dm-2', 'lila')).resolves.toBeUndefined();
    await getChannelSettingsCached('dm-2');
    // Cache survived the failed write → only one fetch.
    expect(mockServiceClient.getChannelSettings).toHaveBeenCalledTimes(1);
  });
});

describe('lookupPersonalityFromMessage', () => {
  it('returns the row on success, normalizing null personalityName to undefined', async () => {
    mockServiceClient.lookupPersonalityFromMessage.mockResolvedValue(
      ok({ personalityId: 'p-9', personalityName: null })
    );
    const result = await lookupPersonalityFromMessage('msg-1');
    expect(result).toEqual({ personalityId: 'p-9', personalityName: undefined });
  });

  it('returns null on a 404 / error', async () => {
    mockServiceClient.lookupPersonalityFromMessage.mockResolvedValue(err(404));
    expect(await lookupPersonalityFromMessage('msg-x')).toBeNull();
  });
});

describe('fire-and-forget helpers', () => {
  it('updateDiagnosticResponseIds passes the ids and never throws on failure', async () => {
    mockServiceClient.updateDiagnosticResponseIds.mockResolvedValue(err(500));
    await expect(updateDiagnosticResponseIds('req-1', ['m1', 'm2'])).resolves.toBeUndefined();
    expect(mockServiceClient.updateDiagnosticResponseIds).toHaveBeenCalledWith('req-1', {
      responseMessageIds: ['m1', 'm2'],
    });
  });

  it('filterPendingDeliveries THROWS on gateway failure (pre-send: BullMQ must retry)', async () => {
    mockServiceClient.releaseBroadcastPending.mockResolvedValue(err(503));
    await expect(filterPendingDeliveries('release-1', ['a'])).rejects.toThrow(
      'Pending-delivery filter failed'
    );
  });

  it('filterPendingDeliveries returns the pending subset on success', async () => {
    mockServiceClient.releaseBroadcastPending.mockResolvedValue(
      ok({ pendingDeliveryLogIds: ['a'] })
    );
    await expect(filterPendingDeliveries('release-1', ['a', 'b'])).resolves.toEqual(['a']);
  });

  it('reportDeliveries retries a transient failure, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      mockServiceClient.releaseBroadcastDeliveries
        .mockResolvedValueOnce({ ok: false, kind: 'network', error: 'x', status: 0 })
        .mockResolvedValueOnce(ok({ updated: 1, autoDisabledUserIds: [], completed: false }));

      const promise = reportDeliveries('release-1', [{ deliveryLogId: 'a', status: 'sent' }]);
      await vi.runAllTimersAsync();
      await promise;

      expect(mockServiceClient.releaseBroadcastDeliveries).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('confirmDelivery never throws on failure', async () => {
    mockServiceClient.aiConfirmDelivery.mockResolvedValue(err(404));
    await expect(confirmDelivery('job-1')).resolves.toBeUndefined();
    expect(mockServiceClient.aiConfirmDelivery).toHaveBeenCalledWith('job-1');
  });
});

describe('generate', () => {
  it('returns jobId + requestId on success', async () => {
    mockServiceClient.aiGenerate.mockResolvedValue(
      ok({ jobId: 'j-1', requestId: 'r-1', status: JobStatus.Queued })
    );
    const result = await generate(
      { slug: 'lila' } as never,
      {
        messageContent: 'hi',
        userId: 'u-1',
      } as never
    );
    expect(result).toEqual({ jobId: 'j-1', requestId: 'r-1' });
    // `message` is hoisted from context.messageContent; the context object is
    // forwarded as the nested `context` payload.
    expect(mockServiceClient.aiGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hi',
        context: expect.objectContaining({ userId: 'u-1' }),
      })
    );
  });

  it('throws on submission failure', async () => {
    mockServiceClient.aiGenerate.mockResolvedValue(err(500));
    await expect(
      generate({ slug: 'lila' } as never, { messageContent: 'hi' } as never)
    ).rejects.toThrow('Gateway request failed');
  });
});

describe('raw-fetch helpers (allow-listed)', () => {
  it('transcribe posts to /ai/transcribe?wait=true and returns the transcript', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'jt-1',
        status: JobStatus.Completed,
        result: { content: 'hello world', provider: 'whisper' },
      }),
    } as Response);

    const result = await transcribe([{ url: 'a', contentType: 'audio/ogg' }], 'user-1');

    expect(result.content).toBe('hello world');
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/ai/transcribe?wait=true');
  });

  it('transcribe reconstructs a TimeoutError from failureReason=timeout', async () => {
    // A failed job RESOLVES (success:false) → arrives as Completed with empty content
    // + failureReason. transcribe must surface it as the typed error so the bot shows
    // "taking too long" rather than the generic message.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'jt-timeout',
        status: JobStatus.Completed,
        result: { success: false, content: '', failureReason: 'timeout' },
      }),
    } as Response);

    await expect(transcribe([{ url: 'a', contentType: 'audio/ogg' }], 'user-1')).rejects.toThrow(
      TimeoutError
    );
  });

  it('transcribe reconstructs an AudioTooLongError from failureReason=too_long', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'jt-toolong',
        status: JobStatus.Completed,
        result: {
          success: false,
          content: '',
          failureReason: 'too_long',
          error: 'Audio too long (800s). Maximum is 720s.',
        },
      }),
    } as Response);

    await expect(transcribe([{ url: 'a', contentType: 'audio/ogg' }], 'user-1')).rejects.toThrow(
      AudioTooLongError
    );
  });

  it('transcribe reconstructs an SttUnavailableError from failureReason=unavailable', async () => {
    // 'unavailable' means every retry layer already ran server-side — the
    // typed error lets the bot show a retry-aware message instead of the
    // generic "couldn't transcribe".
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: 'jt-unavailable',
        status: JobStatus.Completed,
        result: { success: false, content: '', failureReason: 'unavailable' },
      }),
    } as Response);

    await expect(transcribe([{ url: 'a', contentType: 'audio/ogg' }], 'user-1')).rejects.toThrow(
      SttUnavailableError
    );
  });

  it('healthCheck returns true on a 2xx and false on throw', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    expect(await healthCheck()).toBe(true);
    spy.mockRejectedValue(new Error('down'));
    expect(await healthCheck()).toBe(false);
  });
});

describe('transcribe — transient-network retry', () => {
  const completedResponse = {
    ok: true,
    json: async () => ({
      jobId: 'jt-1',
      status: JobStatus.Completed,
      result: { content: 'recovered transcript' },
    }),
  } as Response;

  const transientError = (code: string): Error =>
    Object.assign(new Error(`socket ${code}`), { cause: { code } });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries on a transient network error and succeeds on a later attempt', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(transientError('ECONNRESET'))
      .mockResolvedValueOnce(completedResponse);

    const promise = transcribe([{ url: 'a', contentType: 'audio/ogg' }], 'user-1');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.content).toBe('recovered transcript');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rethrows after exhausting all attempts on persistent transient errors', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(transientError('UND_ERR_SOCKET'));

    const promise = transcribe([{ url: 'a', contentType: 'audio/ogg' }], 'user-1');
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;

    // TRANSCRIBE_MAX_ATTEMPTS = 3 → two loop iterations + one final attempt.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-transient error (no transient cause code)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('400 validation failed'));

    const promise = transcribe([{ url: 'a', contentType: 'audio/ogg' }], 'user-1');
    const assertion = expect(promise).rejects.toThrow('400 validation failed');
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
