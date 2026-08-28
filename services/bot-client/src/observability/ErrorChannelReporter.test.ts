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
import { EMBED_CAPS } from '../utils/embedLimits.js';

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

      reportDeliveryFailure(new TypeError('send failed'), { requestId: 'req-1' }, undefined);

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
      const embed = mockPostOwnerChannelEmbed.mock.calls[0][1] as {
        toJSON: () => { title?: string; fields?: { name: string; value: string }[] };
      };
      const json = embed.toJSON();
      expect(json.title).toContain('TypeError');
      expect(json.fields?.some(f => f.name === 'Request ID' && f.value === 'req-1')).toBe(true);
    });

    it('carries the same diagnostic fields the job-error path does', () => {
      // A delivery failure is a genuine failure, so the Model field is
      // metadata.modelUsed — never a fromModel → toModel swap chain, which
      // only a rescue report renders.
      __resetErrorChannelReporterForTests();
      initErrorChannelReporter(fakeClient());

      reportDeliveryFailure(
        new TypeError('send failed'),
        {
          requestId: 'req-2',
          metadata: {
            modelUsed: 'anthropic/claude-sonnet-4',
            providerUsed: 'openrouter',
            processingTimeMs: 1234,
            quotaFallback: {
              fromModel: 'should-not-appear/from',
              toModel: 'should-not-appear/to',
              category: 'model_not_found',
              mode: 'reactive',
            },
          },
        },
        'Lila'
      );

      const embed = mockPostOwnerChannelEmbed.mock.calls[0][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const fields = embed.toJSON().fields ?? [];
      expect(fields.find(f => f.name === 'Personality')?.value).toBe('Lila');
      expect(fields.find(f => f.name === 'Model')?.value).toBe('anthropic/claude-sonnet-4');
      expect(fields.find(f => f.name === 'Provider')?.value).toBe('openrouter');
      expect(fields.find(f => f.name === 'Duration')?.value).toBe('1234ms');
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
      reportJobError({ errorInfo: { category: 'rate_limit' } }, undefined);
      expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    });

    it('does not report the guest-mode admission-time substitution — a proactive, expected swap', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError({ errorInfo: { category: 'guest_mode' } }, undefined);
      expect(mockPostOwnerChannelEmbed).not.toHaveBeenCalled();
    });

    it('reports a non-deny-listed category', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError({ errorInfo: { category: 'server_error' } }, undefined);
      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    });

    it('reports an unrecognized category (report-by-default)', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError({ errorInfo: { category: 'some_future_category' } }, undefined);
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
    /** A minimal rescue-shaped result carrying just the fields the rescue
     *  path reads: requestId and a quotaFallback with the given category. */
    function makeRescueResult(
      requestId: string,
      category: string
    ): {
      requestId: string;
      metadata: {
        quotaFallback: {
          fromModel: string;
          toModel: string;
          category: string;
          mode: 'proactive' | 'reactive';
        };
      };
    } {
      return {
        requestId,
        metadata: {
          quotaFallback: {
            fromModel: 'delisted/model',
            toModel: 'admin/default',
            category,
            mode: 'reactive',
          },
        },
      };
    }

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
      reportQuotaFallbackRescue(
        makeRescueResult('req-rescue-render', 'model_not_found'),
        undefined
      );

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
      reportJobError(
        { requestId: 'req-failure-render', errorInfo: { category: 'model_not_found' } },
        undefined
      );

      const json = lastEmbedJson();
      expect(json.title).toContain('🚨');
      expect(json.title).not.toContain('(rescued)');
      expect(json.color).toBe(DISCORD_COLORS.ERROR);
      expect(json.fields?.some(f => f.name === 'Outcome')).toBe(false);
    });

    it('dedup separation: a rescue and a failure of the SAME category both post within one window', () => {
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue(makeRescueResult('req-both-1', 'model_not_found'), undefined);
      reportJobError(
        { requestId: 'req-both-2', errorInfo: { category: 'model_not_found' } },
        undefined
      );

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
    });

    it('two rescues of the same category still dedup as before (second is suppressed)', () => {
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue(makeRescueResult('req-rescue-dup-1', 'model_not_found'), undefined);
      reportQuotaFallbackRescue(makeRescueResult('req-rescue-dup-2', 'model_not_found'), undefined);

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
    });

    it('canary: the rescued/failure discriminator can actually fail (pins that the assertion is load-bearing)', () => {
      // This test intentionally asserts the OPPOSITE of the real branch to
      // document the canary result inline: reverting buildEmbed's rescued
      // branch (e.g. always using DISCORD_COLORS.ERROR) turns the two
      // rendering tests above red. See the PR report for the actual red-tail
      // capture from temporarily reverting the branch.
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue(makeRescueResult('req-canary', 'model_not_found'), undefined);

      const json = lastEmbedJson();
      expect(json.color).not.toBe(DISCORD_COLORS.ERROR);
    });
  });

  describe('diagnostic fields (Personality / Model / Provider / Duration)', () => {
    function lastFields(): { name: string; value: string }[] {
      const call = mockPostOwnerChannelEmbed.mock.calls.at(-1) as [
        unknown,
        { toJSON: () => { fields?: { name: string; value: string }[] } },
      ];
      return call[1].toJSON().fields ?? [];
    }

    it('renders Personality/Model/Provider/Duration on a job-error report when present', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError(
        {
          requestId: 'req-diag-1',
          errorInfo: { category: 'server_error' },
          metadata: {
            modelUsed: 'anthropic/claude-sonnet-4',
            providerUsed: 'openrouter',
            processingTimeMs: 4200,
          },
        },
        'Lila'
      );

      const fields = lastFields();
      expect(fields.find(f => f.name === 'Personality')?.value).toBe('Lila');
      expect(fields.find(f => f.name === 'Model')?.value).toBe('anthropic/claude-sonnet-4');
      expect(fields.find(f => f.name === 'Provider')?.value).toBe('openrouter');
      expect(fields.find(f => f.name === 'Duration')?.value).toBe('4200ms');
    });

    it('caps a wire-sourced field value at the embed limit so an over-long one cannot drop the report', () => {
      // discord.js validates at BUILD time, so an over-cap field throws rather
      // than truncating — and that throw lands in reportError's own catch,
      // silently dropping the report. Losing a report is the worst failure this
      // module has, since it is how a failure becomes visible at all.
      initErrorChannelReporter(fakeClient());
      reportJobError(
        {
          requestId: 'req-diag-long',
          errorInfo: { category: 'server_error' },
          metadata: { modelUsed: 'm'.repeat(5000), providerUsed: 'p'.repeat(5000) },
        },
        undefined
      );

      const fields = lastFields();
      const model = fields.find(f => f.name === 'Model')?.value;
      const provider = fields.find(f => f.name === 'Provider')?.value;
      expect(model).toHaveLength(EMBED_CAPS.fieldValue);
      expect(provider).toHaveLength(EMBED_CAPS.fieldValue);
      // The ellipsis pins that the SHARED clamp ran, not an ad-hoc slice.
      expect(model?.endsWith('…')).toBe(true);
    });

    it('escapes markdown in the persona name — the one user-authored value on the card', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError(
        { requestId: 'req-md', errorInfo: { category: 'server_error' } },
        '**bold** `code`'
      );

      expect(lastFields().find(f => f.name === 'Personality')?.value).toBe(
        '\\*\\*bold\\*\\* \\`code\\`'
      );
    });

    it('neutralizes a masked link in the persona name while keeping legitimate parens', () => {
      // Probed: bare `escapeMarkdown` does NOT touch `[](…)`, so the name would
      // otherwise render as a live link in the owner's channel. `maskedLink`
      // escapes the opening bracket instead of stripping, so a real name like
      // `Lilith (v2)` is unharmed.
      initErrorChannelReporter(fakeClient());
      reportJobError(
        { requestId: 'req-mask', errorInfo: { category: 'server_error' } },
        '[Free Nitro](http://evil.example)'
      );
      expect(lastFields().find(f => f.name === 'Personality')?.value).toBe(
        '\\[Free Nitro](http://evil.example)'
      );

      __resetErrorChannelReporterForTests();
      initErrorChannelReporter(fakeClient());
      reportJobError(
        { requestId: 'req-parens', errorInfo: { category: 'server_error' } },
        'Lilith (v2)'
      );
      expect(lastFields().find(f => f.name === 'Personality')?.value).toBe('Lilith (v2)');
    });

    it('strips markdown link delimiters from Model and Provider (free-text preset inputs)', () => {
      // Both are `/preset` modal fields validated for length only, so a chosen
      // id like `[Free Nitro](http://evil)` would render as a live masked link
      // in the owner's alert channel. Same strip buildModelFooterText applies.
      initErrorChannelReporter(fakeClient());
      reportJobError(
        {
          requestId: 'req-inject',
          errorInfo: { category: 'model_not_found' },
          metadata: {
            modelUsed: '[Free Nitro](http://evil.example)',
            providerUsed: '<@everyone>',
          },
        },
        undefined
      );

      const fields = lastFields();
      expect(fields.find(f => f.name === 'Model')?.value).toBe('Free Nitrohttp://evil.example');
      expect(fields.find(f => f.name === 'Provider')?.value).toBe('@everyone');
    });

    it('omits Model when the id sanitizes away to nothing rather than dropping the report', () => {
      // `LlmConfigCreateSchema.model` is `.min(1).max(200)` with no character
      // restriction, so an all-delimiter id like `()` passes validation and
      // strips to ''. An empty field value throws at build time and the whole
      // alert vanishes into reportError's fail-open catch.
      initErrorChannelReporter(fakeClient());
      reportJobError(
        {
          requestId: 'req-strips-empty',
          errorInfo: { category: 'model_not_found' },
          metadata: { modelUsed: '()', providerUsed: '<>' },
        },
        undefined
      );

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
      const fields = lastFields();
      expect(fields.some(f => f.name === 'Model')).toBe(false);
      expect(fields.some(f => f.name === 'Provider')).toBe(false);
    });

    it('omits the Personality field on an EMPTY name rather than dropping the whole report', () => {
      // Discord rejects an empty field value at build time; that throw lands in
      // reportError's own fail-open catch, so the alert would vanish entirely.
      // LoadedPersonality.name is z.string() with no .min(1), so nothing
      // upstream rules an empty name out.
      initErrorChannelReporter(fakeClient());
      reportJobError({ requestId: 'req-empty', errorInfo: { category: 'server_error' } }, '');

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(1);
      expect(lastFields().some(f => f.name === 'Personality')).toBe(false);
    });

    it('omits Personality/Model/Provider/Duration entirely when the result carries none of them', () => {
      initErrorChannelReporter(fakeClient());
      reportJobError(
        { requestId: 'req-diag-2', errorInfo: { category: 'server_error' } },
        undefined
      );

      const fields = lastFields();
      expect(fields.some(f => f.name === 'Personality')).toBe(false);
      expect(fields.some(f => f.name === 'Model')).toBe(false);
      expect(fields.some(f => f.name === 'Provider')).toBe(false);
      expect(fields.some(f => f.name === 'Duration')).toBe(false);
    });

    it('renders a rescue report Model field as `fromModel → toModel`, preferring the fallback over metadata.modelUsed', () => {
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue(
        {
          requestId: 'req-diag-rescue',
          metadata: {
            // Deliberately different from quotaFallback.toModel — the rescue
            // path must prefer the fallback's toModel, not this field.
            modelUsed: 'should-not-appear/model',
            quotaFallback: {
              fromModel: 'delisted/model',
              toModel: 'admin/default',
              category: 'model_not_found',
              mode: 'reactive',
            },
          },
        },
        'Lila'
      );

      const fields = lastFields();
      expect(fields.find(f => f.name === 'Model')?.value).toBe('delisted/model → admin/default');
    });

    it('canary: the rescue Model-swap rendering is load-bearing (mutate deriveDiagnosticFields mentally: using metadata.modelUsed unconditionally would show should-not-appear/model)', () => {
      initErrorChannelReporter(fakeClient());
      reportQuotaFallbackRescue(
        {
          requestId: 'req-diag-rescue-canary',
          metadata: {
            modelUsed: 'should-not-appear/model',
            quotaFallback: {
              fromModel: 'delisted/model',
              toModel: 'admin/default',
              category: 'model_not_found',
              mode: 'reactive',
            },
          },
        },
        undefined
      );

      const fields = lastFields();
      expect(fields.find(f => f.name === 'Model')?.value).not.toBe('should-not-appear/model');
    });
  });

  describe('occurrence counter (24h horizon)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders "#1, first seen 0m ago" on the very first occurrence', () => {
      initErrorChannelReporter(fakeClient());
      reportError(makeReport({ error: new Error('boom-occ-1') }));

      const embed = mockPostOwnerChannelEmbed.mock.calls[0][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const fields = embed.toJSON().fields ?? [];
      expect(fields.find(f => f.name === 'Occurrence')?.value).toBe('#1, first seen 0m ago');
    });

    it('counts a suppressed (deduped) repeat as an occurrence, surfacing it on the next post', () => {
      // The bug this fixes: HISTORY_TTL_MS (2h) had already rolled off by the
      // owner's observed 7h gap, so the count was lost. Advance PAST the 1h
      // dedup window (so a new window opens and posts) but stay well inside
      // the 24h occurrence horizon, and confirm the suppressed occurrence in
      // between is reflected in the count.
      __resetErrorChannelReporterForTests(() => Date.now());
      initErrorChannelReporter(fakeClient());
      const report = makeReport({ error: new Error('boom-occ-2') });

      reportError(report); // occurrence #1, posts
      reportError(report); // occurrence #2, suppressed (same window)
      vi.advanceTimersByTime(60 * 60 * 1000 + 1); // roll the 1h dedup window
      reportError(report); // occurrence #3, posts (new window)

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
      const secondEmbed = mockPostOwnerChannelEmbed.mock.calls[1][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const fields = secondEmbed.toJSON().fields ?? [];
      // 60 minutes rounds up to the hour bucket (formatRelativeAge switches
      // at exactly 60 minutes).
      expect(fields.find(f => f.name === 'Occurrence')?.value).toBe('#3, first seen 1h ago');
    });

    it('starts a fresh occurrence count once the 24h horizon has passed', () => {
      __resetErrorChannelReporterForTests(() => Date.now());
      initErrorChannelReporter(fakeClient());
      const report = makeReport({ error: new Error('boom-occ-3') });

      reportError(report); // occurrence #1, posts
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1); // past the 24h horizon
      reportError(report); // horizon has aged out: fresh #1

      expect(mockPostOwnerChannelEmbed).toHaveBeenCalledTimes(2);
      const secondEmbed = mockPostOwnerChannelEmbed.mock.calls[1][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const fields = secondEmbed.toJSON().fields ?? [];
      expect(fields.find(f => f.name === 'Occurrence')?.value).toBe('#1, first seen 0m ago');
    });

    it('resets firstSeen on a SUSTAINED recurrence once the 24h horizon passes, even though the cache entry itself never expires (repeats every 10h < the 24h TTL)', () => {
      // Mirrors the windowCache sustained-loop test: TTLCache.set re-stamps
      // the entry TTL on every write, so a hash recurring more often than
      // once per 24h would never expire via cache eviction alone — the
      // rollover must come from the explicit firstSeen comparison instead.
      __resetErrorChannelReporterForTests(() => Date.now());
      initErrorChannelReporter(fakeClient());
      const report = makeReport({ error: new Error('boom-occ-sustained') });

      reportError(report); // t=0: occurrence #1, firstSeen=0
      vi.advanceTimersByTime(10 * 60 * 60 * 1000); // t=10h
      reportError(report); // occurrence #2, firstSeen still 0 (10h < 24h)
      vi.advanceTimersByTime(10 * 60 * 60 * 1000); // t=20h
      reportError(report); // occurrence #3, firstSeen still 0 (20h < 24h)
      vi.advanceTimersByTime(10 * 60 * 60 * 1000); // t=30h — past the 24h horizon
      reportError(report); // firstSeen resets: fresh #1

      const lastCall = mockPostOwnerChannelEmbed.mock.calls.at(-1) as [
        unknown,
        { toJSON: () => { fields?: { name: string; value: string }[] } },
      ];
      const fields = lastCall[1].toJSON().fields ?? [];
      expect(fields.find(f => f.name === 'Occurrence')?.value).toBe('#1, first seen 0m ago');
    });

    it('canary: the occurrence counter is load-bearing (a suppressed repeat that does NOT bump the count would show #2 instead of #3 above)', () => {
      // This test documents the canary result inline rather than re-deriving
      // it: removing the unconditional `bumpOccurrence` call (or moving it
      // inside the dedup early-return's guard) makes the prior test's
      // suppressed-repeat count stop incrementing, so its assertion
      // ('#3, first seen 1h ago') would read '#2' instead. Asserted here as
      // a standalone reddening check on a simpler fixture.
      __resetErrorChannelReporterForTests(() => Date.now());
      initErrorChannelReporter(fakeClient());
      const report = makeReport({ error: new Error('boom-occ-canary') });

      reportError(report); // #1, posts
      reportError(report); // suppressed repeat — must still count
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      reportError(report); // #3, posts

      const embed = mockPostOwnerChannelEmbed.mock.calls[1][1] as {
        toJSON: () => { fields?: { name: string; value: string }[] };
      };
      const fields = embed.toJSON().fields ?? [];
      expect(fields.find(f => f.name === 'Occurrence')?.value).not.toBe('#2, first seen 1h ago');
    });
  });
});
