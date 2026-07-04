/**
 * TtsDispatcher
 *
 * Walks an ordered fallback chain of TTS providers and synthesizes audio.
 *
 * Built once per `TTSStep.process` call from:
 *   - `ResolvedTtsConfig` (from `TtsConfigResolver`) — names the **primary** provider
 *   - `TtsContext` — slug + optional `byokKey` + optional `modelId`
 *   - `audioProviderKeys` map — tells the dispatcher which BYOK providers have credentials
 *   - the provider registry — supplies the actual `TtsProvider` instances
 *
 * Walk semantics:
 *
 *   1. Build the chain: `[primary, self-hosted]`, deduped and filtered by
 *      `isAvailable(ctx)`. Self-hosted is the only safety-net fallback —
 *      cross-paid fallbacks (Mistral → ElevenLabs and vice versa) are
 *      deliberately excluded so a user who configured one paid provider
 *      doesn't get billed by the other. If primary IS self-hosted, the
 *      chain is just `[self-hosted]` (no fallback). If `VOICE_ENGINE_URL`
 *      is unset, the registry omits self-hosted and the chain may be just
 *      `[primary]` or empty.
 *
 *   2. For each candidate, call `prepare()` then `synthesize()`. The primary
 *      candidate sees the real `ResolvedTtsConfig` and the original
 *      `ctx.modelId`; fallback candidates see a synthetic "self-named" config
 *      AND a sanitized ctx (no modelId) — provider-specific model identifiers
 *      and advanced params don't cross provider boundaries.
 *
 *   3. On any error:
 *      - If the error is a `TtsProviderError` with `isFallbackEligible: false`
 *        → propagate immediately. Input-shape problems (text too long, voice
 *        slug missing in gateway) won't be fixed by trying another provider.
 *      - Otherwise → record the failure, try the next candidate.
 *
 *   4. If all candidates fail, throw an aggregated error containing each
 *      candidate's failure for diagnostics.
 *
 * The dispatcher does NOT:
 *   - Apply output normalization (caller does, in TTSStep, after the buffer
 *     comes back). Keeps the dispatcher format-agnostic.
 *   - Enforce the outer 240s budget (caller does, with `Promise.race`).
 *   - Chunk long input (provider's responsibility per its capabilities).
 */

import {
  type PreparedTts,
  type ResolvedTtsConfig,
  type TtsContext,
  type TtsProvider,
  type TtsProviderId,
} from '@tzurot/common-types/services/tts/TtsProvider';
import { TtsProviderError } from '@tzurot/common-types/services/tts/TtsProviderError';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { MistralReferenceAudioTooLongError } from './MistralTtsClient.js';

const logger = createLogger('TtsDispatcher');

/** Self-hosted is the always-last safety-net provider — referenced enough
 *  in this module that a constant beats the string-literal repetition. */
const SELF_HOSTED: TtsProviderId = 'self-hosted';

/** A provider id that requires a BYOK key — the dispatcher consults
 *  `audioProviderKeys` for these to gate availability. */
const BYOK_PROVIDERS: ReadonlySet<TtsProviderId> = new Set(['elevenlabs', 'mistral']);

/** Map from `TtsProviderId` to the matching `AudioProviderId` (currently
 *  identical strings, but kept explicit so a future divergence stays typed). */
const TTS_TO_AUDIO_PROVIDER: ReadonlyMap<TtsProviderId, AudioProviderId> = new Map([
  ['elevenlabs', 'elevenlabs'],
  ['mistral', 'mistral'],
]);

/**
 * The provider registry abstraction. The dispatcher never constructs providers
 * itself — `getProvider` returns a memoized instance from a module-level map
 * (see `ttsProviderRegistry.ts`, task #17). Decoupling the registry from the
 * dispatcher means tests can inject a stub registry without standing up real
 * providers.
 */
export interface TtsProviderRegistry {
  getProvider(id: TtsProviderId): TtsProvider | undefined;
  /** All registered provider ids in registration order. */
  listProviderIds(): readonly TtsProviderId[];
}

export interface DispatchOptions {
  /** The text to synthesize. Provider chunks if it exceeds capabilities.maxCharacters. */
  text: string;
  resolvedConfig: ResolvedTtsConfig;
  ctx: TtsContext;
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>;
  registry: TtsProviderRegistry;
}

