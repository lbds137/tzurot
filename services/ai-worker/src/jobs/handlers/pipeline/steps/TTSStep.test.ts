/**
 * TTSStep Unit Tests
 *
 * Tests the post-generation TTS synthesis step including:
 * - shouldRunTTS logic (voice mode, voice enabled, success state)
 * - Successful TTS flow (register → synthesize → store)
 * - Graceful degradation on errors and timeouts
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

vi.mock('../../../../services/voice/VoiceRegistrationService.js', () => ({
  VoiceRegistrationService: class MockVoiceRegistrationService {
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

    it('skips when personality.voiceEnabled is undefined', async () => {
      const ctx = createContext();
      ctx.job.data.personality.voiceEnabled = undefined;

      const result = await step.process(ctx);

      expect(result).toBe(ctx);
      expect(mockSynthesizeWithChunking).not.toHaveBeenCalled();
    });

    it('skips when voiceResponseMode is never (default)', async () => {
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
