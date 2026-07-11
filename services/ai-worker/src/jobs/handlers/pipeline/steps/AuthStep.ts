/**
 * Auth Step
 *
 * Resolves API key from database (BYOK) and handles guest mode.
 * API keys are NEVER passed through BullMQ jobs - they're resolved at runtime.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { SttResolver, LlmConfigResolver } from '@tzurot/config-resolver';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import { ProviderRouter } from '../../../../services/ProviderRouter.js';
import {
  applyConfigToPersonality,
  checkModelViability,
  logQuotaFallbackAudit,
  selectQuotaFallbackTarget,
  type QuotaFallbackCaches,
  type QuotaFallbackCategory,
  type QuotaFallbackInfo,
} from '../../../../services/quotaFallback.js';
import { deriveCacheKeyId } from '../../../../services/RateLimitCache.js';
import { tryPromotionDemotion } from './promotionDemotion.js';
import { resolveRetargetRoute } from './retargetRoute.js';
import type { ZaiFreeTierAdmission } from '../../../../services/ZaiFreeTierAdmission.js';
import { applyGuestModeOverrides } from './guestModeOverrides.js';
import type { IPipelineStep, GenerationContext } from '../types.js';

const logger = createLogger('AuthStep');

export class AuthStep implements IPipelineStep {
  readonly name = 'AuthResolution';
  private readonly providerRouter: ProviderRouter | undefined;
  private readonly quotaFallbackCaches: QuotaFallbackCaches | undefined;
  private readonly zaiFreeTierAdmission: ZaiFreeTierAdmission | undefined;

  constructor(
    private readonly apiKeyResolver?: ApiKeyResolver,
    private readonly configResolver?: LlmConfigResolver,
    providerRouter?: ProviderRouter,
    private readonly sttResolver?: SttResolver,
    /** Quota-adjacent extras, bundled to keep the DI surface at five params. */
    extras?: {
      quotaFallbackCaches?: QuotaFallbackCaches;
      /** z.ai free-tier piggyback gate; absent (tests/dark) means never upgrade. */
      zaiFreeTierAdmission?: ZaiFreeTierAdmission;
    }
  ) {
    this.quotaFallbackCaches = extras?.quotaFallbackCaches;
    this.zaiFreeTierAdmission = extras?.zaiFreeTierAdmission;
    // ProviderRouter wraps ApiKeyResolver to encode the auto-fallthrough
    // routing rule for `zai-coding` (and any future provider that needs it).
    // The optional `providerRouter` parameter lets tests inject a mock to
    // isolate AuthStep behavior from ProviderRouter — without it, AuthStep
    // tests exercise both layers and a ProviderRouter bug manifests as an
    // AuthStep test failure. Production callers omit the parameter and get
    // the inline-constructed router.
    this.providerRouter =
      providerRouter ??
      (apiKeyResolver !== undefined ? new ProviderRouter(apiKeyResolver) : undefined);
  }

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, config } = context;
    const { context: jobContext } = job.data;

    if (!config) {
      throw new Error('[AuthStep] ConfigStep must run before AuthStep');
    }

    const llmAuth = await this.resolveLlmAuthWithQuotaCheck(
      config.effectivePersonality,
      jobContext.userId,
      job.id,
      job.data.requestId
    );
    const {
      resolvedApiKey,
      resolvedProvider,
      isGuestMode,
      effectivePersonality,
      wasAutoPromoted,
      fallback,
      quotaFallback,
    } = llmAuth;

    const audioProviderKeys = await this.resolveAudioProviderKeys(jobContext.userId, isGuestMode);

    // Resolve STT dispatch once here so downstream steps (DependencyStep,
    // GenerationStep → MultimodalProcessor) don't each re-resolve. SttResolver
    // is optional in the constructor for test fixtures; production always
    // wires it via LLMGenerationHandler.
    const sttDispatch = await this.resolveSttDispatch(jobContext.userId, audioProviderKeys);

    // Update config with potentially modified personality
    const updatedConfig = {
      ...config,
      effectivePersonality,
    };

    return {
      ...context,
      config: updatedConfig,
      auth: {
        apiKey: resolvedApiKey,
        provider: resolvedProvider,
        isGuestMode,
        audioProviderKeys,
        sttDispatch,
        // wasAutoPromoted and fallback are co-invariant by ProviderRouter
        // construction (always set together or neither). Spread separately
        // here only because they're both optional on the type. If a future
        // routing path sets wasAutoPromoted without fallback, the downstream
        // guard in GenerationStep degrades gracefully (no retry attempted)
        // rather than crashing — silent no-op is preferable to a runtime fault.
        ...(wasAutoPromoted === true ? { wasAutoPromoted: true } : {}),
        ...(fallback !== undefined ? { fallback } : {}),
        ...(quotaFallback !== undefined ? { quotaFallback } : {}),
      },
    };
  }

  /**
   * Resolve LLM auth, then apply the PROACTIVE quota check on the result: if
   * the resolved model is already known-doomed for this account
   * (exhaustion/rate caches), retarget NOW and skip the doomed round-trip.
   * Same target matrix as the reactive path.
   */
  private async resolveLlmAuthWithQuotaCheck(
    initialPersonality: NonNullable<GenerationContext['config']>['effectivePersonality'],
    userId: string,
    jobId: string | undefined,
    requestId: string
  ): Promise<
    Awaited<ReturnType<AuthStep['resolveLlmAuth']>> & { quotaFallback?: QuotaFallbackInfo }
  > {
    const llmAuth = await this.resolveLlmAuth(initialPersonality, userId, requestId);

    // One viability check for the resolved route, shared by the demotion tier
    // and the quota retarget — they'd otherwise each hit the doom caches for
    // the same (model, key) pair on every promoted request.
    const viability =
      this.quotaFallbackCaches === undefined
        ? null
        : await checkModelViability({
            model: llmAuth.effectivePersonality.model,
            cacheKeyId: deriveCacheKeyId(llmAuth.resolvedApiKey, userId),
            caches: this.quotaFallbackCaches,
          });
    if (viability === null || viability.viable) {
      return llmAuth;
    }

    // Demotion tier: a doomed AUTO-PROMOTED route demotes to its pre-computed
    // OpenRouter passthrough (same model, different key → separate quota/rate
    // pool) BEFORE any global-default retarget. The preset's model is only
    // abandoned when BOTH pools are doomed — z.ai coding-plan quota is not
    // OpenRouter quota, and the user configured this model on purpose.
    const demotion = await tryPromotionDemotion(
      llmAuth,
      userId,
      viability.category,
      this.quotaFallbackCaches
    );
    if (demotion !== null) {
      return demotion;
    }

    const proactive = await this.applyProactiveQuotaFallback({
      personality: llmAuth.effectivePersonality,
      apiKey: llmAuth.resolvedApiKey,
      isGuestMode: llmAuth.isGuestMode,
      userId,
      jobId,
      knownCategory: viability.category,
    });
    if (proactive === null) {
      return llmAuth;
    }
    return {
      ...llmAuth,
      effectivePersonality: proactive.personality,
      resolvedApiKey: proactive.apiKey,
      isGuestMode: proactive.isGuestMode,
      quotaFallback: proactive.info,
      // The separately-tracked provider tier must follow the retarget too —
      // it drives the context-window clamp, cross-provider vision auth, and
      // the footer badge downstream. Phase-0 targets (admin defaults) are
      // OpenRouter-routed by construction; revisit if an explicit fallback
      // edge ever allows a non-OpenRouter target.
      resolvedProvider: AIProvider.OpenRouter,
      // The retarget replaced the promoted model/provider, so the
      // pre-computed auto-promotion passthrough route no longer describes
      // this request — carrying it forward would let GenerationStep retry a
      // failure via the STALE route (the original z-ai model), which is the
      // exact dead end the retarget just escaped.
      wasAutoPromoted: undefined,
      fallback: undefined,
    };
  }

  /**
   * Proactive half of the tier-aware quota fallback: consult the doom-caches
   * for the resolved model and retarget before dispatch when it's already
   * known-blocked. Returns null when no retarget applies (the common case,
   * or when the caches/resolver aren't wired — test fixtures). When a
   * retarget fires, the caller also clears the auto-promotion route (it
   * describes the replaced model).
   */
  private async applyProactiveQuotaFallback(options: {
    personality: NonNullable<GenerationContext['config']>['effectivePersonality'];
    apiKey: string | undefined;
    isGuestMode: boolean;
    userId: string;
    jobId: string | undefined;
    /** Doom category already established by the caller's shared viability check. */
    knownCategory?: QuotaFallbackCategory;
  }): Promise<{
    personality: NonNullable<GenerationContext['config']>['effectivePersonality'];
    apiKey: string | undefined;
    isGuestMode: boolean;
    info: QuotaFallbackInfo;
  } | null> {
    if (this.quotaFallbackCaches === undefined || this.configResolver === undefined) {
      return null;
    }

    const { personality, apiKey, isGuestMode, userId, jobId, knownCategory } = options;
    const cacheKeyId = deriveCacheKeyId(apiKey, userId);
    let category = knownCategory;
    if (category === undefined) {
      const viability = await checkModelViability({
        model: personality.model,
        cacheKeyId,
        caches: this.quotaFallbackCaches,
      });
      if (viability.viable) {
        return null;
      }
      category = viability.category;
    }

    const target = await selectQuotaFallbackTarget({
      category,
      isGuestMode,
      failingModel: personality.model,
      cacheKeyId,
      configResolver: this.configResolver,
      caches: this.quotaFallbackCaches,
    });
    if (target === null) {
      return null;
    }

    const resolved = await resolveRetargetRoute({
      target,
      personality,
      apiKey,
      isGuestMode,
      userId,
      category,
      cacheKeyId,
      deps: {
        apiKeyResolver: this.apiKeyResolver,
        configResolver: this.configResolver,
        caches: this.quotaFallbackCaches,
      },
    });
    if (resolved === null) {
      return null;
    }
    const {
      config: retargetConfig,
      apiKey: retargetApiKey,
      isGuestMode: retargetIsGuestMode,
    } = resolved;

    const info: QuotaFallbackInfo = {
      fromModel: personality.model,
      toModel: retargetConfig.model,
      category,
      mode: 'proactive',
    };
    logQuotaFallbackAudit(info, { jobId, cacheKeyId });

    return {
      personality: applyConfigToPersonality(personality, retargetConfig),
      apiKey: retargetApiKey,
      isGuestMode: retargetIsGuestMode,
      info,
    };
  }

  /**
   * Resolve audio-provider keys (ElevenLabs + Mistral). Each provider's key
   * authorizes ALL of that provider's audio endpoints — TTS, STT, cloning.
   *
   * Skipped in guest mode: isGuestMode is determined by OpenRouter resolution,
   * so a user with ONLY an audio key (no OpenRouter) won't get BYOK TTS/STT.
   * This is an intentional v1 coupling — decoupling requires per-provider
   * guest mode logic and is tracked as a follow-up. Per-provider resolution
   * failure is logged and tolerated; the dispatcher skips providers whose
   * entry is missing from the map.
   */
  private async resolveAudioProviderKeys(
    userId: string,
    isGuestMode: boolean
  ): Promise<ReadonlyMap<AudioProviderId, string>> {
    const audioKeysBuilder = new Map<AudioProviderId, string>();
    if (!this.apiKeyResolver || isGuestMode) {
      return audioKeysBuilder;
    }
    const providers: { id: AudioProviderId; provider: AIProvider; failNote: string }[] = [
      {
        id: 'elevenlabs',
        provider: AIProvider.ElevenLabs,
        failNote: 'ElevenLabs key resolution failed, falling back to voice-engine',
      },
      {
        id: 'mistral',
        provider: AIProvider.Mistral,
        failNote: 'Mistral key resolution failed (non-fatal — TTS dispatcher will skip Mistral)',
      },
    ];
    for (const { id, provider, failNote } of providers) {
      try {
        const result = await this.apiKeyResolver.resolveApiKey(userId, provider);
        if (!result.isGuestMode && result.apiKey !== undefined) {
          audioKeysBuilder.set(id, result.apiKey);
          logger.debug({ userId, source: result.source, provider: id }, 'Resolved audio API key');
        }
      } catch (error) {
        logger.warn({ err: error, userId }, failNote);
      }
    }
    return audioKeysBuilder;
  }

  /**
   * Resolve the STT dispatch (provider + matching BYOK key) once per job.
   * Returns undefined when no SttResolver is wired (test fixtures); downstream
   * consumers fall back to a voice-engine dispatch in that case.
   *
   * BYOK providers (mistral, elevenlabs) need their key looked up from
   * `audioProviderKeys`; voice-engine is keyless. If the resolver picks a BYOK
   * provider but no matching key is present, apiKey stays undefined and
   * AudioProcessor's dispatch falls through to voice-engine on attempt.
   */
  private async resolveSttDispatch(
    userId: string,
    audioProviderKeys: ReadonlyMap<AudioProviderId, string>
  ): Promise<SttDispatch | undefined> {
    if (!this.sttResolver) {
      return undefined;
    }
    try {
      const result = await this.sttResolver.resolveProvider(userId);
      return {
        provider: result.provider,
        apiKey:
          result.provider === 'voice-engine' ? undefined : audioProviderKeys.get(result.provider),
      };
    } catch (error) {
      // STT dispatch is only consumed on attachment paths; a resolver failure
      // (DB/network) shouldn't fail a turn that has no audio. Degrade to the
      // self-hosted fallback and let AudioProcessor handle it from there.
      logger.warn({ err: error, userId }, 'STT resolver failed; falling back to voice-engine');
      return { provider: 'voice-engine' };
    }
  }

  /**
   * Resolve LLM-side auth: route via ProviderRouter (with auto-fallthrough),
   * apply post-route overrides to effectivePersonality, fall back to guest
   * mode on resolution failure. Extracted from `process()` to keep the main
   * orchestration flow within cognitive-complexity limits.
   */
  private async resolveLlmAuth(
    initialPersonality: NonNullable<GenerationContext['config']>['effectivePersonality'],
    userId: string,
    requestId: string
  ): Promise<{
    resolvedApiKey: string | undefined;
    resolvedProvider: AIProvider | undefined;
    isGuestMode: boolean;
    effectivePersonality: NonNullable<GenerationContext['config']>['effectivePersonality'];
    wasAutoPromoted?: boolean;
    fallback?: NonNullable<GenerationContext['auth']>['fallback'];
  }> {
    let effectivePersonality = initialPersonality;

    if (!this.apiKeyResolver || !this.providerRouter) {
      return {
        resolvedApiKey: undefined,
        resolvedProvider: undefined,
        isGuestMode: false,
        effectivePersonality,
      };
    }

    try {
      // Route through ProviderRouter: reads `effectivePersonality.provider`
      // (plumbed end-to-end after PR 2 Phase A) to decide direct vs fallthrough.
      const route = await this.providerRouter.resolveRoute(
        effectivePersonality.provider,
        effectivePersonality.model,
        userId
      );

      // Route override: apply BOTH model-name and provider overrides so
      // downstream code (ConversationalRAGService → ModelFactory) reads the
      // post-route values. Without the provider override, ModelFactory would
      // route to the wrong client using the wrong key. Fires on either
      // direction of the routing decision: zai-coding → openrouter (no key
      // fallthrough) OR openrouter z-ai/ → zai-coding (auto-promotion).
      if (route.fallthroughTriggered || route.wasAutoPromoted) {
        effectivePersonality = {
          ...effectivePersonality,
          model: route.effectiveModel,
          provider: route.effectiveProvider,
        };
      }

      logger.debug(
        {
          userId,
          configuredProvider: initialPersonality.provider,
          effectiveProvider: route.effectiveProvider,
          effectiveModel: route.effectiveModel,
          fallthroughTriggered: route.fallthroughTriggered,
          wasAutoPromoted: route.wasAutoPromoted,
          isGuestMode: route.isGuestMode,
        },
        'Resolved provider route'
      );

      // Guest Mode: enforce free-model-only on top of any router decision —
      // or, when the free default is the z.ai piggyback preset and admission
      // passes, upgrade to GLM-4.5-Air on the system coding-plan key.
      if (route.isGuestMode) {
        const guest = await applyGuestModeOverrides(
          { configResolver: this.configResolver, zaiFreeTierAdmission: this.zaiFreeTierAdmission },
          effectivePersonality,
          userId,
          requestId
        );
        effectivePersonality = guest.personality;
        if (guest.zaiSystemKey !== undefined) {
          return {
            resolvedApiKey: guest.zaiSystemKey,
            resolvedProvider: AIProvider.ZaiCoding,
            isGuestMode: true,
            effectivePersonality,
            wasAutoPromoted: route.wasAutoPromoted,
            fallback: route.fallback,
          };
        }
      }

      return {
        resolvedApiKey: route.apiKey,
        resolvedProvider: route.effectiveProvider,
        isGuestMode: route.isGuestMode,
        effectivePersonality,
        wasAutoPromoted: route.wasAutoPromoted,
        fallback: route.fallback,
      };
    } catch (error) {
      // Resolution failure is unexpected (normal guest mode is signaled via
      // isGuestMode=true, not by throwing). Recover by falling back to guest.
      logger.error({ err: error, userId }, 'Failed to resolve API key, falling back to guest mode');
      const guest = await applyGuestModeOverrides(
        { configResolver: this.configResolver, zaiFreeTierAdmission: this.zaiFreeTierAdmission },
        effectivePersonality,
        userId,
        requestId
      );
      effectivePersonality = guest.personality;
      return {
        resolvedApiKey: guest.zaiSystemKey,
        resolvedProvider: guest.zaiSystemKey !== undefined ? AIProvider.ZaiCoding : undefined,
        isGuestMode: true,
        effectivePersonality,
      };
    }
  }
}
