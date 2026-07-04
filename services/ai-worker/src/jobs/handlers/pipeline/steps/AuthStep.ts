/**
 * Auth Step
 *
 * Resolves API key from database (BYOK) and handles guest mode.
 * API keys are NEVER passed through BullMQ jobs - they're resolved at runtime.
 */

import { AIProvider, GUEST_MODE, isFreeModel } from '@tzurot/common-types/constants/ai';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { SttResolver, LlmConfigResolver } from '@tzurot/config-resolver';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import { ProviderRouter } from '../../../../services/ProviderRouter.js';
import type { IPipelineStep, GenerationContext } from '../types.js';

const logger = createLogger('AuthStep');

export class AuthStep implements IPipelineStep {
  readonly name = 'AuthResolution';
  private readonly providerRouter: ProviderRouter | undefined;

  constructor(
    private readonly apiKeyResolver?: ApiKeyResolver,
    private readonly configResolver?: LlmConfigResolver,
    providerRouter?: ProviderRouter,
    private readonly sttResolver?: SttResolver
  ) {
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

    const llmAuth = await this.resolveLlmAuth(config.effectivePersonality, jobContext.userId);
    const {
      resolvedApiKey,
      resolvedProvider,
      isGuestMode,
      effectivePersonality,
      wasAutoPromoted,
      fallback,
    } = llmAuth;

    // Resolve audio-provider keys (ElevenLabs + Mistral). Each provider's key
    // authorizes ALL of that provider's audio endpoints — TTS, STT, cloning.
    //
    // Skipped in guest mode: isGuestMode is determined by OpenRouter resolution,
    // so a user with ONLY an audio key (no OpenRouter) won't get BYOK TTS/STT.
    // This is an intentional v1 coupling — decoupling requires per-provider
    // guest mode logic and is tracked as a follow-up.
    const audioKeysBuilder = new Map<AudioProviderId, string>();
    if (this.apiKeyResolver && !isGuestMode) {
      // ElevenLabs (existing)
      try {
        const elResult = await this.apiKeyResolver.resolveApiKey(
          jobContext.userId,
          AIProvider.ElevenLabs
        );
        if (!elResult.isGuestMode && elResult.apiKey !== undefined) {
          audioKeysBuilder.set('elevenlabs', elResult.apiKey);
          logger.debug(
            { userId: jobContext.userId, source: elResult.source },
            'Resolved ElevenLabs API key'
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, userId: jobContext.userId },
          'ElevenLabs key resolution failed, falling back to voice-engine'
        );
      }

      // Mistral (new). Same shape: failure to resolve is logged
      // and tolerated; the dispatcher will skip Mistral providers when its
      // entry is missing from the map.
      try {
        const mistralResult = await this.apiKeyResolver.resolveApiKey(
          jobContext.userId,
          AIProvider.Mistral
        );
        if (!mistralResult.isGuestMode && mistralResult.apiKey !== undefined) {
          audioKeysBuilder.set('mistral', mistralResult.apiKey);
          logger.debug(
            { userId: jobContext.userId, source: mistralResult.source },
            'Resolved Mistral API key'
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, userId: jobContext.userId },
          'Mistral key resolution failed (non-fatal — TTS dispatcher will skip Mistral)'
        );
      }
    }
    // Map is ReadonlyMap on the type contract; constructed Map narrows fine.
    const audioProviderKeys: ReadonlyMap<AudioProviderId, string> = audioKeysBuilder;

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
      },
    };
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
    userId: string
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

      // Guest Mode: enforce free-model-only on top of any router decision.
      if (route.isGuestMode) {
        effectivePersonality = await this.applyGuestModeOverrides(effectivePersonality, userId);
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
      effectivePersonality = await this.applyGuestModeOverrides(effectivePersonality, userId);
      return {
        resolvedApiKey: undefined,
        resolvedProvider: undefined,
        isGuestMode: true,
        effectivePersonality,
      };
    }
  }

  /**
   * Apply guest mode model overrides
   */
  private async applyGuestModeOverrides(
    personality: NonNullable<GenerationContext['config']>['effectivePersonality'],
    userId: string
  ): Promise<NonNullable<GenerationContext['config']>['effectivePersonality']> {
    const currentModel = personality.model;

    // If current model is already free, no change needed
    if (isFreeModel(currentModel)) {
      logger.info({ userId, model: personality.model }, 'Guest mode active - using free model');
      return personality;
    }

    // Override to guest default
    let guestModel: string = GUEST_MODE.DEFAULT_MODEL;

    // Try to get free default from database
    if (this.configResolver) {
      try {
        const freeConfig = await this.configResolver.getFreeDefaultConfig();
        if (freeConfig !== null) {
          guestModel = freeConfig.model;
          logger.debug({ model: guestModel }, 'Using database free default config');
        }
      } catch (error) {
        logger.warn({ err: error }, 'Failed to get free default config, using hardcoded fallback');
      }
    }

    logger.info(
      {
        userId,
        originalModel: currentModel,
        guestModel,
      },
      'Guest mode: overriding paid model with free model'
    );

    return {
      ...personality,
      model: guestModel,
      // Clear vision model if not free
      visionModel:
        personality.visionModel !== undefined &&
        personality.visionModel.length > 0 &&
        isFreeModel(personality.visionModel)
          ? personality.visionModel
          : undefined,
    };
  }
}