export interface DispatchResult {
  audioBuffer: Buffer;
  /** Which provider actually produced the audio. Useful for cost telemetry. */
  providerUsed: TtsProviderId;
  /** Whether the primary provider was bypassed (fallback fired). */
  usedFallback: boolean;
  /** Output format from the provider's capabilities — TTSStep normalizes
   *  cross-provider differences before persisting to Redis. */
  outputFormat: 'mp3' | 'wav' | 'pcm' | 'opus';
  /**
   * Diagnostic notices accumulated during the fallback walk — typically
   * "configured-primary-was-skipped-because-X" cases worth surfacing to
   * the bot owner so they know a personality silently degraded. Empty/undefined
   * on the happy path. Currently populated only for
   * `MistralReferenceAudioTooLongError` (reference >30s skips the clone),
   * but the field is generic so future "primary skipped" diagnostics can use it.
   */
  notices?: string[];
}

/**
 * Aggregated error thrown when every provider in the chain fails. Carries
 * a structured `attempts` list so logs and tests can verify the walk shape.
 */
export class TtsDispatchError extends Error {
  constructor(
    public readonly attempts: { provider: TtsProviderId; error: unknown }[],
    message?: string
  ) {
    super(
      message ??
        `All TTS providers failed: ${attempts.map(a => `${a.provider}=${describeError(a.error)}`).join(', ')}`
    );
    this.name = 'TtsDispatchError';
    Object.setPrototypeOf(this, TtsDispatchError.prototype);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Build the ordered list of provider ids the dispatcher will attempt.
 *
 * Rule: paid → free only. The chain is at most `[primary, self-hosted]`,
 * deduped — if primary IS self-hosted, the chain is `[self-hosted]` with
 * no fallback. Cross-paid fallbacks (Mistral → ElevenLabs or vice versa)
 * are deliberately excluded: a user who configured Mistral did not opt
 * into ElevenLabs billing, and vice versa.
 *
 * Symmetrically, a user whose primary is self-hosted does not implicitly
 * opt into ANY paid provider — self-hosted-primary configurations have no
 * fallback (the chain is just `[self-hosted]`).
 *
 * If the primary is BYOK and unavailable (no key, isAvailable returns false),
 * the chain falls through to `[self-hosted]` only. If self-hosted is also
 * unavailable (VOICE_ENGINE_URL unset), the chain is empty and dispatchTts
 * raises a structured error explaining why.
 */
function buildFallbackChain(
  resolvedConfig: ResolvedTtsConfig,
  ctx: TtsContext,
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>,
  registry: TtsProviderRegistry
): TtsProviderId[] {
  const isAvailable = (id: TtsProviderId): boolean => {
    const provider = registry.getProvider(id);
    if (provider === undefined) {
      return false;
    }
    if (BYOK_PROVIDERS.has(id)) {
      const audioId = TTS_TO_AUDIO_PROVIDER.get(id);
      if (audioId === undefined || !audioProviderKeys.has(audioId)) {
        return false;
      }
    }
    const isPrimaryAttempt = id === resolvedConfig.provider;
    return provider.isAvailable(buildCtxForProvider(ctx, id, audioProviderKeys, isPrimaryAttempt));
  };

  const chain: TtsProviderId[] = [];
  const seen = new Set<TtsProviderId>();

  const add = (id: TtsProviderId): void => {
    if (!seen.has(id) && isAvailable(id)) {
      chain.push(id);
      seen.add(id);
    }
  };

  add(resolvedConfig.provider);
  add(SELF_HOSTED);

  return chain;
}

/**
 * Construct the ctx a specific provider should see — overlays the
 * provider-specific BYOK key if applicable. The caller-supplied ctx may carry
 * a `byokKey` set for the primary provider; for fallback providers we look up
 * their own key from the audioProviderKeys map (or leave it undefined).
 *
 * `modelId` is only forwarded on the primary attempt. Provider-specific model
 * identifiers don't cross provider boundaries — handing Mistral's
 * `voxtral-mini-tts-2603` to ElevenLabs causes a 400. `buildSyntheticConfigFor`
 * already drops modelId from the fallback's `ResolvedTtsConfig`; this closes
 * the parallel ctx-path leak (provider implementations read `ctx.modelId`,
 * not `config.modelId`, so both paths must be sanitized).
 */
function buildCtxForProvider(
  baseCtx: TtsContext,
  providerId: TtsProviderId,
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>,
  isPrimaryAttempt: boolean
): TtsContext {
  const modelId = isPrimaryAttempt ? baseCtx.modelId : undefined;

  if (!BYOK_PROVIDERS.has(providerId)) {
    return { slug: baseCtx.slug, modelId };
  }
  const audioId = TTS_TO_AUDIO_PROVIDER.get(providerId);
  const byokKey = audioId !== undefined ? audioProviderKeys.get(audioId) : undefined;
  return { slug: baseCtx.slug, modelId, byokKey };
}

/**
 * Synthetic config a fallback provider sees — names itself, no model
 * override, no advanced params. Source `hardcoded` distinguishes the
 * fallback path in logs.
 *
 * Fallback providers use their own defaults rather than inheriting the
 * primary's `modelId` / `advancedParameters` — a Mistral model string
 * would be meaningless to ElevenLabs or self-hosted, and provider-specific
 * advanced params (Mistral's voice_settings, ElevenLabs's stability) don't
 * cross provider boundaries either.
 */
function buildSyntheticConfigFor(providerId: TtsProviderId): ResolvedTtsConfig {
  return {
    provider: providerId,
    modelId: null,
    advancedParameters: {},
    source: 'hardcoded',
  };
}

/** Outcome of one provider attempt — keeps the main loop a clean switch. */
type AttemptOutcome =
  | { kind: 'success'; result: DispatchResult }
  | { kind: 'skip' }
  | { kind: 'failed'; error: unknown };

interface AttemptInput {
  candidateId: TtsProviderId;
  isPrimaryAttempt: boolean;
  options: DispatchOptions;
}

/**
 * Run one provider attempt. Returns the outcome; throws only on
 * non-fallback-eligible `TtsProviderError` (fatal — abort the chain).
 */
async function attemptCandidate(input: AttemptInput): Promise<AttemptOutcome> {
  const { candidateId, isPrimaryAttempt, options } = input;
  const { resolvedConfig, ctx, audioProviderKeys, registry } = options;

  const provider = registry.getProvider(candidateId);
  if (provider === undefined) {
    return { kind: 'skip' };
  }

  const candidateConfig = isPrimaryAttempt ? resolvedConfig : buildSyntheticConfigFor(candidateId);
  const candidateCtx = buildCtxForProvider(ctx, candidateId, audioProviderKeys, isPrimaryAttempt);

  // Defensive backstop — `buildFallbackChain` already filters by `isAvailable`
  // and fallback synthetic configs name the candidate provider, so `canHandle`
  // returning false here implies an internal inconsistency (provider's own
  // canHandle disagrees with isAvailable/registration). Skip rather than
  // attempt the call.
  if (!provider.canHandle(candidateConfig, candidateCtx)) {
    logger.debug(
      { slug: ctx.slug, candidate: candidateId },
      'Provider canHandle returned false; skipping'
    );
    return { kind: 'skip' };
  }

  // Handle declared outside the try so the finally block can dispose it
  // regardless of whether synthesize succeeded, failed, or was rethrown.
  let handle: PreparedTts | undefined;
  try {
    handle = await provider.prepare(candidateCtx);
    const audioBuffer = await provider.synthesize(options.text, handle, candidateCtx);
    const usedFallback = !isPrimaryAttempt;
    logger.info(
      {
        slug: ctx.slug,
        provider: candidateId,
        primary: resolvedConfig.provider,
        usedFallback,
        bytes: audioBuffer.length,
      },
      usedFallback ? 'TTS dispatched via fallback' : 'TTS dispatched via primary'
    );
    return {
      kind: 'success',
      result: {
        audioBuffer,
        providerUsed: candidateId,
        usedFallback,
        outputFormat: provider.capabilities.outputFormat,
      },
    };
  } catch (error) {
    if (error instanceof TtsProviderError && !error.isFallbackEligible) {
      logger.warn(
        { slug: ctx.slug, provider: candidateId, category: error.category, err: error },
        'TTS provider raised non-fallback-eligible error — aborting chain'
      );
      throw error;
    }
    logger.warn(
      { slug: ctx.slug, provider: candidateId, err: error },
      'TTS provider failed; attempting next in chain'
    );
    return { kind: 'failed', error };
  } finally {
    // Optional handle cleanup. The interface declared `dispose?()` for
    // future providers with WebSocket / temp-file lifecycles, but no caller
    // was wired up — any provider implementing it would silently leak.
    // `handle === undefined` when `prepare()` itself threw — nothing to
    // dispose. Dispose errors are logged but never propagated, so a buggy
    // dispose can't mask the original synthesize result/error.
    if (handle !== undefined && provider.dispose !== undefined) {
      try {
        await provider.dispose(handle);
      } catch (disposeError) {
        logger.warn(
          { slug: ctx.slug, provider: candidateId, err: disposeError },
          'TtsProvider.dispose failed — handle may have leaked'
        );
      }
    }
  }
}

/**
 * Build the human-readable cause string for the empty-fallback-chain branch.
 *
 * Three failure modes are enumerated explicitly so production triage doesn't
 * have to guess from a bare "no providers" message:
 *   1. Self-hosted not registered (VOICE_ENGINE_URL unset)
 *   2. No BYOK audio-provider keys configured
 *   3. Both of the above are configured, but every provider's `isAvailable(ctx)`
 *      returned false for this specific slug (e.g., voice-engine probe failed)
 */
function describeEmptyChainCauses(
  ctx: TtsContext,
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>,
  registry: TtsProviderRegistry
): string {
  const causes: string[] = [];
  if (registry.getProvider(SELF_HOSTED) === undefined) {
    causes.push('VOICE_ENGINE_URL not configured (self-hosted unavailable)');
  }
  if (audioProviderKeys.size === 0) {
    causes.push('no BYOK audio provider keys configured');
  }
  if (causes.length === 0) {
    causes.push(`all registered providers rejected slug '${ctx.slug}' via isAvailable`);
  }
  return ` — ${causes.join('; ')}`;
}

/**
 * Map a fallback-eligible attempt error to a bot-owner-visible notice
 * describing WHY the attempt was skipped. Returns undefined for errors
 * that don't warrant surfacing — most failure modes are either transient
 * (network blips) or already covered by other observability paths.
 *
 * The notice is short, actionable, and references the specific personality
 * (`ctx.slug`) so the bot owner can identify which voice ref needs attention.
 */
function buildAttemptNotice(error: unknown, ctx: TtsContext): string | undefined {
  if (error instanceof MistralReferenceAudioTooLongError) {
    // We name the skipped provider (Mistral) but NOT the fallback target —
    // the notice fires before subsequent providers attempt, so the chain
    // could continue to ElevenLabs or be empty. Hardcoding "falling back to
    // self-hosted" would be wrong in either of those cases.
    return `Voice reference for "${ctx.slug}" is ${error.durationSec.toFixed(1)}s, exceeding Mistral's ${error.limitSec.toFixed(1)}s limit. Mistral was skipped; consider re-uploading a shorter reference.`;
  }
  return undefined;
}

/**
 * Walk the fallback chain and return the first successful synthesis result.
 *
 * Errors during one provider's attempt are caught and logged; the walk
 * continues to the next provider unless the error is a non-fallback-eligible
 * `TtsProviderError`, in which case it propagates immediately.
 */
export async function dispatchTts(options: DispatchOptions): Promise<DispatchResult> {
  const { resolvedConfig, ctx, audioProviderKeys, registry } = options;

  const chain = buildFallbackChain(resolvedConfig, ctx, audioProviderKeys, registry);
  if (chain.length === 0) {
    const causeDetail = describeEmptyChainCauses(ctx, audioProviderKeys, registry);
    throw new TtsDispatchError(
      [],
      `No TTS providers available for slug=${ctx.slug} (resolved=${resolvedConfig.provider})${causeDetail}`
    );
  }

  logger.debug(
    { slug: ctx.slug, primary: resolvedConfig.provider, chain },
    'TTS fallback chain built'
  );

  const attempts: { provider: TtsProviderId; error: unknown }[] = [];
  const notices: string[] = [];
  const primaryProviderId = resolvedConfig.provider;
  // Explicit flag so the "is this the primary attempt?" invariant doesn't
  // depend on `attempts.length === 0` (which silently breaks if a future
  // change records skips in `attempts` or if the chain is rebuilt to allow
  // a duplicate primary id).
  let primaryAttempted = false;

  for (const candidateId of chain) {
    const isPrimaryAttempt = !primaryAttempted && candidateId === primaryProviderId;
    if (candidateId === primaryProviderId) {
      primaryAttempted = true;
    }
    const outcome = await attemptCandidate({ candidateId, isPrimaryAttempt, options });

    if (outcome.kind === 'success') {
      return notices.length > 0 ? { ...outcome.result, notices } : outcome.result;
    }
    if (outcome.kind === 'failed') {
      attempts.push({ provider: candidateId, error: outcome.error });
      const notice = buildAttemptNotice(outcome.error, ctx);
      if (notice !== undefined) {
        notices.push(notice);
      }
    }
    // 'skip' → just move on
  }

  throw new TtsDispatchError(attempts);
}
