import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MistralTtsProvider } from './MistralTtsProvider.js';
import { MistralApiError } from '../MistralTtsClient.js';

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

describe('MistralTtsProvider', () => {
  let provider: MistralTtsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
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
      mockedListVoices.mockResolvedValueOnce([
        { id: 'voice-existing', name: 'tzurot-emily', userId: 'user-1' },
      ]);

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
      mockedListVoices.mockResolvedValueOnce([
        { id: 'voice-other', name: 'tzurot-different', userId: 'user-1' },
      ]);
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

    it('proceeds to clone when listVoices throws (eventual-consistency tolerance)', async () => {
      mockedListVoices.mockRejectedValueOnce(new Error('list failed'));
      mockedCloneVoice.mockResolvedValueOnce({
        id: 'voice-new',
        name: 'tzurot-emily',
        userId: null,
      });

      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-test' });

      expect(handle).toMatchObject({ kind: 'voiceId', id: 'voice-new' });
    });
  });

  describe('prepare — caching', () => {
    it('caches successful clone result (subsequent prepare uses cache)', async () => {
      mockedListVoices.mockResolvedValueOnce([{ id: 'v-1', name: 'tzurot-emily', userId: 'u' }]);

      await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      await provider.prepare({ slug: 'emily', byokKey: 'sk' });

      expect(mockedListVoices).toHaveBeenCalledTimes(1);
    });

    it('different api keys → different cache entries', async () => {
      mockedListVoices
        .mockResolvedValueOnce([{ id: 'v-1', name: 'tzurot-emily', userId: 'u-a' }])
        .mockResolvedValueOnce([{ id: 'v-2', name: 'tzurot-emily', userId: 'u-b' }]);

      const a = await provider.prepare({ slug: 'emily', byokKey: 'sk-A' });
      const b = await provider.prepare({ slug: 'emily', byokKey: 'sk-B' });

      expect(a).toMatchObject({ id: 'v-1' });
      expect(b).toMatchObject({ id: 'v-2' });
      expect(mockedListVoices).toHaveBeenCalledTimes(2);
    });
  });

  describe('prepare — failure handling', () => {
    it('caches non-rate-limit failures in negative cache (5min)', async () => {
      mockedListVoices.mockResolvedValueOnce([]);
      mockedCloneVoice.mockRejectedValueOnce(new MistralApiError(400, 'malformed audio'));

      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toThrow();

      // Second attempt should hit negative cache (no list call)
      await expect(provider.prepare({ slug: 'emily', byokKey: 'sk' })).rejects.toThrow(
        /recently failed/
      );

      expect(mockedListVoices).toHaveBeenCalledTimes(1);
    });

    it('does NOT negatively cache 429 rate limits (transient)', async () => {
      mockedListVoices.mockResolvedValue([]);
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
        | ((v: { id: string; name: string; userId: string | null }) => void)
        | undefined;
      let resolveSecond:
        | ((v: { id: string; name: string; userId: string | null }) => void)
        | undefined;

      mockedListVoices.mockResolvedValue([]);
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

      // Yield once so the first .then() in the mutex chain fires
      await Promise.resolve();
      // Plus another for the listVoices promise to settle and dispatch clone
      await Promise.resolve();
      await Promise.resolve();
      expect(mockedCloneVoice).toHaveBeenCalledTimes(1);

      resolveFirst?.({ id: 'voice-a', name: 'tzurot-a', userId: 'u' });
      await p1;
      // Yield for the second mutex .then() + its listVoices
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockedCloneVoice).toHaveBeenCalledTimes(2);

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
      mockedListVoices.mockResolvedValueOnce([
        { id: 'voice-uuid', name: 'tzurot-emily', userId: 'u' },
      ]);

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
      mockedListVoices.mockResolvedValueOnce([{ id: 'v', name: 'tzurot-emily', userId: 'u' }]);
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      await expect(provider.synthesize('hello', handle, { slug: 'emily' })).rejects.toThrow(
        /byokKey/
      );
    });

    it('invalidates positive cache when synthesize throws 404', async () => {
      // First: prepare populates the cache
      mockedListVoices.mockResolvedValueOnce([
        { id: 'voice-stale', name: 'tzurot-emily', userId: 'u' },
      ]);
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });

      // synthesize 404s with a MistralApiError
      mockedTTS.mockRejectedValueOnce(new MistralApiError(404, 'voice not found'));
      await expect(
        provider.synthesize('x', handle, { slug: 'emily', byokKey: 'sk' })
      ).rejects.toBeInstanceOf(MistralApiError);

      // Next prepare must hit listVoices again (cache evicted)
      mockedListVoices.mockResolvedValueOnce([
        { id: 'voice-fresh', name: 'tzurot-emily', userId: 'u' },
      ]);
      const handle2 = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      expect(handle2).toMatchObject({ id: 'voice-fresh' });
      expect(mockedListVoices).toHaveBeenCalledTimes(2);
    });

    it('does NOT invalidate cache on non-404 errors', async () => {
      mockedListVoices.mockResolvedValueOnce([
        { id: 'voice-uuid', name: 'tzurot-emily', userId: 'u' },
      ]);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hand-built handle for test
      await expect(
        provider.synthesize('x', stateless as any, { slug: 's', byokKey: 'k' })
      ).rejects.toThrow(/inlineAudio/);
    });
  });

  describe('invalidateVoice', () => {
    it('removes positive + negative cache entries for a slug+key', async () => {
      mockedListVoices.mockResolvedValueOnce([{ id: 'v', name: 'tzurot-emily', userId: 'u' }]);
      await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      // Cached now

      provider.invalidateVoice('emily', 'sk');

      // Next prepare should hit listVoices again
      mockedListVoices.mockResolvedValueOnce([
        { id: 'v-fresh', name: 'tzurot-emily', userId: 'u' },
      ]);
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk' });
      expect(handle).toMatchObject({ id: 'v-fresh' });
      expect(mockedListVoices).toHaveBeenCalledTimes(2);
    });
  });
});
