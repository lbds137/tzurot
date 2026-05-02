import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the voice-engine client factory at the module boundary so the registry
// can simulate "VOICE_ENGINE_URL configured" vs. "missing" without spinning up
// real config plumbing.
vi.mock('./VoiceEngineClient.js', () => ({
  getVoiceEngineClient: vi.fn(),
}));

// Mock the voice services to avoid construction side effects (Redis, Prisma, etc.)
// Using class stubs because the registry constructs them with `new`.
vi.mock('./ElevenLabsVoiceService.js', () => ({
  ElevenLabsVoiceService: class {},
}));
vi.mock('./VoiceRegistrationService.js', () => ({
  VoiceRegistrationService: class {
    client = {};
  },
}));

import { getVoiceEngineClient } from './VoiceEngineClient.js';
import { ttsProviderRegistry, resetTtsProviderRegistry } from './ttsProviderRegistry.js';

const mockedGetClient = vi.mocked(getVoiceEngineClient);

beforeEach(() => {
  resetTtsProviderRegistry();
  mockedGetClient.mockReset();
});

afterEach(() => {
  resetTtsProviderRegistry();
});

describe('ttsProviderRegistry', () => {
  it('registers elevenlabs and mistral and self-hosted when voice-engine is configured', () => {
    mockedGetClient.mockReturnValue({} as never);

    const ids = ttsProviderRegistry.listProviderIds();

    expect(ids).toEqual(['elevenlabs', 'mistral', 'self-hosted']);
    expect(ttsProviderRegistry.getProvider('elevenlabs')?.id).toBe('elevenlabs');
    expect(ttsProviderRegistry.getProvider('mistral')?.id).toBe('mistral');
    expect(ttsProviderRegistry.getProvider('self-hosted')?.id).toBe('self-hosted');
  });

  it('omits self-hosted when VOICE_ENGINE_URL is not configured', () => {
    mockedGetClient.mockReturnValue(null);

    const ids = ttsProviderRegistry.listProviderIds();

    expect(ids).toEqual(['elevenlabs', 'mistral']);
    expect(ttsProviderRegistry.getProvider('self-hosted')).toBeUndefined();
    expect(ttsProviderRegistry.getProvider('elevenlabs')).toBeDefined();
    expect(ttsProviderRegistry.getProvider('mistral')).toBeDefined();
  });

  it('caches the instances — repeated lookups return the same object', () => {
    mockedGetClient.mockReturnValue({} as never);

    const first = ttsProviderRegistry.getProvider('mistral');
    const second = ttsProviderRegistry.getProvider('mistral');
    expect(first).toBe(second);
  });

  it('resetTtsProviderRegistry rebuilds the registry on next access', () => {
    mockedGetClient.mockReturnValue({} as never);
    const before = ttsProviderRegistry.getProvider('mistral');

    resetTtsProviderRegistry();
    mockedGetClient.mockReturnValue(null);

    const idsAfter = ttsProviderRegistry.listProviderIds();
    expect(idsAfter).not.toContain('self-hosted');
    // mistral instance is rebuilt — different object
    const after = ttsProviderRegistry.getProvider('mistral');
    expect(after).not.toBe(before);
  });

  it('listProviderIds preserves registration order', () => {
    mockedGetClient.mockReturnValue({} as never);
    const ids = ttsProviderRegistry.listProviderIds();
    expect(ids).toEqual(['elevenlabs', 'mistral', 'self-hosted']);
  });
});
