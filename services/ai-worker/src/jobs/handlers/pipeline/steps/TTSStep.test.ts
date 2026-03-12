/**
 * TTSStep Unit Tests
 *
 * Tests the post-generation TTS synthesis step including:
 * - shouldRunTTS logic (voice mode, voice enabled, success state)
 * - Successful TTS flow (register → synthesize → store)
 * - Graceful degradation on errors and timeouts
 *
 * WARNING: TTSStep uses a lazy singleton for VoiceRegistrationService.
 * Always call resetTTSStepState() in beforeEach/afterEach to prevent
 * stale singleton state from leaking between test files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType, type LLMGenerationJobData, type LoadedPersonality } from '@tzurot/common-types';
import type { GenerationContext } from '../types.js';

// --- Mocks ---

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const mockEnsureVoiceRegistered = vi.fn().mockResolvedValue(undefined);

const mockVoiceEngineClient = {
  synthesize: vi.fn(),
  getHealth: vi.fn().mockResolvedValue({ asr: true, tts: true }),
};

vi.mock('../../../../services/voice/VoiceRegistrationService.js', () => ({
  VoiceRegistrationService: class MockVoiceRegistrationService {
    client = mockVoiceEngineClient;
    ensureVoiceRegistered = mockEnsureVoiceRegistered;
  },
}));

const mockGetVoiceEngineClient = vi.fn();
vi.mock('../../../../services/voice/VoiceEngineClient.js', () => ({
  getVoiceEngineClient: (...args: unknown[]) => mockGetVoiceEngineClient(...args),
}));

const mockSynthesizeWithChunking = vi.fn();
vi.mock('../../../../services/voice/ttsSynthesizer.js', () => ({
  synthesizeWithChunking: (...args: unknown[]) => mockSynthesizeWithChunking(...args),
}));

const mockEnsureVoiceCloned = vi.fn();
const mockInvalidateVoice = vi.fn();
vi.mock('../../../../services/voice/ElevenLabsVoiceService.js', () => ({
  ElevenLabsVoiceService: class MockElevenLabsVoiceService {
    ensureVoiceCloned = mockEnsureVoiceCloned;
    invalidateVoice = mockInvalidateVoice;
  },
}));

const mockElevenLabsTTS = vi.fn();

// Use importOriginal to preserve real error classes — eliminates mock drift risk
// from duplicated getters. Only elevenLabsTTS is mocked; error classification
// (isAuthError, isTransient, isVoiceLimitError) uses the real class logic.
vi.mock('../../../../services/voice/ElevenLabsClient.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../services/voice/ElevenLabsClient.js')>();
  return {
    ...actual,
    elevenLabsTTS: (...args: unknown[]) => mockElevenLabsTTS(...args),
  };
});

const { ElevenLabsApiError, ElevenLabsTimeoutError } =
  await import('../../../../services/voice/ElevenLabsClient.js');

// NOTE: withRetry/RetryError use the real module (no mock).
// Backoff delays are handled by vi.useFakeTimers() + vi.runAllTimersAsync().

const mockStoreTTSAudio = vi.fn();
vi.mock('../../../../redis.js', () => ({
  redisService: {
    storeTTSAudio: (...args: unknown[]) => mockStoreTTSAudio(...args),
  },
}));

// Import after mocks
const { TTSStep, resetTTSStepState } = await import('./TTSStep.js');

// --- Fixtures ---

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
  voiceEnabled: true,
};

function createContext(overrides?: Partial<GenerationContext>): GenerationContext {
  return {
    job: {
      id: 'test-job',
      data: {
        requestId: 'req-1',
        jobType: JobType.LLMGeneration,
        personality: { ...TEST_PERSONALITY },
        message: 'Hello',
        context: {
          userId: 'user-1',
          userName: 'TestUser',
          channelId: 'channel-1',
          isVoiceMessage: false,
        },
        responseDestination: {
          type: 'discord',
          channelId: 'channel-1',
        },
      },
    } as Job<LLMGenerationJobData>,
    startTime: Date.now(),
    result: {
      requestId: 'req-1',
      success: true,
      content: 'Hello world',
      metadata: { processingTimeMs: 100 },
    },
    configOverrides: {
      voiceResponseMode: 'always',
      voiceTranscriptionEnabled: true,
      showModelFooter: true,
      shareLtmAcrossPersonalities: false,
    } as GenerationContext['configOverrides'],
    ...overrides,
  };
}

describe('TTSStep', () => {
  let step: InstanceType<typeof TTSStep>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetTTSStepState();
    step = new TTSStep();

    // Default: voice engine is available
    mockGetVoiceEngineClient.mockReturnValue({ synthesize: vi.fn() });
    mockSynthesizeWithChunking.mockResolvedValue({
      audioBuffer: Buffer.from('fake-audio'),
      contentType: 'audio/wav',
    });
    mockStoreTTSAudio.mockResolvedValue('tts:test-job');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTTSStepState();
  });

  it('should have correct name', () => {
    expect(step.name).toBe('TTSStep');
  });

  describe('shouldRunTTS (via process returning context unchanged)', () => {
    it('skips when result.success is false', async () => {
      const ctx = createContext({
        result: {
          requestId: 'req-1',
          success: false,
          content: 'Error occurred',
          metadata: { processingTimeMs: 0 },
        },
      });

      const result = await step.process(ctx);

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
    });

    it('skips when personality.voiceEnabled is false', async () => {
      const ctx = createContext();
      ctx.job.data.personality.voiceEnabled = false;

      const result = await step.process(ctx);

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
    });

    it('skips when personality.voiceEnabled is missing (legacy job payloads)', async () => {
      const ctx = createContext();
      // Cast to handle in-flight jobs from before voiceEnabled had a default
      (ctx.job.data.personality as Record<string, unknown>).voiceEnabled = undefined;

      const result = await step.process(ctx);

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
    });

    it('skips when voiceResponseMode is never', async () => {
      const ctx = createContext({
        configOverrides: {
          voiceResponseMode: 'never',
          voiceTranscriptionEnabled: true,
          showModelFooter: true,
          shareLtmAcrossPersonalities: false,
        } as GenerationContext['configOverrides'],
      });

      const result = await step.process(ctx);

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
    });

    it('skips when voiceResponseMode is voice-only and isVoiceMessage is false', async () => {
      const ctx = createContext({
        configOverrides: {
          voiceResponseMode: 'voice-only',
          voiceTranscriptionEnabled: true,
          showModelFooter: true,
          shareLtmAcrossPersonalities: false,
        } as GenerationContext['configOverrides'],
      });
      ctx.job.data.context.isVoiceMessage = false;

      const result = await step.process(ctx);

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
    });

    it('runs when voiceResponseMode is always and voiceEnabled is true', async () => {
      const ctx = createContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).toHaveBeenCalled();
    });

    it('runs when voiceResponseMode is voice-only and isVoiceMessage is true', async () => {
      const ctx = createContext({
        configOverrides: {
          voiceResponseMode: 'voice-only',
          voiceTranscriptionEnabled: true,
          showModelFooter: true,
          shareLtmAcrossPersonalities: false,
        } as GenerationContext['configOverrides'],
      });
      ctx.job.data.context.isVoiceMessage = true;

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).toHaveBeenCalled();
    });
  });

  describe('process (successful TTS)', () => {
    it('sets ttsAudioKey on result.metadata', async () => {
      mockStoreTTSAudio.mockResolvedValue('tts:test-job');
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('fake-audio-data'),
        contentType: 'audio/wav',
      });

      const ctx = createContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:test-job');
      expect(mockEnsureVoiceRegistered).toHaveBeenCalledWith('testbot');
      expect(mockSynthesizeWithChunking).toHaveBeenCalledWith(
        expect.anything(), // voice engine client
        'Hello world',
        'testbot'
      );
      expect(mockStoreTTSAudio).toHaveBeenCalledWith('test-job', Buffer.from('fake-audio-data'));
    });

    it('retries health check during cold start and succeeds when engine wakes', async () => {
      // Engine wakes on 3rd health check (after ~6s of retries)
      mockVoiceEngineClient.getHealth
        .mockResolvedValueOnce({ asr: false, tts: false })
        .mockResolvedValueOnce({ asr: true, tts: false })
        .mockResolvedValueOnce({ asr: true, tts: true });
      mockStoreTTSAudio.mockResolvedValue('tts:cold-job');
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('cold-start-audio'),
        contentType: 'audio/wav',
      });

      const ctx = createContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Should have retried health check 3 times then succeeded
      expect(mockVoiceEngineClient.getHealth).toHaveBeenCalledTimes(3);
      expect(mockEnsureVoiceRegistered).toHaveBeenCalledWith('testbot');
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:cold-job');
    });

    it('proceeds with TTS after health budget exhausted', async () => {
      // Engine never reports ready within the 75s time budget
      mockVoiceEngineClient.getHealth.mockResolvedValue({ asr: false, tts: false });
      mockStoreTTSAudio.mockResolvedValue('tts:retry-job');
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('late-audio'),
        contentType: 'audio/wav',
      });

      const ctx = createContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // With fake timers, Date.now() only advances on setTimeout fires, so the
      // poll count is deterministic: 75_000 / 3_000 = 25 polls (each followed by
      // a 3s sleep; after the 25th sleep Date.now() == deadline, loop exits).
      expect(mockVoiceEngineClient.getHealth).toHaveBeenCalledTimes(25);
      expect(mockEnsureVoiceRegistered).toHaveBeenCalledWith('testbot');
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:retry-job');
    });

    it('returns context unchanged when voice engine client is null', async () => {
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createContext();

      const result = await step.process(ctx);

      expect(result).toBe(ctx);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
    });
  });

  describe('ElevenLabs BYOK TTS', () => {
    it('routes to ElevenLabs when elevenlabsApiKey is present', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-123');
      mockElevenLabsTTS.mockResolvedValue({
        audioBuffer: Buffer.from('mp3-audio'),
        contentType: 'audio/mpeg',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:el-job');

      const ctx = createContext({
        auth: {
          apiKey: 'sk-or-key',
          provider: 'openrouter',
          isGuestMode: false,
          elevenlabsApiKey: 'sk_el_test',
        },
      });

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockEnsureVoiceCloned).toHaveBeenCalledWith('testbot', 'sk_el_test');
      expect(mockElevenLabsTTS).toHaveBeenCalledWith({
        text: 'Hello world',
        voiceId: 'el-voice-123',
        apiKey: 'sk_el_test',
        modelId: undefined,
      });
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:el-job');
      expect(result.result?.metadata?.ttsAudioContentType).toBe('audio/mpeg');
      // Should NOT use voice-engine path
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
      expect(mockEnsureVoiceRegistered).not.toHaveBeenCalled();
    });

    it('skips voice-engine check when ElevenLabs key is present (no voice-engine needed)', async () => {
      mockGetVoiceEngineClient.mockReturnValue(null);
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-456');
      mockElevenLabsTTS.mockResolvedValue({
        audioBuffer: Buffer.from('mp3-data'),
        contentType: 'audio/mpeg',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:no-ve-job');

      const ctx = createContext({
        auth: {
          apiKey: 'sk-or-key',
          provider: 'openrouter',
          isGuestMode: false,
          elevenlabsApiKey: 'sk_el_test',
        },
      });

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // ElevenLabs works even without voice-engine
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:no-ve-job');
    });

    it('auto-reclones and retries when ElevenLabs returns 404 (voice deleted)', async () => {
      // First ensureVoiceCloned returns the stale (deleted) voice ID
      // After invalidation, second call returns a freshly cloned voice ID
      mockEnsureVoiceCloned
        .mockResolvedValueOnce('stale-voice-id')
        .mockResolvedValueOnce('new-voice-id');

      // First TTS call fails with 404, second succeeds with new voice
      mockElevenLabsTTS
        .mockRejectedValueOnce(
          new ElevenLabsApiError(404, "voice_id 'stale-voice-id' was not found")
        )
        .mockResolvedValueOnce({
          audioBuffer: Buffer.from('recloned-audio'),
          contentType: 'audio/mpeg',
        });
      mockStoreTTSAudio.mockResolvedValue('tts:reclone-job');

      const ctx = createContext({
        auth: {
          apiKey: 'sk-or-key',
          provider: 'openrouter',
          isGuestMode: false,
          elevenlabsApiKey: 'sk_el_test',
        },
      });

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Should have invalidated cache and re-cloned
      expect(mockInvalidateVoice).toHaveBeenCalledWith('testbot', 'sk_el_test');
      expect(mockEnsureVoiceCloned).toHaveBeenCalledTimes(2);
      // Second TTS call uses the new voice ID
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(mockElevenLabsTTS).toHaveBeenLastCalledWith({
        text: 'Hello world',
        voiceId: 'new-voice-id',
        apiKey: 'sk_el_test',
        modelId: undefined,
      });
      // TTS succeeded after reclone
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:reclone-job');
    });

    it('propagates non-retryable ElevenLabs errors without retry (401 auth)', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-401');
      mockElevenLabsTTS.mockRejectedValue(new ElevenLabsApiError(401, 'Invalid API key'));
      // No voice-engine → no fallback
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createContext({
        auth: {
          apiKey: 'sk-or-key',
          provider: 'openrouter',
          isGuestMode: false,
          elevenlabsApiKey: 'sk_el_test',
        },
      });

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // 401 is non-retryable — fast-fail, no retry, degrade to text-only
      expect(mockInvalidateVoice).not.toHaveBeenCalled();
      expect(mockEnsureVoiceCloned).toHaveBeenCalledTimes(1);
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(1);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
    });

    it('falls back to voice-engine when ElevenLabs clone fails', async () => {
      mockEnsureVoiceCloned.mockRejectedValue(new Error('Clone failed'));
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('fallback-clone-audio'),
        contentType: 'audio/wav',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:clone-fallback');

      const ctx = createContext({
        auth: {
          apiKey: 'sk-or-key',
          provider: 'openrouter',
          isGuestMode: false,
          elevenlabsApiKey: 'sk_el_test',
        },
      });

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // ElevenLabs clone failed → voice-engine fallback succeeded
      expect(mockSynthesizeWithChunking).toHaveBeenCalled();
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:clone-fallback');
    });

    it('passes elevenlabsTtsModel from configOverrides to elevenLabsTTS', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-789');
      mockElevenLabsTTS.mockResolvedValue({
        audioBuffer: Buffer.from('turbo-audio'),
        contentType: 'audio/mpeg',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:turbo-job');

      const ctx = createContext({
        auth: {
          apiKey: 'sk-or-key',
          provider: 'openrouter',
          isGuestMode: false,
          elevenlabsApiKey: 'sk_el_test',
        },
        configOverrides: {
          voiceResponseMode: 'always',
          voiceTranscriptionEnabled: true,
          showModelFooter: true,
          shareLtmAcrossPersonalities: false,
          elevenlabsTtsModel: 'eleven_turbo_v2_5',
        } as GenerationContext['configOverrides'],
      });

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      await promise;

      expect(mockElevenLabsTTS).toHaveBeenCalledWith({
        text: 'Hello world',
        voiceId: 'el-voice-789',
        apiKey: 'sk_el_test',
        modelId: 'eleven_turbo_v2_5',
      });
    });

    it('sets ttsAudioContentType for voice-engine path', async () => {
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('wav-audio'),
        contentType: 'audio/wav',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:ve-job');

      const ctx = createContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.result?.metadata?.ttsAudioContentType).toBe('audio/wav');
    });
  });

  function createElevenLabsContext(overrides?: Partial<GenerationContext>): GenerationContext {
    return createContext({
      auth: {
        apiKey: 'sk-or-key',
        provider: 'openrouter',
        isGuestMode: false,
        elevenlabsApiKey: 'sk_el_test',
      },
      ...overrides,
    });
  }

  describe('ElevenLabs retry', () => {
    it('retries 429 rate limit and succeeds on 2nd attempt', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-retry');
      mockElevenLabsTTS
        .mockRejectedValueOnce(new ElevenLabsApiError(429, 'Rate limited'))
        .mockResolvedValueOnce({
          audioBuffer: Buffer.from('retry-audio'),
          contentType: 'audio/mpeg',
        });
      mockStoreTTSAudio.mockResolvedValue('tts:retry-job');
      // No voice-engine — tests pure retry (no fallback)
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:retry-job');
    });

    it('retries 500 server error and succeeds on 2nd attempt', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-500');
      mockElevenLabsTTS
        .mockRejectedValueOnce(new ElevenLabsApiError(500, 'Internal server error'))
        .mockResolvedValueOnce({
          audioBuffer: Buffer.from('retry-500-audio'),
          contentType: 'audio/mpeg',
        });
      mockStoreTTSAudio.mockResolvedValue('tts:500-retry-job');
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:500-retry-job');
    });

    it('does NOT retry 401 auth error (fast-fails)', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-auth');
      mockElevenLabsTTS.mockRejectedValue(new ElevenLabsApiError(401, 'Invalid API key'));
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Only 1 attempt — fast-fail, no retry
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(1);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
    });

    it('exhausts retries when both attempts fail with 429', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-exhausted');
      mockElevenLabsTTS.mockRejectedValue(new ElevenLabsApiError(429, 'Rate limited'));
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // 2 attempts (ELEVENLABS_MAX_ATTEMPTS = 2), both failed
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
    });

    it('retries network timeout error and succeeds on 2nd attempt', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-timeout');
      mockElevenLabsTTS
        .mockRejectedValueOnce(
          new ElevenLabsTimeoutError(60_000, '/text-to-speech/test', new Error('Aborted'))
        )
        .mockResolvedValueOnce({
          audioBuffer: Buffer.from('timeout-retry-audio'),
          contentType: 'audio/mpeg',
        });
      mockStoreTTSAudio.mockResolvedValue('tts:timeout-retry-job');
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:timeout-retry-job');
    });

    it('retries fetch connection failure (TypeError) and succeeds on 2nd attempt', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-connfail');
      const fetchError = new TypeError('fetch failed');
      mockElevenLabsTTS.mockRejectedValueOnce(fetchError).mockResolvedValueOnce({
        audioBuffer: Buffer.from('connfail-retry-audio'),
        contentType: 'audio/mpeg',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:connfail-retry-job');
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:connfail-retry-job');
    });

    it('retries TypeError with ECONNREFUSED cause code (cause-code path)', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-connrefused');
      // TypeError with a non-"fetch failed" message but a POSIX cause code —
      // tests the cause-code fallback path in isTransientElevenLabsError
      const connError = new TypeError('other undici error', {
        cause: { code: 'ECONNREFUSED' },
      });
      mockElevenLabsTTS.mockRejectedValueOnce(connError).mockResolvedValueOnce({
        audioBuffer: Buffer.from('connrefused-retry-audio'),
        contentType: 'audio/mpeg',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:connrefused-job');
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:connrefused-job');
    });

    it('retries TypeError with ECONNRESET cause code', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-connreset');
      const connError = new TypeError('other undici error', {
        cause: { code: 'ECONNRESET' },
      });
      mockElevenLabsTTS.mockRejectedValueOnce(connError).mockResolvedValueOnce({
        audioBuffer: Buffer.from('connreset-retry-audio'),
        contentType: 'audio/mpeg',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:connreset-job');
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:connreset-job');
    });

    it('does NOT retry programming TypeError (not network-related)', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-bug');
      const programmingError = new TypeError('Cannot read properties of null');
      mockElevenLabsTTS.mockRejectedValue(programmingError);
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Programming TypeError fast-fails — only 1 attempt
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(1);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
    });
  });

  describe('ElevenLabs fallback to voice-engine', () => {
    it('falls back to voice-engine after retries exhaust (429)', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-fallback');
      mockElevenLabsTTS.mockRejectedValue(new ElevenLabsApiError(429, 'Rate limited'));
      // Voice-engine is available for fallback
      mockGetVoiceEngineClient.mockReturnValue(mockVoiceEngineClient);
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('fallback-audio'),
        contentType: 'audio/wav',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:fallback-job');

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // ElevenLabs retried and exhausted
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      // Voice-engine fallback succeeded
      expect(mockSynthesizeWithChunking).toHaveBeenCalled();
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:fallback-job');
      expect(result.result?.metadata?.ttsAudioContentType).toBe('audio/wav');
    });

    it('falls back on auth error (401) — skips retry, goes to voice-engine', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-auth-fb');
      mockElevenLabsTTS.mockRejectedValue(new ElevenLabsApiError(401, 'Invalid API key'));
      mockGetVoiceEngineClient.mockReturnValue(mockVoiceEngineClient);
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('auth-fallback-audio'),
        contentType: 'audio/wav',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:auth-fallback-job');

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // 401 fast-fails (1 attempt), then voice-engine fallback
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(1);
      expect(mockSynthesizeWithChunking).toHaveBeenCalled();
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:auth-fallback-job');
    });

    it('no fallback when voice-engine not configured → text-only', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-no-ve');
      mockElevenLabsTTS.mockRejectedValue(new ElevenLabsApiError(500, 'Server error'));
      mockGetVoiceEngineClient.mockReturnValue(null);

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // No voice-engine → no fallback, text-only
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      expect(result.result?.content).toBe('Hello world');
    });

    it('falls back to voice-engine when re-cloned voice also 404s', async () => {
      // First clone returns stale voice, re-clone returns another voice that also 404s.
      // 404 is not transient → shouldRetry returns false → propagates to WithFallback.
      mockEnsureVoiceCloned
        .mockResolvedValueOnce('stale-voice-id')
        .mockResolvedValueOnce('also-stale-voice-id');

      // First TTS: 404 → triggers re-clone. Second TTS (with re-cloned voice): also 404.
      // 404 is not retryable, so withRetry does not retry — error propagates to fallback.
      mockElevenLabsTTS
        .mockRejectedValueOnce(
          new ElevenLabsApiError(404, "voice_id 'stale-voice-id' was not found")
        )
        .mockRejectedValueOnce(
          new ElevenLabsApiError(404, "voice_id 'also-stale-voice-id' was not found")
        );

      mockGetVoiceEngineClient.mockReturnValue(mockVoiceEngineClient);
      mockSynthesizeWithChunking.mockResolvedValue({
        audioBuffer: Buffer.from('fallback-after-double-404'),
        contentType: 'audio/wav',
      });
      mockStoreTTSAudio.mockResolvedValue('tts:double-404-fallback');

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Both ElevenLabs TTS calls returned 404
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(mockInvalidateVoice).toHaveBeenCalledWith('testbot', 'sk_el_test');
      // Voice-engine fallback succeeded
      expect(mockSynthesizeWithChunking).toHaveBeenCalled();
      expect(result.result?.metadata?.ttsAudioKey).toBe('tts:double-404-fallback');
    });

    it('voice-engine fallback also fails → text-only gracefully', async () => {
      mockEnsureVoiceCloned.mockResolvedValue('el-voice-double-fail');
      mockElevenLabsTTS.mockRejectedValue(new ElevenLabsApiError(429, 'Rate limited'));
      mockGetVoiceEngineClient.mockReturnValue(mockVoiceEngineClient);
      mockSynthesizeWithChunking.mockRejectedValue(new Error('Voice engine also unavailable'));

      const ctx = createElevenLabsContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Both ElevenLabs and voice-engine failed → graceful degradation to text-only
      expect(mockElevenLabsTTS).toHaveBeenCalledTimes(2);
      expect(mockSynthesizeWithChunking).toHaveBeenCalled();
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      expect(result.result?.content).toBe('Hello world');
    });
  });

  describe('error handling', () => {
    it('returns context unchanged when TTS synthesis fails (graceful degradation)', async () => {
      mockSynthesizeWithChunking.mockRejectedValue(new Error('Voice engine unavailable'));

      const ctx = createContext();

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(ctx);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      // Text content is preserved
      expect(result.result?.content).toBe('Hello world');
    });

    it('skips audio storage when job ID is undefined', async () => {
      const ctx = createContext({
        job: {
          id: undefined,
          data: {
            ...createContext().job.data,
            requestId: undefined as unknown as string,
          },
        } as Job<LLMGenerationJobData>,
      });

      const promise = step.process(ctx);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Should not store audio (no valid key)
      expect(mockStoreTTSAudio).not.toHaveBeenCalled();
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
    });

    it('returns context unchanged when TTS times out', async () => {
      // Synthesis never resolves — will be beaten by the timeout
      mockSynthesizeWithChunking.mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const ctx = createContext();

      const promise = step.process(ctx);
      // Advance past the 150s timeout
      await vi.advanceTimersByTimeAsync(150_000);
      const result = await promise;

      expect(result).toBe(ctx);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      // Text content is preserved
      expect(result.result?.content).toBe('Hello world');
    });
  });
});
