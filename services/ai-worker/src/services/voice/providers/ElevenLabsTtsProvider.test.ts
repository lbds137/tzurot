import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElevenLabsTtsProvider } from './ElevenLabsTtsProvider.js';

// importOriginal preserves the real `ElevenLabsApiError` class so the
// provider's `instanceof ElevenLabsApiError` check works at runtime; only
// `elevenLabsTTS` (the network call) is replaced.
vi.mock('../ElevenLabsClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../ElevenLabsClient.js')>();
  return {
    ...actual,
    elevenLabsTTS: vi.fn().mockResolvedValue({
      audioBuffer: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
      contentType: 'audio/mpeg',
    }),
  };
});
import { elevenLabsTTS, ElevenLabsApiError } from '../ElevenLabsClient.js';

const mockedElevenLabsTTS = vi.mocked(elevenLabsTTS);

interface MockVoiceService {
  ensureVoiceCloned: ReturnType<typeof vi.fn>;
  invalidateVoice: ReturnType<typeof vi.fn>;
}

function makeService(): MockVoiceService {
  return {
    ensureVoiceCloned: vi.fn().mockResolvedValue('voice-uuid-abc'),
    invalidateVoice: vi.fn(),
  };
}

describe('ElevenLabsTtsProvider', () => {
  let voiceService: MockVoiceService;
  let provider: ElevenLabsTtsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    voiceService = makeService();

    provider = new ElevenLabsTtsProvider(voiceService as any);
  });

  describe('static contract', () => {
    it('reports id and displayName', () => {
      expect(provider.id).toBe('elevenlabs');
      expect(provider.displayName).toContain('ElevenLabs');
    });

    it('reports capabilities (5000 char cap, MP3 output)', () => {
      expect(provider.capabilities.maxCharacters).toBe(5000);
      expect(provider.capabilities.outputFormat).toBe('mp3');
      expect(provider.capabilities.requiresPrepare).toBe(true);
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
    it('accepts elevenlabs configs', () => {
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
      ).toBe(true);
    });

    it('rejects self-hosted and mistral configs', () => {
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
    });
  });

  describe('prepare', () => {
    it('calls ensureVoiceCloned with slug + byokKey, returns voiceId handle', async () => {
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-real' });
      expect(voiceService.ensureVoiceCloned).toHaveBeenCalledWith('emily', 'sk-real');
      expect(handle).toMatchObject({
        kind: 'voiceId',
        id: 'voice-uuid-abc',
        provider: 'elevenlabs',
      });
    });

    it('throws when byokKey is missing', async () => {
      await expect(provider.prepare({ slug: 'emily' })).rejects.toThrow(/byokKey/);
    });

    it('serializes concurrent prepare() calls via the eviction mutex', async () => {
      // Simulate slow clone — both prepare() calls land before either resolves.
      let resolveFirst: ((id: string) => void) | undefined;
      let resolveSecond: ((id: string) => void) | undefined;
      voiceService.ensureVoiceCloned
        .mockImplementationOnce(
          () =>
            new Promise<string>(r => {
              resolveFirst = r;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise<string>(r => {
              resolveSecond = r;
            })
        );

      const p1 = provider.prepare({ slug: 'a', byokKey: 'k' });
      const p2 = provider.prepare({ slug: 'b', byokKey: 'k' });

      // The mutex serializes — only the first should be in flight initially.
      // Yield once so the .then() chain on the resolved initial mutex runs.
      await Promise.resolve();
      expect(voiceService.ensureVoiceCloned).toHaveBeenCalledTimes(1);

      // Resolve first; second should now begin (after the chained .then runs).
      resolveFirst?.('voice-1');
      await p1;
      // Yield for the second .then() in the chain to fire.
      await Promise.resolve();
      expect(voiceService.ensureVoiceCloned).toHaveBeenCalledTimes(2);

      resolveSecond?.('voice-2');
      const handle2 = await p2;
      expect(handle2).toMatchObject({ kind: 'voiceId', id: 'voice-2' });
    });

    it('failed prepare does not poison the chain — subsequent prepare() can succeed', async () => {
      voiceService.ensureVoiceCloned
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce('voice-recovery');

      await expect(provider.prepare({ slug: 'fail', byokKey: 'k' })).rejects.toThrow(
        'first failed'
      );

      // Second call should still be able to clone successfully.
      const handle = await provider.prepare({ slug: 'recover', byokKey: 'k' });
      expect(handle).toMatchObject({ kind: 'voiceId', id: 'voice-recovery' });
    });
  });

  describe('synthesize', () => {
    it('calls elevenLabsTTS with handle id + ctx.byokKey + ctx.modelId', async () => {
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-real' });
      const buf = await provider.synthesize('hello', handle, {
        slug: 'emily',
        byokKey: 'sk-real',
        modelId: 'eleven_v3',
      });
      expect(mockedElevenLabsTTS).toHaveBeenCalledWith({
        text: 'hello',
        voiceId: 'voice-uuid-abc',
        apiKey: 'sk-real',
        modelId: 'eleven_v3',
      });
      expect(buf).toBeInstanceOf(Buffer);
    });

    it('throws when ctx.byokKey is missing', async () => {
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-real' });
      await expect(provider.synthesize('hello', handle, { slug: 'emily' })).rejects.toThrow(
        /byokKey/
      );
    });

    it('rejects inlineAudio handles', async () => {
      const stateless: any = {
        _brand: 'prepared',
        kind: 'inlineAudio',
        buffer: Buffer.from([0]),
        mimeType: 'audio/wav',
        provider: 'elevenlabs',
      };
      await expect(
        provider.synthesize('x', stateless, { slug: 's', byokKey: 'k' })
      ).rejects.toThrow(/inlineAudio/);
    });

    it('invalidates voice cache when synthesize throws 404', async () => {
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-real' });

      mockedElevenLabsTTS.mockRejectedValueOnce(new ElevenLabsApiError(404, 'voice not found'));

      await expect(
        provider.synthesize('x', handle, { slug: 'emily', byokKey: 'sk-real' })
      ).rejects.toBeInstanceOf(ElevenLabsApiError);

      expect(voiceService.invalidateVoice).toHaveBeenCalledWith('emily', 'sk-real');
    });

    it('does NOT invalidate voice cache on non-404 errors', async () => {
      const handle = await provider.prepare({ slug: 'emily', byokKey: 'sk-real' });

      mockedElevenLabsTTS.mockRejectedValueOnce(new ElevenLabsApiError(429, 'rate limit'));

      await expect(
        provider.synthesize('x', handle, { slug: 'emily', byokKey: 'sk-real' })
      ).rejects.toBeInstanceOf(ElevenLabsApiError);

      expect(voiceService.invalidateVoice).not.toHaveBeenCalled();
    });
  });
});
