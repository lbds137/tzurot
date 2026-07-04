import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MistralTtsProvider } from './MistralTtsProvider.js';
import {
  MistralApiError,
  MistralReferenceAudioTooLongError,
  MISTRAL_MAX_REFERENCE_AUDIO_SEC,
} from '../MistralTtsClient.js';

// Logger stub captured at module level so tests can assert what the provider
// emits — specifically that `mistral.referenceAudioTooLong` events fire when
// the pre-flight rejects oversized reference audio. `vi.hoisted` is required
// because vi.mock factories are hoisted above ordinary const declarations.
const { mockLoggerWarn, mockLoggerInfo } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  };
});

vi.mock('../MistralTtsClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../MistralTtsClient.js')>();
  return {
    ...actual,
    mistralListVoices: vi.fn(),
    mistralCloneVoice: vi.fn(),
    mistralTTS: vi.fn(),
  };
});

vi.mock('../voiceReferenceHelper.js', () => ({
  fetchVoiceReference: vi.fn().mockResolvedValue({
    audioBuffer: Buffer.from('reference-audio-bytes'),
    contentType: 'audio/wav',
  }),
}));

import { mistralListVoices, mistralCloneVoice, mistralTTS } from '../MistralTtsClient.js';
import { fetchVoiceReference } from '../voiceReferenceHelper.js';

const mockedListVoices = vi.mocked(mistralListVoices);
const mockedCloneVoice = vi.mocked(mistralCloneVoice);
const mockedTTS = vi.mocked(mistralTTS);
const mockedFetchVoiceReference = vi.mocked(fetchVoiceReference);

/** Wrap a voice array in the new discriminated `{ voices, truncated }` shape
 *  so existing tests don't need to repeat the `truncated: false` boilerplate. */
type Voice = Awaited<ReturnType<typeof mistralListVoices>>['voices'][number];
const okList = (voices: Voice[]) => ({ voices, truncated: false });
const truncatedList = (voices: Voice[]) => ({ voices, truncated: true });

