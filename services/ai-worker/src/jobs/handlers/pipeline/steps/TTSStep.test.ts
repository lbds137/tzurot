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

    it('proceeds with TTS after max health retries exhausted', async () => {
      // Engine never reports ready within retry window
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

      // Should exhaust all 5 attempts then proceed anyway
      expect(mockVoiceEngineClient.getHealth).toHaveBeenCalledTimes(5);
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
      // Advance past the 60s timeout
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;

      expect(result).toBe(ctx);
      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      // Text content is preserved
      expect(result.result?.content).toBe('Hello world');
    });
  });
});
