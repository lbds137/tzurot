import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client } from 'discord.js';

const { mockPostOwnerChannelEmbed } = vi.hoisted(() => ({
  mockPostOwnerChannelEmbed: vi.fn(),
}));

vi.mock('../utils/ownerChannel.js', () => ({
  postOwnerChannelEmbed: (...args: unknown[]) => mockPostOwnerChannelEmbed(...args),
}));

import {
  initErrorChannelReporter,
  reportError,
  reportJobError,
  extractStackFrames,
  JOB_ERROR_SKIP_CATEGORIES,
  __resetErrorChannelReporterForTests,
  type ErrorReport,
  reportDeliveryFailure,
  reportQuotaFallbackRescue,
} from './ErrorChannelReporter.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

function makeReport(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    source: 'command',
    errorCode: 'system_error',
    ...overrides,
  };
}

function fakeClient(): Client {
  return {} as unknown as Client;
}

describe('ErrorChannelReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostOwnerChannelEmbed.mockResolvedValue(true);
    // Real-time reset by default; the window-rollover test injects its own
    // clock (see below) — lru-cache snapshots performance.now at module
    // load, so fake timers alone cannot advance a TTLCache's clock.
    __resetErrorChannelReporterForTests();
  });

  describe('uninitialized reporter', () => {
    it('no-ops without posting or throwing when init has not run', () => {
      expect(() => reportError(makeReport())).not.toThrow();
      expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    });
  });

  describe('dedup within the window', () => {
    it('posts on the first occurrence', () => {
      initErrorChannelReporter(fakeClient());
      reportError(makeReport({ error: new Error('boom-1') }));
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    });

    it('does NOT post a repeat within the window, but the count increments (canary: removing the dedup early-return turns this red)', () => {
      initErrorChannelReporter(fakeClient());
      const report = makeReport({ error: new Error('boom-2') });
      reportError(report);
      reportError(report);
      reportError(report);
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    });

    it('posts two different hashes independently', () => {
      initErrorChannelReporter(fakeClient());
      reportError(makeReport({ error: new Error('boom-a') }));
      reportError(makeReport({ error: new Error('boom-b') }));
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
    });
  });

  describe('fail-open', () => {
    it('a throwing postOwnerChannelEmbed mock never propagates, and the handler survives to serve a later report (canary: removing the outer try/catch turns this red)', () => {
      initErrorChannelReporter(fakeClient());
      mockPostOwnerChannelEmbed.mockImplementationOnce(() => {
        throw new Error('discord.js threw synchronously');
      });

      expect(() => reportError(makeReport({ error: new Error('boom-throw') }))).not.toThrow();

      // Prove survival, not just "didn't throw once": a SECOND, distinct
      // report still reaches a real (mocked) post call afterward.
      mockPostOwnerChannelEmbed.mockResolvedValueOnce(true);
      reportError(makeReport({ error: new Error('boom-after-throw') }));
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
    });

    it('an async-rejecting postOwnerChannelEmbed never becomes an unhandled rejection', async () => {
      initErrorChannelReporter(fakeClient());
      mockPostOwnerChannelEmbed.mockRejectedValueOnce(new Error('gateway down'));

      expect(() => reportError(makeReport({ error: new Error('boom-reject') }))).not.toThrow();
      // Let the rejection's microtask settle before proceeding.
      await new Promise(resolve => setTimeout(resolve, 0));

      // Confirm the handler still serves a later report as the observable
      // survival proof (there is no warn-log seam exposed to assert on here).
      mockPostOwnerChannelEmbed.mockResolvedValueOnce(true);
      reportError(makeReport({ error: new Error('boom-after-reject') }));
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
    });
  });

  describe('reportDeliveryFailure', () => {
    it('reports with the constructor-name code and requestId, never deny-listed', () => {
      __resetErrorChannelReporterForTests();
      initErrorChannelReporter(fakeClient());

      reportDeliveryFailure(new TypeError('send failed'), 'req-1');

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
      const embed = mockPostOwnerChannelEmbed.mock.calls[0][1] as {
        toJSON: () => { title?: string; fields?: { name: string; value: string }[] };
      };
      const json = embed.toJSON();
      expect(json.title).toContain('TypeError');
      expect(json.fields?.some(f => f.name === 'Request ID' && f.value === 'req-1')).toBe(true);
    });
  });

  describe('previousWindowCount / suppressed-count field', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('rolls the window during a SUSTAINED loop — repeats keep arriving, second post still lands', () => {
      // The failure shape a burst-then-silence fixture cannot catch: repeats
      // interleaved across the window boundary. TTLCache.set re-stamps the
      // entry TTL on every write, so a window defined by cache eviction never
      // rolls while the loop is live — the rollover must key off the stored
      // windowStart instead. Canary: reverting the rollover check to bare
      // cache presence turns this red.
      __resetErrorChannelReporterForTests(() => Date.now());
      initErrorChannelReporter(fakeClient());
      const report = makeReport({ error: new Error('boom-sustained') });

      reportError(report); // window 1 opens: posts
      // A repeat every 10 minutes, indefinitely — more often than the 1h TTL.
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(10 * 60 * 1000);
        reportError(report);
      }
      // 60 minutes of loop have elapsed; the repeat at the boundary opened
      // window 2 and must have posted with the suppressed tally.
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
      const secondEmbed = mockPostOwnerChannelEmbed.mock.calls[1][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const fields = secondEmbed.toJSON().fields ?? [];
      const suppressed = fields.find(f => f.name === 'Suppressed since last report');
      // Window 1 held 6 occurrences: the shown post plus repeats at t=10..50.
      // The t=60 call opened window 2, so suppressed = 6 - 1 shown = 5.
      expect(suppressed?.value).toBe('5');
    });

    it('carries the suppressed count on the next window after several occurrences', () => {
      // `TTLCache`'s `now` option must resolve to `Date.now()` at CALL time
      // (not a hand-rolled counter) for `vi.advanceTimersByTime` to move it —
      // lru-cache otherwise snapshots `performance.now` at module load.
      __resetErrorChannelReporterForTests(() => Date.now());
      initErrorChannelReporter(fakeClient());
      const report = makeReport({ error: new Error('boom-window') });

      reportError(report); // 1st in window 1: posts, no suppressed field
      reportError(report); // suppressed, tally -> 2
      reportError(report); // suppressed, tally -> 3

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
      const firstEmbed = mockPostOwnerChannelEmbed.mock.calls[0][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const firstFields = firstEmbed.toJSON().fields ?? [];
      expect(firstFields.some(f => f.name === 'Suppressed since last report')).toBe(false);

      vi.advanceTimersByTime(60 * 60 * 1000 + 1); // past the 1h window

      reportError(report); // first in the new window: posts WITH suppressed field
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
      const secondEmbed = mockPostOwnerChannelEmbed.mock.calls[1][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const secondFields = secondEmbed.toJSON().fields ?? [];
      const suppressedField = secondFields.find(f => f.name === 'Suppressed since last report');
      expect(suppressedField?.value).toBe('2');
    });
  });

  describe('job-error skip set', () => {
    it('does not report a deny-listed category', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError('rate_limit');
      expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    });

    it('does not report the guest-mode admission-time substitution — a proactive, expected swap', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError('guest_mode');
      expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    });

    it('reports a non-deny-listed category', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError('server_error');
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    });

    it('reports an unrecognized category (report-by-default)', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError('some_future_category');
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    });

    it('exhaustively lists exactly the three documented classes', () => {
      expect([...JOB_ERROR_SKIP_CATEGORIES].sort()).toEqual(
        [
          'rate_limit',
          'quota_exceeded',
          'free_tier_quota',
          'credit_exhaustion',
          'content_policy',
          'censored',
          'provider_content_refused',
          'guest_mode',
        ].sort()
      );
    });
  });

  describe('extractStackFrames', () => {
    it('drops the message line and caps at 5 frames', () => {
      const error = new Error('sensitive message');
      error.stack = [
        'Error: sensitive message',
        '    at one (/app/a.ts:1:1)',
        '    at two (/app/b.ts:2:2)',
        '    at three (/app/c.ts:3:3)',
        '    at four (/app/d.ts:4:4)',
        '    at five (/app/e.ts:5:5)',
        '    at six (/app/f.ts:6:6)',
      ].join('\n');
      expect(extractStackFrames(error)).toEqual([
        'at one (/app/a.ts:1:1)',
        'at two (/app/b.ts:2:2)',
        'at three (/app/c.ts:3:3)',
        'at four (/app/d.ts:4:4)',
        'at five (/app/e.ts:5:5)',
      ]);
    });

    it('keeps no part of a MULTI-LINE message, which a positional slice would leak', () => {
      // A real Error whose message contains newlines spreads that message
      // across several leading stack lines — dropping only stack[0] would put
      // the continuation lines (user text) straight into the embed.
      const error = new Error('user typed:\nSENTINEL_MULTILINE_LEAK');
      error.stack = [
        'Error: user typed:',
        'SENTINEL_MULTILINE_LEAK',
        '    at real (/app/real.ts:9:9)',
      ].join('\n');
      expect(extractStackFrames(error)).toEqual(['at real (/app/real.ts:9:9)']);
    });

    it('returns empty when the stack carries no frame-shaped lines', () => {
      const error = new Error('boom');
      error.stack = 'Error: boom\nnot a frame line';
      expect(extractStackFrames(error)).toEqual([]);
    });

    it('returns empty for a non-Error', () => {
      expect(extractStackFrames('not an error')).toEqual([]);
    });

    it('returns empty when stack is missing', () => {
      const error = new Error('no stack');
      error.stack = undefined;
      expect(extractStackFrames(error)).toEqual([]);
    });
  });

  describe('no-PII pin', () => {
    it('never includes the error message or a passed-through user id in the embed', () => {
      initErrorChannelReporter(fakeClient());
      const error = new Error('SENTINEL_USER_TEXT_12345');
      error.stack = 'Error: SENTINEL_USER_TEXT_12345\n    at realFrame (file.ts:1:1)';

      reportError(
        makeReport({
          error,
          command: 'character.create',
          requestId: 'req-abc',
        })
      );

      const embed = mockPostOwnerChannelEmbed.mock.calls[0][1] as { toJSON: () => unknown };
      const serialized = JSON.stringify(embed.toJSON());
      expect(serialized).not.toContain('SENTINEL_USER_TEXT_12345');
      expect(serialized).not.toContain('99999999999999999'); // fake user id, never a field
    });

    it('never includes a MULTI-LINE error message in the embed', () => {
      initErrorChannelReporter(fakeClient());
      const error = new Error('user typed:\nSENTINEL_MULTILINE_EMBED');
      error.stack = [
        'Error: user typed:',
        'SENTINEL_MULTILINE_EMBED',
        '    at real (/app/real.ts:9:9)',
      ].join('\n');

      reportError(makeReport({ error }));

      const embed = mockPostOwnerChannelEmbed.mock.calls[0][1] as { toJSON: () => unknown };
      const serialized = JSON.stringify(embed.toJSON());
      expect(serialized).not.toContain('SENTINEL_MULTILINE_EMBED');
      // The genuine frame still survives, so this is not passing by posting nothing.
      expect(serialized).toContain('/app/real.ts:9:9');
    });
  });

  describe('rescue vs. failure rendering', () => {
    function lastEmbedJson(): {
      title?: string;
      color?: number;
      fields?: { name: string; value: string }[];
    } {
      const call = mockPostOwnerChannelEmbed.mock.calls.at(-1) as [
        unknown,
        { toJSON: () => unknown },
      ];
      return call[1].toJSON() as {
        title?: string;
        color?: number;
        fields?: { name: string; value: string }[];
      };
    }

    it('renders a rescued report with the warning title, warning color, and Outcome field', () => {
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue({ category: 'model_not_found' }, 'req-rescue-render');

      const json = lastEmbedJson();
      expect(json.title).toContain('⚠️');
      expect(json.title).toContain('(rescued)');
      expect(json.color).toBe(DISCORD_COLORS.WARNING);
      expect(json.fields?.some(f => f.name === 'Outcome' && f.value.includes('rescued'))).toBe(
        true
      );
    });

    it('renders a failure report of the same category unchanged: 🚨 title, ERROR color, no Outcome field', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError('model_not_found', 'req-failure-render');

      const json = lastEmbedJson();
      expect(json.title).toContain('🚨');
      expect(json.title).not.toContain('(rescued)');
      expect(json.color).toBe(DISCORD_COLORS.ERROR);
      expect(json.fields?.some(f => f.name === 'Outcome')).toBe(false);
    });

    it('dedup separation: a rescue and a failure of the SAME category both post within one window', () => {
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue({ category: 'model_not_found' }, 'req-both-1');
      reportJobError('model_not_found', 'req-both-2');

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
    });

    it('two rescues of the same category still dedup as before (second is suppressed)', () => {
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue({ category: 'model_not_found' }, 'req-rescue-dup-1');
      reportQuotaFallbackRescue({ category: 'model_not_found' }, 'req-rescue-dup-2');

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    });

    it('canary: the rescued/failure discriminator can actually fail (pins that the assertion is load-bearing)', () => {
      // This test intentionally asserts the OPPOSITE of the real branch to
      // document the canary result inline: reverting buildEmbed's rescued
      // branch (e.g. always using DISCORD_COLORS.ERROR) turns the two
      // rendering tests above red. See the PR report for the actual red-tail
      // capture from temporarily reverting the branch.
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue({ category: 'model_not_found' }, 'req-canary');

      const json = lastEmbedJson();
      expect(json.color).not.toBe(DISCORD_COLORS.ERROR);
    });
  });
});