describe('MistralTtsProvider', () => {
  let provider: MistralTtsProvider;

  beforeEach(() => {
    // resetAllMocks (not just clearAllMocks) so leftover `mockResolvedValueOnce`
    // queues from a prior test don't leak into the next. clearAllMocks resets
    // call history but preserves queued return values, which produces hard-to-
    // diagnose cross-test contamination when Once-mocks aren't fully consumed.
    vi.resetAllMocks();
    provider = new MistralTtsProvider();
    mockedFetchVoiceReference.mockResolvedValue({
      audioBuffer: Buffer.from('reference-audio-bytes'),
      contentType: 'audio/wav',
    });
  });

  describe('static contract', () => {
    it('reports id and displayName', () => {
      expect(provider.id).toBe('mistral');
      expect(provider.displayName).toContain('Mistral');
    });

    it('reports capabilities (5000 char cap, WAV output)', () => {
      expect(provider.capabilities.maxCharacters).toBe(5000);
      expect(provider.capabilities.outputFormat).toBe('wav');
      expect(provider.capabilities.requiresPrepare).toBe(true);
      expect(provider.capabilities.supportsReferenceAudio).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('returns true when byokKey is set and non-empty', () => {
      expect(provider.isAvailable({ slug: 's', byokKey: 'sk-real' })).toBe(true);
    });

    it('returns false when byokKey is missing or empty', () => {
      expect(provider.isAvailable({ slug: 's' })).toBe(false);
      expect(provider.isAvailable({ slug: 's', byokKey: '' })).toBe(false);
    });
  });

  describe('canHandle', () => {
    it('accepts mistral configs', () => {
      expect(
        provider.canHandle(
          {
            provider: 'mistral',
            modelId: 'voxtral-mini-tts-2603',
            advancedParameters: {},
            source: 'user-default',
          },
          { slug: 's' }
        )
      ).toBe(true);
    });

    it('rejects non-mistral configs', () => {
      expect(
        provider.canHandle(
          {
            provider: 'self-hosted',
            modelId: null,
            advancedParameters: {},
            source: 'free-default',
          },
          { slug: 's' }
        )
      ).toBe(false);
      expect(
        provider.canHandle(
          {
            provider: 'elevenlabs',
            modelId: 'eleven_v3',
            advancedParameters: {},
            source: 'user-default',
          },
          { slug: 's' }
        )
      ).toBe(false);
    });
  });

  describe('prepare — list-and-find', () => {
    it('returns existing voice id when name matches in voice list', async () => {
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'voice-existing', name: 'tzurot-emily', userId: 'user-1' }])
      );

      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-test' });

      expect(handle).toMatchObject({
        kind: 'voiceId',
        id: 'voice-existing',
        provider: 'mistral',
      });
      expect(mockedCloneVoice).not.toHaveBeenCalled();
      expect(mockedFetchVoiceReference).not.toHaveBeenCalled();
    });

    it('clones when no matching name in list', async () => {
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'voice-other', name: 'tzurot-different', userId: 'user-1' }])
      );
      mockedCloneVoice.mockResolvedValueOnce({
        id: 'voice-new',
        name: 'tzurot-emily',
        userId: 'user-1',
      });

      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-test' });

      expect(mockedFetchVoiceReference).toHaveBeenCalledWith('emily');
      expect(mockedCloneVoice).toHaveBeenCalledWith({
        name: 'tzurot-emily',
        audioBuffer: expect.any(Buffer),
        contentType: 'audio/wav',
        apiKey: 'sk-test',
      });
      expect(handle).toMatchObject({ kind: 'voiceId', id: 'voice-new' });
    });

    it('throws MistralVoiceListUnavailableError when listVoices fails all retries (no silent duplicate)', async () => {
      // Sticky rejection so all 3 retry attempts fail. Without the retry +
      // refuse-to-clone logic, this scenario produced one duplicate
      // `tzurot-${slug}` per prepare call until the list endpoint recovered.
      // Fake timers required (`02-code-standards.md`): retry backoffs are
      // 500ms-4s wall-clock; vi.runAllTimersAsync exhausts them instantly.
      vi.useFakeTimers();
      try {
        mockedListVoices.mockRejectedValue(new Error('list failed'));

        // Attach the rejection handler before advancing timers — fake timers
        // resolve scheduled callbacks synchronously, and the assertion's
        // `.rejects` chain needs to be subscribed first.
        const promise = provider.prepare({ slug: 'emily', byokKey: 'sk-test' });
        const assertion = expect(promise).rejects.toMatchObject({
          name: 'MistralVoiceListUnavailableError',
          reason: 'fetch-failed',
        });

        await vi.runAllTimersAsync();
        await assertion;

        expect(mockedCloneVoice).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fast-fails (no retries) on deterministic list errors like 401 auth', async () => {
      // `shouldRetry` should reject errors with `isTransient === false` so
      // a misconfigured key surfaces in 1 attempt rather than burning 3.
      // Without this, debugging an auth issue takes ~1.5s wall clock per
      // prepare call instead of ~30ms.
      vi.useFakeTimers();
      try {
        mockedListVoices.mockRejectedValue(new MistralApiError(401, 'unauthorized'));

        const promise = provider.prepare({ slug: 'emily', byokKey: 'sk-test' });
        const assertion = expect(promise).rejects.toMatchObject({
          name: 'MistralVoiceListUnavailableError',
          reason: 'fetch-failed',
        });
        await vi.runAllTimersAsync();
        await assertion;

        // Fast-fail: only 1 attempt, not 3
        expect(mockedListVoices).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('caches MistralVoiceListUnavailableError in negative cache (5min suppression)', async () => {
      // Verifies the second half of PR #976's design: the typed error must
      // hit the negative cache (because `isTransient = true`), so a second
      // call within 5 min short-circuits without re-running the retry loop.
      // Without this, a persistent list outage produces 3 retry attempts
      // PER prepare call rather than 3 attempts followed by 5 min of cache
      // hits.
      vi.useFakeTimers();
      try {
        mockedListVoices.mockRejectedValue(new Error('list failed'));

        // First call: 3 retry attempts → MistralVoiceListUnavailableError
        const firstPromise = provider.prepare({ slug: 'emily', byokKey: 'sk-test' });
        const firstAssertion = expect(firstPromise).rejects.toMatchObject({
          name: 'MistralVoiceListUnavailableError',
        });
        await vi.runAllTimersAsync();
        await firstAssertion;
        expect(mockedListVoices).toHaveBeenCalledTimes(3); // 3 retry attempts

        // Second call: should hit negative cache, NOT retry list again
        await expect(provider.prepare({ slug: 'emily', byokKey: 'sk-test' })).rejects.toThrow(
          /recently failed/
        );
        expect(mockedListVoices).toHaveBeenCalledTimes(3); // unchanged: cache hit
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws MistralVoiceListUnavailableError when list is truncated and voice not in prefix', async () => {
      // Cap-hit list with no match → cloning would risk a duplicate (the
      // voice could be on page 21+). Refuse and surface a typed error.
      mockedListVoices.mockResolvedValueOnce(
        truncatedList([{ id: 'voice-other', name: 'tzurot-different', userId: 'u' }])
      );

      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk-test' })).rejects.toMatchObject({
        name: 'MistralVoiceListUnavailableError',
        reason: 'truncated',
      });
      expect(mockedCloneVoice).not.toHaveBeenCalled();
    });

    it('recovers from transient list failure on retry → proceeds to find-by-name', async () => {
      // Documents the retry-success seam: first attempt rejects transiently,
      // second succeeds, find-by-name returns the matched voice. `withRetry`
      // is tested in isolation, but this seam-level test pins the contract
      // at the provider's call site.
      vi.useFakeTimers();
      try {
        mockedListVoices
          .mockRejectedValueOnce(new Error('transient blip'))
          .mockResolvedValueOnce(
            okList([{ id: 'voice-existing', name: 'tzurot-emily', userId: 'u' }])
          );

        const promise = provider.prepare({ slug: 'emily', byokKey: 'sk-test' });
        await vi.runAllTimersAsync();
        const handle = await promise;

        expect(handle).toMatchObject({ id: 'voice-existing' });
        expect(mockedListVoices).toHaveBeenCalledTimes(2);
        expect(mockedCloneVoice).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns existing voice from truncated prefix without cloning', async () => {
      // Even with truncated=true, finding the voice in the returned prefix
      // means we don't need pages 21+. No duplicate risk → use the match.
      mockedListVoices.mockResolvedValueOnce(
        truncatedList([{ id: 'voice-existing', name: 'tzurot-emily', userId: 'u' }])
      );

      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-test' });

      expect(handle).toMatchObject({ id: 'voice-existing' });
      expect(mockedCloneVoice).not.toHaveBeenCalled();
    });
  });

  describe('prepare — reference-audio pre-flight (30s limit)', () => {
    it('throws MistralReferenceAudioTooLongError when reference exceeds 30s, without calling clone', async () => {
      mockedListVoices.mockResolvedValueOnce(okList([])); // no existing voice → would clone
      mockedFetchVoiceReference.mockResolvedValueOnce({
        audioBuffer: Buffer.from('reference-audio-bytes'),
        contentType: 'audio/wav',
        durationSec: 31.78, // recreating the prod incident shape
      });

      const promise = provider.prepare({ slug: 'ha-shem-keev-ima', byokKey: 'sk-test' });

      const error = await promise.catch(e => e);
      expect(error).toBeInstanceOf(MistralReferenceAudioTooLongError);
      expect((error as MistralReferenceAudioTooLongError).durationSec).toBeCloseTo(31.78, 5);
      expect((error as MistralReferenceAudioTooLongError).limitSec).toBe(
        MISTRAL_MAX_REFERENCE_AUDIO_SEC
      );
      expect(mockedCloneVoice).not.toHaveBeenCalled();
    });

    it('emits structured `mistral.referenceAudioTooLong` event when pre-flight rejects', async () => {
      // Pins the event field that log consumers route on. Without this, a
      // future refactor that collapses the catch chain's first branch
      // (instanceof MistralReferenceAudioTooLongError) into the generic
      // `isDeterministicFailure` path would silently lose the structured
      // event field — the provider's prose comment guards against this in
      // narrative form, but this test makes it test-gated.
      mockedListVoices.mockResolvedValueOnce(okList([]));
      mockedFetchVoiceReference.mockResolvedValueOnce({
        audioBuffer: Buffer.from('reference-audio-bytes'),
        contentType: 'audio/wav',
        durationSec: 31.78,
      });

      await provider
        .prepare({ slug: 'ha-shem-keev-ima', byokKey: 'sk-test' })
        .catch((): void => undefined);

      // Find the WARN call carrying the structured event field. Use
      // `toContain`/`mock.calls` rather than `toHaveBeenCalledWith` so a
      // future addition of incidental fields doesn't break this assertion —
      // the event name + key fields are what matter.
      const warnCall = mockLoggerWarn.mock.calls.find(
        call => (call[0] as Record<string, unknown>)?.event === 'mistral.referenceAudioTooLong'
      );
      expect(warnCall).toBeDefined();
      const meta = warnCall![0] as Record<string, unknown>;
      expect(meta.slug).toBe('ha-shem-keev-ima');
      expect(meta.durationSec).toBeCloseTo(31.78, 5);
      expect(meta.limitSec).toBe(MISTRAL_MAX_REFERENCE_AUDIO_SEC);
    });

    it('proceeds to clone when reference is under the 30s limit', async () => {
      mockedListVoices.mockResolvedValueOnce(okList([]));
      mockedFetchVoiceReference.mockResolvedValueOnce({
        audioBuffer: Buffer.from('reference-audio-bytes'),
        contentType: 'audio/wav',
        durationSec: 12.3,
      });
      mockedCloneVoice.mockResolvedValueOnce({
        id: 'voice-new',
        name: 'tzurot-emily',
        userId: null,
      });

      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-test' });

      expect(handle).toMatchObject({ kind: 'voiceId', id: 'voice-new' });
      expect(mockedCloneVoice).toHaveBeenCalledTimes(1);
    });

    it('falls through to reactive path when durationSec is undefined (unrecognized format)', async () => {
      // mp3/ogg/m4a aren't parsed locally — fall through to whatever Mistral
      // returns. This locks in the "advisory, not authoritative" semantics.
      mockedListVoices.mockResolvedValueOnce(okList([]));
      mockedFetchVoiceReference.mockResolvedValueOnce({
        audioBuffer: Buffer.from('reference-audio-bytes'),
        contentType: 'audio/mpeg',
        durationSec: undefined,
      });
      mockedCloneVoice.mockResolvedValueOnce({
        id: 'voice-new',
        name: 'tzurot-emily',
        userId: null,
      });

      await provider.prepare({ slug: 'emily', byokKey: 'sk-test' });

      expect(mockedCloneVoice).toHaveBeenCalledTimes(1);
    });

    it('does not negative-cache the deterministic too-long failure (re-prepare hits pre-flight again, not cache)', async () => {
      mockedListVoices.mockResolvedValue(okList([]));
      mockedFetchVoiceReference.mockResolvedValue({
        audioBuffer: Buffer.from('reference-audio-bytes'),
        contentType: 'audio/wav',
        durationSec: 35,
      });

      // First call fails pre-flight
      await provider
        .prepare({ slug: 'too-long-slug', byokKey: 'sk-test' })
        .catch((): void => undefined);

      // Second call also fails pre-flight (not the negative-cache message)
      const error = await provider
        .prepare({ slug: 'too-long-slug', byokKey: 'sk-test' })
        .catch(e => e);

      expect(error).toBeInstanceOf(MistralReferenceAudioTooLongError);
      // If the negative cache had captured the first failure, the second call
      // would throw a generic Error wrapping the cached `reason` string. The
      // typed error confirms pre-flight ran cleanly both times.
    });
  });

  describe('prepare — caching', () => {
    it('caches successful clone result (subsequent prepare uses cache)', async () => {
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'v-1', name: 'tzurot-emily', userId: 'u' }])
      );

      await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      await provider.prepare({ slug: 'emily', byokKey: 'sk' });

      expect(mockedListVoices).toHaveBeenCalledTimes(1);
    });

    it('different api keys → different cache entries', async () => {
      // Use 12+ char keys — sub-12-char keys all collapse to the '[short-key]'
      // sentinel by design (test fixtures shouldn't leak full keys into cache
      // keys / debug logs in deployed environments).
      mockedListVoices
        .mockResolvedValueOnce(okList([{ id: 'v-1', name: 'tzurot-emily', userId: 'u-a' }]))
        .mockResolvedValueOnce(okList([{ id: 'v-2', name: 'tzurot-emily', userId: 'u-b' }]));

      // Suffix uses first-4 + last-8 chars, so keys must differ in either of
      // those windows (not just the middle).
      const a = await provider.prepare({ slug: 'emily', byokKey: 'sk-A1234567890ABC' });
      const b = await provider.prepare({ slug: 'emily', byokKey: 'sk-B1234567890ABC' });

      expect(a).toMatchObject({ id: 'v-1' });
      expect(b).toMatchObject({ id: 'v-2' });
      expect(mockedListVoices).toHaveBeenCalledTimes(2);
    });
  });

  describe('prepare — failure handling', () => {
    it('caches transient (5xx) failures in negative cache (5min)', async () => {
      // 5xx server errors are transient (could clear on retry), so the cache
      // suppresses retry storms while preserving the option to retry after TTL.
      mockedListVoices.mockResolvedValueOnce(okList([]));
      mockedCloneVoice.mockRejectedValueOnce(new MistralApiError(503, 'service unavailable'));

      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toThrow();

      // Second attempt should hit negative cache (no list call)
      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toThrow(
        /recently failed/
      );

      expect(mockedListVoices).toHaveBeenCalledTimes(1);
    });

    it('does NOT negative-cache deterministic 4xx failures (e.g. 400, 401)', async () => {
      // 400/401 are deterministic from input — caching adds nothing because
      // the same input will keep failing. Re-running goes through the full
      // list+clone path again rather than hitting the cache.
      mockedListVoices.mockResolvedValue(okList([]));
      mockedCloneVoice.mockRejectedValueOnce(new MistralApiError(400, 'malformed audio'));

      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toBeInstanceOf(
        MistralApiError
      );

      // Second attempt: cache is NOT populated, so it tries again. We mock
      // a success here to verify the cache didn't suppress the retry.
      mockedCloneVoice.mockResolvedValueOnce({
        id: 'v-recovered',
        name: 'tzurot-emily',
        userId: 'u',
      });
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      expect(handle).toMatchObject({ id: 'v-recovered' });
      // listVoices ran twice (no negative-cache short-circuit on second prepare)
      expect(mockedListVoices).toHaveBeenCalledTimes(2);
    });

    it('caches generic Error (no isTransient field) — preserves prior default-cache behavior', async () => {
      // Errors without an `isTransient` field (e.g., network blips, Node
      // ENOENT, generic Error) are treated as transient and cached. Documents
      // the "default to cache when unsure" semantic of isDeterministicFailure.
      mockedListVoices.mockResolvedValueOnce(okList([]));
      mockedCloneVoice.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toThrow();

      // Second attempt should hit negative cache (no list call)
      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toThrow(
        /recently failed/
      );

      expect(mockedListVoices).toHaveBeenCalledTimes(1);
    });

    it('does NOT negative-cache 429 rate limits (transient but too granular for blanket cache)', async () => {
      // Rate limits are technically transient, but Mistral's retry-after
      // header is more precise than a 5-min blanket cache. Skip caching here
      // to allow the caller's retry-after handling to govern.
      mockedListVoices.mockResolvedValue(okList([]));
      mockedCloneVoice.mockRejectedValueOnce(new MistralApiError(429, 'rate limit'));

      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toBeInstanceOf(
        MistralApiError
      );

      // Second attempt should retry (no negative cache hit)
      mockedCloneVoice.mockResolvedValueOnce({
        id: 'v-recovered',
        name: 'tzurot-emily',
        userId: 'u',
      });
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      expect(handle).toMatchObject({ id: 'v-recovered' });
    });

    it('throws when byokKey is missing', async () => {
      await expect(provider.prepare({ slug: 'emily' })).rejects.toThrow(/byokKey/);
    });
  });

  describe('eviction mutex', () => {
    it('serializes concurrent prepare() calls', async () => {
      let resolveFirst:
        ((v: { id: string; name: string; userId: string | null }) => void) | undefined;
      let resolveSecond:
        ((v: { id: string; name: string; userId: string | null }) => void) | undefined;

      mockedListVoices.mockResolvedValue(okList([]));
      mockedCloneVoice
        .mockImplementationOnce(
          () =>
            new Promise(r => {
              resolveFirst = r;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise(r => {
              resolveSecond = r;
            })
        );

      const p1 = provider.prepare({ slug: 'a', byokKey: 'sk' });
      const p2 = provider.prepare({ slug: 'b', byokKey: 'sk' });

      // Wait for the first mutex chain step + listVoices + retry pipeline
      // to settle and dispatch clone. `vi.waitFor` polls until the condition
      // holds, which is more robust than counting yields (the retry layer
      // added microtasks that the previous fixed-yield count didn't account
      // for).
      await vi.waitFor(() => expect(mockedCloneVoice).toHaveBeenCalledTimes(1));

      resolveFirst?.({ id: 'voice-a', name: 'tzurot-a', userId: 'u' });
      await p1;
      await vi.waitFor(() => expect(mockedCloneVoice).toHaveBeenCalledTimes(2));

      resolveSecond?.({ id: 'voice-b', name: 'tzurot-b', userId: 'u' });
      const h2 = await p2;
      expect(h2).toMatchObject({ id: 'voice-b' });
    });
  });

  describe('synthesize', () => {
    it('calls mistralTTS with handle id + ctx.byokKey + ctx.modelId', async () => {
      mockedTTS.mockResolvedValueOnce({
        audioBuffer: Buffer.from('synthesized-bytes'),
        contentType: 'audio/wav',
      });
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'voice-uuid', name: 'tzurot-emily', userId: 'u' }])
      );

      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      const buf = await provider.synthesize('hello', handle, {
        slug: 'emily',
        byokKey: 'sk',
        modelId: 'voxtral-mini-tts-2603',
      });

      expect(mockedTTS).toHaveBeenCalledWith({
        text: 'hello',
        voiceId: 'voice-uuid',
        apiKey: 'sk',
        modelId: 'voxtral-mini-tts-2603',
      });
      expect(buf.toString('utf8')).toBe('synthesized-bytes');
    });

    it('throws when ctx.byokKey is missing', async () => {
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'v', name: 'tzurot-emily', userId: 'u' }])
      );
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      await expect(provider.synthesize('hello', handle, { slug: 'emily' })).rejects.toThrow(
        /byokKey/
      );
    });

    it('invalidates positive cache when synthesize throws 404', async () => {
      // First: prepare populates the cache
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'voice-stale', name: 'tzurot-emily', userId: 'u' }])
      );
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });

      // synthesize 404s with a MistralApiError
      mockedTTS.mockRejectedValueOnce(new MistralApiError(404, 'voice not found'));
      await expect(
        provider.synthesize('x', handle, { slug: 'emily', byokKey: 'sk' })
      ).rejects.toBeInstanceOf(MistralApiError);

      // Next prepare must hit listVoices again (cache evicted)
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'voice-fresh', name: 'tzurot-emily', userId: 'u' }])
      );
      const handle2 = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      expect(handle2).toMatchObject({ id: 'voice-fresh' });
      expect(mockedListVoices).toHaveBeenCalledTimes(2);
    });

    it('does NOT invalidate cache on non-404 errors', async () => {
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'voice-uuid', name: 'tzurot-emily', userId: 'u' }])
      );
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });

      // synthesize 429s (rate limited)
      mockedTTS.mockRejectedValueOnce(new MistralApiError(429, 'rate limit'));
      await expect(
        provider.synthesize('x', handle, { slug: 'emily', byokKey: 'sk' })
      ).rejects.toBeInstanceOf(MistralApiError);

      // Next prepare hits cache, no new listVoices call
      const handle2 = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      expect(handle2).toMatchObject({ id: 'voice-uuid' });
      expect(mockedListVoices).toHaveBeenCalledTimes(1);
    });

    it('rejects inlineAudio handles', async () => {
      const stateless: ReturnType<typeof Object> = {
        _brand: 'prepared',
        kind: 'inlineAudio',
        buffer: Buffer.from([0]),
        mimeType: 'audio/wav',
        provider: 'mistral',
      };

      await expect(
        provider.synthesize('x', stateless as any, { slug: 's', byokKey: 'k' })
      ).rejects.toThrow(/inlineAudio/);
    });
  });

  describe('invalidateVoice', () => {
    it('removes positive + negative cache entries for a slug+key', async () => {
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'v', name: 'tzurot-emily', userId: 'u' }])
      );
      await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      // Cached now

      provider.invalidateVoice('emily', 'sk');

      // Next prepare should hit listVoices again
      mockedListVoices.mockResolvedValueOnce(
        okList([{ id: 'v-fresh', name: 'tzurot-emily', userId: 'u' }])
      );
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      expect(handle).toMatchObject({ id: 'v-fresh' });
      expect(mockedListVoices).toHaveBeenCalledTimes(2);
    });
  });
});
