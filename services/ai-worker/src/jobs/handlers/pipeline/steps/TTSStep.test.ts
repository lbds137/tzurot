/**
 * TTSStep unit tests
 *
 * The provider-selection + fallback walk lives in `TtsDispatcher` and the
 * concrete providers (each with its own test file). This file covers what
 * `TTSStep` itself owns:
 *
 *   - `shouldRunTTS` prerequisite gating
 *   - Resolver delegation (resolveConfig is consulted with the correct args)
 *   - Dispatcher delegation (dispatchTts is called with the resolver's output
 *     plus `auth.audioProviderKeys` and the module-level provider registry)
 *   - Output normalization fast-path + failure-tolerance
 *   - Redis storage (only when synthesis succeeded)
 *   - Outer 300s timeout race (text-only delivery on timeout)
 *   - Error path on dispatcher failure → text still delivered
 *
 * Provider-internal behavior (cloning, retries, voice-engine warmup, etc.)
 * is covered by the dedicated dispatcher/provider test files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type ResolvedTtsConfig } from '@tzurot/common-types/services/tts/TtsProvider';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { GenerationContext } from '../types.js';

// --- Mocks -----------------------------------------------------------------

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const mockDispatchTts = vi.fn();
vi.mock('../../../../services/voice/TtsDispatcher.js', () => ({
  dispatchTts: (...args: unknown[]) => mockDispatchTts(...args),
}));

vi.mock('../../../../services/voice/ttsProviderRegistry.js', () => ({
  ttsProviderRegistry: { _id: 'mock-registry' },
  resetTtsProviderRegistry: vi.fn(),
}));

const mockNormalizeLoudness = vi.fn();
vi.mock('../../../../services/voice/audioNormalizer.js', () => ({
  normalizeLoudness: (...args: unknown[]) => mockNormalizeLoudness(...args),
}));

const mockStoreTTSAudio = vi.fn();
vi.mock('../../../../redis.js', () => ({
  redisService: {
    storeTTSAudio: (...args: unknown[]) => mockStoreTTSAudio(...args),
  },
}));

const { TTSStep, resetTTSStepState } = await import('./TTSStep.js');

// --- Fixtures --------------------------------------------------------------

const TEST_PERSONALITY: LoadedPersonality = {
  id: 'personality-123',
  name: 'TestBot',
  displayName: 'Test Bot',
  slug: 'testbot',
  ownerId: 'owner-uuid-test',
  systemPrompt: 'You are a helpful assistant.',
  model: 'anthropic/claude-sonnet-4',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A helpful test personality',
  personalityTraits: 'Helpful, friendly',
  voiceEnabled: true,
};

const RESOLVED_CONFIG: ResolvedTtsConfig = {
  provider: 'mistral',
  modelId: 'voxtral-mini-tts-latest',
  advancedParameters: {},
  source: 'user-personality',
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
    auth: {
      apiKey: 'sk-llm',
      provider: undefined,
      isGuestMode: false,
      audioProviderKeys: new Map([['mistral', 'sk-mi']]),
    },
    ...overrides,
  };
}

function makeResolver() {
  return {
    resolveConfig: vi.fn(async () => ({ config: RESOLVED_CONFIG, source: 'user-personality' })),
  };
}

// --- Tests -----------------------------------------------------------------

describe('TTSStep', () => {
  let step: InstanceType<typeof TTSStep>;
  let resolver: ReturnType<typeof makeResolver>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetTTSStepState();

    resolver = makeResolver();
    step = new TTSStep(resolver as unknown as ConstructorParameters<typeof TTSStep>[0]);

    // Default happy path: dispatcher returns audio, normalizer passes through, redis stores
    mockDispatchTts.mockResolvedValue({
      audioBuffer: Buffer.from('synthesized'),
      providerUsed: 'mistral',
      usedFallback: false,
      outputFormat: 'wav',
    });
    mockNormalizeLoudness.mockImplementation(async (buf: Buffer) => buf);
    mockStoreTTSAudio.mockResolvedValue('tts:test-job');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTTSStepState();
  });

  it('has the expected step name', () => {
    expect(step.name).toBe('TTSStep');
  });

  // ===== shouldRunTTS prerequisites =========================================

  describe('shouldRunTTS', () => {
    it('skips when result.success is false', async () => {
      const ctx = createContext({
        result: { requestId: 'req-1', success: false, content: '', metadata: {} },
      });
      await step.process(ctx);
      expect(mockDispatchTts).not.toHaveBeenCalled();
    });

    it('skips when personality.voiceEnabled is false', async () => {
      const ctx = createContext();
      ctx.job.data.personality.voiceEnabled = false;
      await step.process(ctx);
      expect(mockDispatchTts).not.toHaveBeenCalled();
    });

    it('skips when voiceResponseMode is "never"', async () => {
      const ctx = createContext();
      (ctx.configOverrides as { voiceResponseMode: string }).voiceResponseMode = 'never';
      await step.process(ctx);
      expect(mockDispatchTts).not.toHaveBeenCalled();
    });

    it('skips when configOverrides is missing (defaults to never)', async () => {
      const ctx = createContext({ configOverrides: undefined });
      await step.process(ctx);
      expect(mockDispatchTts).not.toHaveBeenCalled();
    });

    it('skips when voiceResponseMode=voice-only and trigger is not a voice message', async () => {
      const ctx = createContext();
      (ctx.configOverrides as { voiceResponseMode: string }).voiceResponseMode = 'voice-only';
      ctx.job.data.context.isVoiceMessage = false;
      await step.process(ctx);
      expect(mockDispatchTts).not.toHaveBeenCalled();
    });

    it('runs when voiceResponseMode=voice-only and trigger IS a voice message', async () => {
      const ctx = createContext();
      (ctx.configOverrides as { voiceResponseMode: string }).voiceResponseMode = 'voice-only';
      ctx.job.data.context.isVoiceMessage = true;
      await step.process(ctx);
      expect(mockDispatchTts).toHaveBeenCalledTimes(1);
    });

    it('skips when content is empty', async () => {
      const ctx = createContext();
      ctx.result!.content = '';
      await step.process(ctx);
      expect(mockDispatchTts).not.toHaveBeenCalled();
    });
  });

  // ===== Resolver / dispatcher delegation ===================================

  describe('resolver + dispatcher delegation', () => {
    it('skips entirely when no TtsConfigResolver is wired', async () => {
      const stepNoResolver = new TTSStep();
      const ctx = createContext();
      await stepNoResolver.process(ctx);
      expect(mockDispatchTts).not.toHaveBeenCalled();
    });

    it('calls resolveConfig with userId, personality.id, and { id }', async () => {
      const ctx = createContext();
      await step.process(ctx);
      expect(resolver.resolveConfig).toHaveBeenCalledWith('user-1', 'personality-123', {
        id: 'personality-123',
      });
    });

    it('passes resolved config + audioProviderKeys + ctx + registry to dispatcher', async () => {
      const ctx = createContext();
      await step.process(ctx);

      expect(mockDispatchTts).toHaveBeenCalledTimes(1);
      const call = mockDispatchTts.mock.calls[0][0];
      expect(call.text).toBe('Hello world');
      expect(call.resolvedConfig).toEqual(RESOLVED_CONFIG);
      expect(call.ctx).toEqual({ slug: 'testbot', modelId: 'voxtral-mini-tts-latest' });
      expect(call.audioProviderKeys.get('mistral')).toBe('sk-mi');
      expect(call.registry).toEqual({ _id: 'mock-registry' });
    });

    it('passes an empty Map for audioProviderKeys when auth is missing', async () => {
      const ctx = createContext({ auth: undefined });
      await step.process(ctx);
      const call = mockDispatchTts.mock.calls[0][0];
      expect(call.audioProviderKeys.size).toBe(0);
    });
  });

  // ===== Storage path =======================================================

  describe('storage', () => {
    it('stores normalized audio in Redis and writes ttsAudioKey to metadata', async () => {
      const ctx = createContext();
      await step.process(ctx);

      expect(mockNormalizeLoudness).toHaveBeenCalledWith(Buffer.from('synthesized'));
      expect(mockStoreTTSAudio).toHaveBeenCalledWith('test-job', Buffer.from('synthesized'));
      expect(ctx.result?.metadata?.ttsAudioKey).toBe('tts:test-job');
      // normalizeLoudness emits Opus-in-Ogg (single ffmpeg pass: loudnorm + libopus)
      expect(ctx.result?.metadata?.ttsAudioContentType).toBe('audio/ogg');
      // Attribution surface: the dispatcher's provider + fallback flag must
      // land on result.metadata so bot-client can render "TTS: mistral" in
      // /inspect Token Budget. Without this, the silent-misattribution class
      // applies — user configures provider X, dispatcher falls back to Y,
      // and the diagnostic UI shows X (the configured value) instead of Y.
      expect(ctx.result?.metadata?.ttsProviderUsed).toBe('mistral');
      expect(ctx.result?.metadata?.ttsUsedFallback).toBe(false);
    });

    it('writes ttsProviderUsed + ttsUsedFallback=true when dispatcher fell through to a fallback', async () => {
      mockDispatchTts.mockResolvedValueOnce({
        audioBuffer: Buffer.from('synthesized'),
        providerUsed: 'self-hosted',
        usedFallback: true,
        outputFormat: 'wav',
      });
      const ctx = createContext();
      await step.process(ctx);

      expect(ctx.result?.metadata?.ttsProviderUsed).toBe('self-hosted');
      expect(ctx.result?.metadata?.ttsUsedFallback).toBe(true);
    });

    it('forwards provider attribution to diagnosticCollector.recordTtsDispatch when wired', async () => {
      // Pins the TTSStep → DiagnosticCollector wiring. Without this assertion,
      // removing the recordTtsDispatch call from TTSStep would silently drop
      // TTS attribution from the stored diagnostic log while every other
      // test in this file kept passing — the metadata path covers result
      // attachment, not the flight-recorder path.
      const recordTtsDispatch = vi.fn();
      const fakeCollector = { recordTtsDispatch } as unknown as NonNullable<
        GenerationContext['diagnosticCollector']
      >;
      const ctx = createContext({ diagnosticCollector: fakeCollector });
      await step.process(ctx);

      expect(recordTtsDispatch).toHaveBeenCalledWith({
        providerUsed: 'mistral',
        usedFallback: false,
      });
    });

    it('falls back to unnormalized audio when normalization throws', async () => {
      mockNormalizeLoudness.mockRejectedValueOnce(new Error('ffmpeg missing'));
      const ctx = createContext();
      await step.process(ctx);

      // Storage still happens — degraded but not dropped
      expect(mockStoreTTSAudio).toHaveBeenCalledWith('test-job', Buffer.from('synthesized'));
      expect(ctx.result?.metadata?.ttsAudioKey).toBe('tts:test-job');
      // Content type reflects the dispatcher's outputFormat (wav) since
      // normalization didn't run — the canonical "audio/wav" override didn't
      // apply, but in this case wav is also the natural output content-type.
      expect(ctx.result?.metadata?.ttsAudioContentType).toBe('audio/wav');
    });

    it('maps non-wav outputFormat to its content type when normalization fails', async () => {
      mockNormalizeLoudness.mockRejectedValueOnce(new Error('ffmpeg missing'));
      mockDispatchTts.mockResolvedValueOnce({
        audioBuffer: Buffer.from('mp3-bytes'),
        providerUsed: 'elevenlabs',
        usedFallback: false,
        outputFormat: 'mp3',
      });
      const ctx = createContext();
      await step.process(ctx);
      expect(ctx.result?.metadata?.ttsAudioContentType).toBe('audio/mpeg');
    });

    it('falls back to job.data.requestId when job.id is undefined', async () => {
      const ctx = createContext();
      ctx.job = { ...ctx.job, id: undefined } as Job<LLMGenerationJobData>;
      await step.process(ctx);
      expect(mockStoreTTSAudio).toHaveBeenCalledWith('req-1', expect.any(Buffer));
    });

    it('forwards dispatcher notices into result.metadata.ttsNotices', async () => {
      mockDispatchTts.mockResolvedValueOnce({
        audioBuffer: Buffer.from('synthesized'),
        providerUsed: 'self-hosted',
        usedFallback: true,
        outputFormat: 'wav',
        notices: ['Voice reference for "testbot" is 45.0s, exceeding limit. Mistral was skipped.'],
      });
      const ctx = createContext();
      await step.process(ctx);
      expect(ctx.result?.metadata?.ttsNotices).toEqual([
        'Voice reference for "testbot" is 45.0s, exceeding limit. Mistral was skipped.',
      ]);
    });

    it('omits ttsNotices when dispatcher returns no notices (happy path)', async () => {
      const ctx = createContext();
      await step.process(ctx);
      expect(ctx.result?.metadata?.ttsNotices).toBeUndefined();
    });

    it('omits ttsNotices when dispatcher returns an empty notice list', async () => {
      mockDispatchTts.mockResolvedValueOnce({
        audioBuffer: Buffer.from('synthesized'),
        providerUsed: 'mistral',
        usedFallback: false,
        outputFormat: 'wav',
        notices: [],
      });
      const ctx = createContext();
      await step.process(ctx);
      expect(ctx.result?.metadata?.ttsNotices).toBeUndefined();
    });
  });

  // ===== Error / timeout paths =============================================

  describe('error handling', () => {
    it('delivers text-only when dispatcher throws (ttsAudioKey not set)', async () => {
      mockDispatchTts.mockRejectedValueOnce(new Error('all providers down'));
      const ctx = createContext();
      const result = await step.process(ctx);

      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      // Original content preserved
      expect(result.result?.content).toBe('Hello world');
    });

    it('treats outer timeout as soft failure — text-only delivery', async () => {
      // Dispatcher hangs forever
      mockDispatchTts.mockImplementationOnce(() => new Promise(() => {}));
      const ctx = createContext();

      const promise = step.process(ctx);
      // Advance past the 300s TTS budget (cold-start + long-synthesis worst case)
      await vi.advanceTimersByTimeAsync(300_001);
      const result = await promise;

      expect(result.result?.metadata?.ttsAudioKey).toBeUndefined();
      expect(result.result?.content).toBe('Hello world');
    });

    it('does not store anything when dispatcher fails', async () => {
      mockDispatchTts.mockRejectedValueOnce(new Error('all providers down'));
      await step.process(createContext());
      expect(mockStoreTTSAudio).not.toHaveBeenCalled();
    });
  });
});
