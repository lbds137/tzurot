import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelfHostedTtsProvider } from './SelfHostedTtsProvider.js';

vi.mock('../ttsSynthesizer.js', () => ({
  synthesizeWithChunking: vi
    .fn()
    .mockResolvedValue({
      audioBuffer: Buffer.from([0x4f, 0x67, 0x67, 0x53]),
      contentType: 'audio/ogg',
    }),
}));
import { synthesizeWithChunking } from '../ttsSynthesizer.js';

const mockedSynthesizeWithChunking = vi.mocked(synthesizeWithChunking);

interface MockRegService {
  client: { _isMockClient: true };
  ensureVoiceRegistered: ReturnType<typeof vi.fn>;
}

function makeService(): MockRegService {
  return {
    client: { _isMockClient: true },
    ensureVoiceRegistered: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SelfHostedTtsProvider', () => {
  let regService: MockRegService;
  let provider: SelfHostedTtsProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    regService = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test double for VoiceRegistrationService
    provider = new SelfHostedTtsProvider(regService as any);
  });

  describe('static contract', () => {
    it('reports id and displayName', () => {
      expect(provider.id).toBe('self-hosted');
      expect(provider.displayName).toContain('Self-hosted');
    });

    it('reports capabilities', () => {
      expect(provider.capabilities.requiresPrepare).toBe(true);
      expect(provider.capabilities.supportsReferenceAudio).toBe(true);
      expect(provider.capabilities.outputFormat).toBe('opus');
    });
  });

  describe('isAvailable', () => {
    it('always returns true (constructor-time check is upstream)', () => {
      expect(provider.isAvailable({ slug: 'whatever' })).toBe(true);
    });
  });

  describe('canHandle', () => {
    it('accepts self-hosted configs', () => {
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
      ).toBe(true);
    });

    it('rejects elevenlabs and mistral configs', () => {
      const elev = {
        provider: 'elevenlabs' as const,
        modelId: 'eleven_v3',
        advancedParameters: {},
        source: 'user-default' as const,
      };
      expect(provider.canHandle(elev, { slug: 's' })).toBe(false);
    });
  });

  describe('prepare', () => {
    it('registers the voice and returns a voiceId handle keyed by slug', async () => {
      const handle = await provider.prepare({ slug: 'lila-zot-lilit' });
      expect(regService.ensureVoiceRegistered).toHaveBeenCalledWith('lila-zot-lilit');
      expect(handle).toMatchObject({
        kind: 'voiceId',
        id: 'lila-zot-lilit',
        provider: 'self-hosted',
      });
    });

    it('propagates registration errors', async () => {
      regService.ensureVoiceRegistered.mockRejectedValueOnce(new Error('registration boom'));
      await expect(provider.prepare({ slug: 'broken-slug' })).rejects.toThrow('registration boom');
    });
  });

  describe('synthesize', () => {
    it('delegates to synthesizeWithChunking with the handle id', async () => {
      const handle = await provider.prepare({ slug: 'emily' });
      const buf = await provider.synthesize('hello', handle, { slug: 'emily' });
      expect(mockedSynthesizeWithChunking).toHaveBeenCalledWith(
        regService.client,
        'hello',
        'emily'
      );
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('rejects inlineAudio handles', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hand-built handle for test
      const stateless: any = {
        _brand: 'prepared',
        kind: 'inlineAudio',
        buffer: Buffer.from([0]),
        mimeType: 'audio/wav',
        provider: 'self-hosted',
      };
      await expect(provider.synthesize('x', stateless, { slug: 's' })).rejects.toThrow(
        /inlineAudio/
      );
    });
  });
});
