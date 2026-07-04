/**
 * SelfHostedTtsProvider
 *
 * `TtsProvider` adapter wrapping the existing `VoiceRegistrationService`
 * (which talks to our Python `voice-engine` microservice). The wrapper
 * keeps the existing service's lazy-register lifecycle intact — `prepare()`
 * delegates to `ensureVoiceRegistered(slug)`, and `synthesize()` calls the
 * existing `synthesizeWithChunking` helper.
 *
 * Self-hosted needs no BYOK key (uses VOICE_ENGINE_URL env config).
 * Voice-id is the personality slug — voice-engine identifies registered
 * voices by the slug we send during registration.
 */

import {
  buildPreparedVoiceId,
  createLogger,
  type PreparedTts,
  type ResolvedTtsConfig,
  type TtsCapabilities,
  type TtsContext,
  type TtsProvider,
  type TtsProviderId,
} from '@tzurot/common-types';
import { VoiceRegistrationService } from '../VoiceRegistrationService.js';
import { synthesizeWithChunking } from '../ttsSynthesizer.js';
import { waitForVoiceEngine } from '../voiceEngineWarmup.js';

const logger = createLogger('SelfHostedTtsProvider');

const PROVIDER_ID: TtsProviderId = 'self-hosted';

/** Static capabilities of the self-hosted voice-engine path. */
const SELF_HOSTED_CAPABILITIES: TtsCapabilities = {
  // voice-engine has no hard char cap on the wire; the chunker enforces ours.
  // Setting to a large value so the dispatcher doesn't try to chunk for us.
  maxCharacters: 100_000,
  requiresPrepare: true, // ensureVoiceRegistered must run first
  supportsReferenceAudio: true, // voice-engine's TTS engine clones from the registered reference
  outputFormat: 'opus', // voice-engine returns Opus-in-Ogg by default
};

export class SelfHostedTtsProvider implements TtsProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = 'Self-hosted (voice-engine)';
  readonly capabilities = SELF_HOSTED_CAPABILITIES;

  constructor(private readonly registrationService: VoiceRegistrationService) {}

  /**
   * Self-hosted is always considered "available" if the wrapper is constructed
   * (the upstream registry only constructs us when VOICE_ENGINE_URL is set).
   * The dispatcher uses `isAvailable` for cheap predicate filtering — no I/O.
   */
  isAvailable(_ctx: TtsContext): boolean {
    return true;
  }

  /**
   * Self-hosted handles any TTS config that names provider 'self-hosted'.
   * Provider-specific knobs (e.g. selfHostedEngine: 'kyutai' | 'neutts-air'
   * once those engines land) get parsed from `config.advancedParameters` inside
   * `synthesize`, not here.
   */
  canHandle(config: ResolvedTtsConfig, _ctx: TtsContext): boolean {
    return config.provider === PROVIDER_ID;
  }

  /**
   * Lazy-register the voice with voice-engine. Returns a handle whose `id`
   * is the personality slug (voice-engine identifies voices by the slug
   * sent during registration).
   *
   * Calls `waitForVoiceEngine` before registration to absorb Railway
   * Serverless cold-start (~56s observed). Without this, `ensureVoiceRegistered`
   * runs into the cold-start delay during a much shorter HTTP timeout
   * and fails. Previously this happened in `TTSStep.performVoiceEngineTTS`;
   * the dispatcher refactor moved the responsibility into the provider
   * since only this provider talks to voice-engine.
   */
  async prepare(ctx: TtsContext): Promise<PreparedTts> {
    const warmup = await waitForVoiceEngine(this.registrationService.client, 'tts');
    logger.info(
      { slug: ctx.slug, warmupElapsedMs: warmup.elapsedMs, ready: warmup.ready },
      'Voice engine warmup complete for TTS'
    );
    await this.registrationService.ensureVoiceRegistered(ctx.slug);
    return buildPreparedVoiceId(PROVIDER_ID, ctx.slug);
  }

  /**
   * Synthesize text via the existing chunker, which handles single-chunk
   * Opus output AND multi-chunk WAV-concat-then-Opus-transcode for long text.
   *
   * Self-hosted ignores `ctx` (no auth needed; voice id is in the handle).
   * Throws on `kind: 'inlineAudio'` handles — self-hosted is a stateful provider.
   */
  async synthesize(text: string, handle: PreparedTts, _ctx: TtsContext): Promise<Buffer> {
    if (handle.kind !== 'voiceId') {
      throw new Error(
        `SelfHostedTtsProvider received an inlineAudio handle — expected voiceId. Got: ${handle.kind}`
      );
    }
    const start = Date.now();
    const result = await synthesizeWithChunking(this.registrationService.client, text, handle.id);
    logger.info(
      {
        event: 'tts.synthesize',
        provider: PROVIDER_ID,
        model: null,
        charCount: text.length,
        outputBytes: result.audioBuffer.length,
        durationMs: Date.now() - start,
      },
      'TTS synthesis'
    );
    return result.audioBuffer;
  }
}
