/**
 * Tests for VoiceRegistrationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceRegistrationService } from './VoiceRegistrationService.js';
import type { VoiceEngineClient } from './VoiceEngineClient.js';
import type { EnvConfig } from '@tzurot/common-types';
import * as commonTypes from '@tzurot/common-types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VoiceRegistrationService', () => {
  let service: VoiceRegistrationService;
  let mockVoiceEngineClient: {
    listVoices: ReturnType<typeof vi.fn>;
    registerVoice: ReturnType<typeof vi.fn>;
  };
  let getConfigSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockVoiceEngineClient = {
      listVoices: vi.fn(),
      registerVoice: vi.fn(),
    };

    getConfigSpy = vi.spyOn(commonTypes, 'getConfig').mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
    } as unknown as EnvConfig);

    service = new VoiceRegistrationService(mockVoiceEngineClient as unknown as VoiceEngineClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should skip listVoices on cache hit (second call for same slug)', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue(['my-voice']);

    await service.ensureVoiceRegistered('my-voice');
    await service.ensureVoiceRegistered('my-voice');

    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(1);
  });

  it('should cache and return when voice is already registered on voice-engine', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue(['existing-voice', 'other-voice']);

    await service.ensureVoiceRegistered('existing-voice');

    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockVoiceEngineClient.registerVoice).not.toHaveBeenCalled();
  });

  it('should fetch from gateway and register when voice is not on voice-engine', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });

    await service.ensureVoiceRegistered('new-voice');

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/voice-references/new-voice');
    expect(mockVoiceEngineClient.registerVoice).toHaveBeenCalledWith(
      'new-voice',
      expect.any(Buffer),
      'audio/wav'
    );
  });

  it('should throw when gateway fetch returns 404', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(service.ensureVoiceRegistered('missing-voice')).rejects.toThrow(
      'Failed to fetch voice reference for "missing-voice": 404 Not Found'
    );
  });

  it('should attempt registration when listVoices fails', async () => {
    mockVoiceEngineClient.listVoices.mockRejectedValue(new Error('Connection refused'));
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(50)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });

    await service.ensureVoiceRegistered('fallback-voice');

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/voice-references/fallback-voice');
    expect(mockVoiceEngineClient.registerVoice).toHaveBeenCalledWith(
      'fallback-voice',
      expect.any(Buffer),
      'audio/wav'
    );
  });

  it('should throw when GATEWAY_URL is not configured', async () => {
    getConfigSpy.mockReturnValue({
      GATEWAY_URL: undefined,
    } as unknown as EnvConfig);

    mockVoiceEngineClient.listVoices.mockResolvedValue([]);

    await expect(service.ensureVoiceRegistered('no-gateway')).rejects.toThrow(
      'GATEWAY_URL not configured'
    );
  });

  it('should go through full flow after clearCache', async () => {
    // First call: registers and caches
    mockVoiceEngineClient.listVoices.mockResolvedValue(['cached-voice']);
    await service.ensureVoiceRegistered('cached-voice');
    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(1);

    // Clear cache
    service.clearCache();

    // Second call: must go through listVoices again
    mockVoiceEngineClient.listVoices.mockResolvedValue(['cached-voice']);
    await service.ensureVoiceRegistered('cached-voice');
    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(2);
  });

  it('should default content-type to audio/wav when header is null', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(80)),
      headers: { get: vi.fn().mockReturnValue(null) },
    });

    await service.ensureVoiceRegistered('null-ct-voice');

    expect(mockVoiceEngineClient.registerVoice).toHaveBeenCalledWith(
      'null-ct-voice',
      expect.any(Buffer),
      'audio/wav'
    );
  });

  it('should URL-encode the slug in the gateway request', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(60)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });

    await service.ensureVoiceRegistered('voice with spaces');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/voice%20with%20spaces'
    );
  });
});
