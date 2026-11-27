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
import {
  ApiKeyLookupError,
  EncryptionMisconfiguredError,
  NoApiKeyAvailableError,
  UndecryptableApiKeyError,
  type ApiKeyResolver,
} from '../../../../services/ApiKeyResolver.js';
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
import {
  authCacheKeyId,
  resolveEffectiveTier,
  type EffectiveTier,
  type KeyProvenance,
} from '../../../../services/effectiveTier.js';
import { tryPromotionDemotion } from './promotionDemotion.js';
import { resolveRetargetRoute } from './retargetRoute.js';
import type { ZaiFreeTierAdmission } from '../../../../services/ZaiFreeTierAdmission.js';
import {
  applyGuestModeOverrides,
  piggybackFields,
  type GuestOverrideResult,
} from './guestModeOverrides.js';
import {
  buildPostRouteLlmAuth,
  provenanceFromResolution,
  toResolvedAuth,
  type ResolvedLlmAuth,
} from './postRouteLlmAuth.js';
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
      (apiKeyResolver !== undefined
        ? new ProviderRouter(apiKeyResolver, extras?.quotaFallbackCaches?.catalogPresence)
        : undefined);
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

    const audioProviderKeys = await this.resolveAudioProviderKeys(jobContext.userId);

    // Resolve STT dispatch once here so downstream steps (DependencyStep,
    // GenerationStep → MultimodalProcessor) don't each re-resolve. SttResolver
    // is optional in the constructor for test fixtures; production always
    // wires it via LLMGenerationHandler.
    const sttDispatch = await this.resolveSttDispatch(jobContext.userId, audioProviderKeys);

    // Update config with potentially modified personality
    const updatedConfig = {
      ...config,
      effectivePersonality: llmAuth.effectivePersonality,
    };

    return {
      ...context,
      config: updatedConfig,
      auth: toResolvedAuth(llmAuth, audioProviderKeys, sttDispatch),
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
  ): Promise<ResolvedLlmAuth> {
    const llmAuth = await this.resolveLlmAuth(initialPersonality, userId, requestId);

    // One viability check for the resolved route, shared by the demotion tier
    // and the quota retarget — they'd otherwise each hit the doom caches for
    // the same (model, key) pair on every promoted request.
    const viability =
      this.quotaFallbackCaches === undefined
        ? null
        : await checkModelViability({
            model: llmAuth.effectivePersonality.model,
            // Guest routes (incl. the z.ai piggyback) resolve a SYSTEM key —
            // identity follows provenance, or a guest's check would read the
            // user's own BYOK doom marks and veto an already-admitted route.
            cacheKeyId: authCacheKeyId(llmAuth, llmAuth.resolvedApiKey, userId),
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
      keyProvenance: llmAuth.keyProvenance,
      effectiveTier: llmAuth.effectiveTier,
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
      keyProvenance: proactive.keyProvenance,
      effectiveTier: proactive.effectiveTier,
      quotaFallback: proactive.info,
      // The separately-tracked provider tier must follow the retarget too —
      // it drives the context-window clamp, cross-provider vision auth, and
      // the footer badge downstream. Phase-0 targets (admin defaults) are
      // OpenRouter-routed by construction; revisit if an explicit fallback
      // edge ever allows a non-OpenRouter target.
      resolvedProvider: AIProvider.OpenRouter,
      // The retarget replaced the promoted model/provider, so the pre-computed
      // auto-promotion passthrough route no longer describes this request —
      // carrying it forward would let GenerationStep retry a failure via the
      // STALE route (the original z-ai model), which is the exact dead end the
      // retarget just escaped. Likewise, fallthroughTriggered says the
      // original zai-coding route fell through, which no longer describes a
      // retargeted admin-default model.
      wasAutoPromoted: undefined,
      fallthroughTriggered: undefined,
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
    keyProvenance: KeyProvenance;
    effectiveTier: EffectiveTier;
    userId: string;
    jobId: string | undefined;
    /** Doom category already established by the caller's shared viability check. */
    knownCategory?: QuotaFallbackCategory;
  }): Promise<{
    personality: NonNullable<GenerationContext['config']>['effectivePersonality'];
    apiKey: string | undefined;
    isGuestMode: boolean;
    keyProvenance: KeyProvenance;
    effectiveTier: EffectiveTier;
    info: QuotaFallbackInfo;
  } | null> {
    if (this.quotaFallbackCaches === undefined || this.configResolver === undefined) {
      return null;
    }

    const { personality, apiKey, isGuestMode, keyProvenance, effectiveTier, userId, jobId } =
      options;
    const cacheKeyId = authCacheKeyId({ keyProvenance }, apiKey, userId);
    let category = options.knownCategory;
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
      tier: effectiveTier,
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
      source: keyProvenance === 'user' ? 'user' : 'system',
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
      source: retargetSource,
      isGuestMode: retargetIsGuestMode,
    } = resolved;
    const retargetProvenance = provenanceFromResolution(retargetSource, retargetApiKey);

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
      keyProvenance: retargetProvenance,
      effectiveTier: resolveEffectiveTier({ keyProvenance: retargetProvenance }),
      info,
    };
  }

  /**
   * Resolve audio-provider keys (ElevenLabs + Mistral). Each provider's key
   * authorizes ALL of that provider's audio endpoints — TTS, STT, cloning.
   *
   * Independent of the chat guest-mode decision: that verdict comes from
   * OpenRouter/LLM resolution, whereas these are provider-scoped lookups. Each
   * provider's OWN resolution result is the admission guard — a guest-mode
   * result or a missing key keeps that provider out of the map — so a user who
   * is a chat guest but holds a BYOK audio key still gets BYOK TTS/STT.
   * Per-provider resolution failure is logged and tolerated; the dispatcher
   * skips providers whose entry is missing from the map.
   */
  private async resolveAudioProviderKeys(
    userId: string
  ): Promise<ReadonlyMap<AudioProviderId, string>> {
    const audioKeysBuilder = new Map<AudioProviderId, string>();
    const resolver = this.apiKeyResolver;
    if (!resolver) {
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
    // The lookups are independent (one per provider, no shared state) and both
    // sit on an uncached path for keyless users, so they run concurrently and
    // each owns its failure handling — one provider's error never affects the
    // other.
    const resolutions = await Promise.all(
      providers.map(async ({ id, provider, failNote }) => {
        try {
          return { id, result: await resolver.resolveApiKey(userId, provider) };
        } catch (error) {
          if (error instanceof NoApiKeyAvailableError) {
            // Expected for BYOK-only audio providers: a user without their own
            // key hits this on EVERY job (negative results aren't cached). The
            // fallback is deterministic and the note already names it, so this
            // is compact debug — no stack, no err object.
            logger.debug({ userId, provider: id }, failNote);
          } else {
            // Unexpected resolution failure (DB down, an undecryptable or
            // misconfigured key) — keep the stack; this one IS an incident.
            // Deliberately tolerated for AUDIO keys even when the stored key is
            // unreadable: the text turn still works and voice degrades to the
            // self-hosted engine, unlike the LLM key where silence demoted the
            // user's model tier.
            logger.warn({ err: error, userId }, failNote);
          }
          return { id, result: undefined };
        }
      })
    );

    // Populate in providers-array order (Promise.all preserves it) so map
    // insertion order stays deterministic regardless of resolution timing.
    for (const { id, result } of resolutions) {
      if (result !== undefined && !result.isGuestMode && result.apiKey !== undefined) {
        audioKeysBuilder.set(id, result.apiKey);
        logger.debug({ userId, source: result.source, provider: id }, 'Resolved audio API key');
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
  ): Promise<ResolvedLlmAuth> {
    let effectivePersonality = initialPersonality;

    // Test-only wiring: prod constructs AuthStep only at LLMGenerationHandler.ts:244 with a real apiKeyResolver.
    if (!this.apiKeyResolver || !this.providerRouter) {
      return {
        resolvedApiKey: undefined,
        resolvedProvider: undefined,
        isGuestMode: false,
        keyProvenance: 'none',
        effectiveTier: resolveEffectiveTier({ keyProvenance: 'none' }),
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
      // passes, upgrade to GLM-5.3-Flash on the system coding-plan key.
      // Carries the guest substitution's footer announce past the block, so
      // BOTH guest exits (z.ai upgrade and plain free-model override) report
      // it — the swap is never silent on either arm.
      let guest: GuestOverrideResult | undefined;
      const preLadderProvenance = provenanceFromResolution(route.source, route.apiKey);
      const preLadderTier = resolveEffectiveTier({ keyProvenance: preLadderProvenance });

      if (preLadderTier === 'free') {
        guest = await applyGuestModeOverrides(
          { configResolver: this.configResolver, zaiFreeTierAdmission: this.zaiFreeTierAdmission },
          effectivePersonality,
          userId,
          requestId
        );
        effectivePersonality = guest.personality;
      }

      return buildPostRouteLlmAuth(route, effectivePersonality, guest);
    } catch (error) {
      // A stored key that will not decrypt (or a broken encryption env) must
      // fail the job, not demote the user to free models: the handler renders
      // the re-enter copy / a loud error instead. A failed key READ is the same
      // class: the user's key was never seen, so guest mode would be a silent
      // demotion (the handler fails it loudly).
      if (
        error instanceof UndecryptableApiKeyError ||
        error instanceof EncryptionMisconfiguredError ||
        error instanceof ApiKeyLookupError
      ) {
        throw error;
      }
      // Any other resolution failure is unexpected (normal guest mode is
      // signaled via isGuestMode=true, not by throwing). Recover by falling
      // back to guest.
      logger.error({ err: error, userId }, 'Failed to resolve API key, falling back to guest mode');
      return this.guestModeFallback(effectivePersonality, userId, requestId);
    }
  }

  /**
   * Resolution-failure recovery: degrade to the guest ladder on the pre-route
   * personality. Extracted from `resolveLlmAuth`'s catch arm to keep that
   * function within the per-function line cap.
   */
  private async guestModeFallback(
    effectivePersonality: NonNullable<GenerationContext['config']>['effectivePersonality'],
    userId: string,
    requestId: string
  ): Promise<ResolvedLlmAuth> {
    const guest = await applyGuestModeOverrides(
      { configResolver: this.configResolver, zaiFreeTierAdmission: this.zaiFreeTierAdmission },
      effectivePersonality,
      userId,
      requestId
    );
    const keyProvenance = provenanceFromResolution('system', guest.zaiSystemKey);
    return {
      resolvedApiKey: guest.zaiSystemKey,
      resolvedProvider: guest.zaiSystemKey !== undefined ? AIProvider.ZaiCoding : undefined,
      isGuestMode: true,
      keyProvenance,
      effectiveTier: resolveEffectiveTier({ keyProvenance }),
      effectivePersonality: guest.personality,
      ...(guest.quotaFallback !== undefined ? { quotaFallback: guest.quotaFallback } : {}),
      ...piggybackFields(guest),
    };
  }
}
