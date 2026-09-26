/**
 * Seam test: processAudioTranscriptionJob → withRetry → transcribeAudio →
 * rethrowIfTerminalVoiceEngineError.
 *
 * AudioTranscriptionJob.test.ts mocks `transcribeAudio` wholesale, so no job
 * test runs the real `rethrowIfTerminalVoiceEngineError` branch that turns a
 * voice-engine 415/413 into a typed `UnsupportedAudioFormatError` /
 * `AudioTooLongError`. AudioProcessor.test.ts proves that branch in isolation,
 * but never runs the job a level up, so neither suite alone proves the
 * wiring: a dropped 415 branch in AudioProcessor.ts would leave every
 * job-level suite green (the mocked `transcribeAudio` would just keep
 * rejecting with whatever the test told it to) while the real failure
 * silently fell through to `failureReason: 'unavailable'` in production.
 *
 * This test runs the REAL `processAudioTranscriptionJob`, the REAL `withRetry`
 * (both the job's outer retry and AudioProcessor's inner voice-engine retry),
 * and the REAL `transcribeAudio` / `rethrowIfTerminalVoiceEngineError`. Only
 * the external boundary is mocked: the Redis transcript cache, the
 * voice-engine warmup poll, the voice-engine client factory (keeping the real
 * `VoiceEngineError` class via `importOriginal`), and the global `fetch` used
 * to download the attachment bytes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type AudioTranscriptionJobData } from '@tzurot/common-types/types/jobs';
import { processAudioTranscriptionJob } from './AudioTranscriptionJob.js';
import { VoiceEngineError } from '../services/voice/VoiceEngineClient.js';

const mockVoiceTranscriptCacheGet = vi.fn().mockResolvedValue(null);
const mockVoiceEngineTranscribe = vi.fn();
const mockGetHealth = vi.fn().mockResolvedValue({ asr: true, tts: true });
let mockVoiceEngineClient: {
  transcribe: typeof mockVoiceEngineTranscribe;
  getHealth: typeof mockGetHealth;
} | null = null;

const mockWaitForVoiceEngine = vi.fn().mockResolvedValue({ ready: true, elapsedMs: 0 });
vi.mock('../services/voice/voiceEngineWarmup.js', () => ({
  waitForVoiceEngine: (...args: unknown[]) => mockWaitForVoiceEngine(...args),
}));

vi.mock('../redis.js', () => ({
  voiceTranscriptCache: {
    get: mockVoiceTranscriptCacheGet,
    store: vi.fn(),
  },
}));

vi.mock('../services/voice/VoiceEngineClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/voice/VoiceEngineClient.js')>();
  return {
    ...actual,
    getVoiceEngineClient: () => mockVoiceEngineClient,
    resetVoiceEngineClient: vi.fn(),
  };
});

global.fetch = vi.fn();

function buildJob(): Job<AudioTranscriptionJobData> {
  const jobData: AudioTranscriptionJobData = {
    requestId: 'seam-req',
    jobType: JobType.AudioTranscription,
    attachment: {
      url: 'https://cdn.discordapp.com/attachments/1/2/voice.ogg',
      name: 'voice.ogg',
      contentType: CONTENT_TYPES.AUDIO_OGG,
      size: 1024,
      duration: 5,
    },
    context: { userId: 'user-123', channelId: 'channel-456' },
    responseDestination: { type: 'discord', channelId: 'channel-456' },
  };

  return {
    id: 'seam-job',
    timestamp: Date.now(),
    data: jobData,
  } as unknown as Job<AudioTranscriptionJobData>;
}

describe('audio transcription failure seam: job → withRetry → AudioProcessor → VoiceEngineClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockVoiceTranscriptCacheGet.mockReset().mockResolvedValue(null);
    mockVoiceEngineClient = null;
    mockVoiceEngineTranscribe.mockReset();
    mockGetHealth.mockReset().mockResolvedValue({ asr: true, tts: true });
    mockWaitForVoiceEngine.mockReset().mockResolvedValue({ ready: true, elapsedMs: 0 });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tags failureReason="unsupported_format" and calls the voice-engine client exactly once for a real 415', async () => {
    mockVoiceEngineTranscribe.mockRejectedValue(
      new VoiceEngineError(415, 'Audio format not recognised')
    );
    mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

    const result = await processAudioTranscriptionJob(buildJob(), { provider: 'voice-engine' });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('unsupported_format');
    // Exactly one call proves BOTH retry layers fast-failed: the job's outer
    // withRetry (isRetryableTranscriptionError → false for
    // UnsupportedAudioFormatError) and AudioProcessor's inner voice-engine
    // withRetry (isTransientVoiceEngineError → false for a 415). Fake timers
    // need no advancing: handleNonRetryableError throws before either retry
    // loop reaches waitBeforeRetry, so no delay is scheduled (a regression that
    // did schedule one would hang this test to its timeout, not pass it).
    expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(1);
  });

  it('control: tags failureReason="too_long" for a real 413 (same fixture, sibling status)', async () => {
    mockVoiceEngineTranscribe.mockRejectedValue(
      new VoiceEngineError(413, 'Audio too long (800s). Maximum is 720s.')
    );
    mockVoiceEngineClient = { transcribe: mockVoiceEngineTranscribe, getHealth: mockGetHealth };

    const result = await processAudioTranscriptionJob(buildJob(), { provider: 'voice-engine' });

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('too_long');
    expect(mockVoiceEngineTranscribe).toHaveBeenCalledTimes(1);
  });
});
