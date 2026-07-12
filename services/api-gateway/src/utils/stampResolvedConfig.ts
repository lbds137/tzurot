/**
 * Config stamping for the job chain.
 *
 * Resolves the user's effective TEXT + VISION model ONCE (gateway-side, where the
 * resolvers + DB live) and stamps them onto the personality so every job in the chain
 * shares the same user-cascaded values. Split out of `jobChainOrchestrator` to keep that
 * module under the line limit and to give the resolve-and-stamp logic its own test surface.
 */

import { LLM_CONFIG_OVERRIDE_KEYS } from '@tzurot/common-types/schemas/llmAdvancedParams';
import { type ConfigSourceId } from '@tzurot/common-types/types/schemas/generation';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type ResolvedLlmConfig } from '@tzurot/common-types/types/configResolution';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { LlmConfigResolver, VisionConfigResolver } from '@tzurot/config-resolver';

const logger = createLogger('ConfigStamping');

/**
 * Apply a resolved (already-merged) LLM config onto the personality — model plus
 * EVERY override key (`contextWindowTokens`, sampling, `reasoning`, `maxTokens`,
 * …). This mirrors the pre-stamp ConfigStep merge: stamping only `model` silently
 * reverts every other preset field to the SEED personality (personality-bound
 * config, else the admin global default), which shipped as a real regression —
 * a user's 500K-context preset generated against the seed's 100K budget with the
 * preset's minP dropped. ai-worker's ConfigStep deliberately does not re-run the
 * cascade, so what's stamped here is ALL the job chain ever sees.
 */
function applyResolvedConfig(
  personality: LoadedPersonality,
  config: ResolvedLlmConfig
): LoadedPersonality {
  const result = { ...personality, model: config.model };
  for (const key of LLM_CONFIG_OVERRIDE_KEYS) {
    const value = config[key];
    if (value !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- Dynamic key assignment from LLM_CONFIG_OVERRIDE_KEYS requires runtime indexing
      (result as any)[key] = value;
    }
  }
  return result;
}

/**
 * Resolve the user's effective TEXT config AND vision model ONCE and stamp both onto
 * the personality, so every job in the chain (the conversation job AND the
 * image-description child job) shares the same user-cascaded values. The TEXT stamp
 * carries the FULL merged config — model plus every `LLM_CONFIG_OVERRIDE_KEYS` field
 * (contextWindowTokens, sampling, reasoning, …) — because nothing downstream re-runs
 * the cascade: ai-worker's `ConfigStep` trusts the stamp, and the image-description
 * job never runs the cascade at all.
 *
 * The TEXT model (`personality.model`) and the VISION model (`personality.visionModel`,
 * the carrier `selectVisionModel` reads at priority 1) resolve through INDEPENDENT
 * cascades — `LlmConfigResolver` (text slot) and `VisionConfigResolver` (vision slot).
 * Vision stamps regardless of the text source, since it's its own config axis.
 *
 * `provider` is intentionally NOT stamped: `ResolvedLlmConfig` carries no provider
 * (all configs are OpenRouter; ai-worker's ProviderRouter auto-promotes by model-name
 * prefix), so the configured seed provider must survive for AuthStep's routing to fire.
 *
 * Fails open per axis: a resolver throw (or no resolver wired) leaves that axis on the
 * seed value — never block job creation on config resolution. An unstamped vision model
 * (undefined) makes `selectVisionModel` fall to priority-2/3; the guest downgrade of a
 * stamped paid vision model stays in AuthStep.
 */
export async function stampResolvedConfig(
  personality: LoadedPersonality,
  userId: string,
  requestId: string,
  llmConfigResolver?: LlmConfigResolver,
  visionConfigResolver?: VisionConfigResolver
): Promise<{ personality: LoadedPersonality; configSource: ConfigSourceId }> {
  let stamped = personality;
  // configSource tracks only the TEXT config axis (which tier of the text cascade
  // stamped the model). The vision resolution source is intentionally NOT captured here.
  let configSource: ConfigSourceId = 'personality';

  // TEXT model: stamp personality.model from the user cascade.
  if (llmConfigResolver !== undefined) {
    try {
      const resolved = await llmConfigResolver.resolveConfig(userId, personality.id, personality);
      // Only the two user-override tiers stamp a model.
      // - 'personality': the resolved model equals the seed already → leave unchanged.
      // - 'free-default'/'hardcoded': LlmConfigResolver should never produce these
      //   (TtsConfigResolver tiers). Warn so the contract violation stays observable.
      if (resolved.source === 'free-default' || resolved.source === 'hardcoded') {
        logger.warn(
          { requestId, personalityId: personality.id, unexpectedSource: resolved.source },
          'LlmConfigResolver returned a TTS-only config source — using personality seed'
        );
      } else if (resolved.source !== 'personality') {
        // user-personality | user-default → stamp the FULL resolved (already-merged)
        // config, not just the model (see applyResolvedConfig).
        stamped = applyResolvedConfig(stamped, resolved.config);
        configSource = resolved.source;
      }
    } catch (error) {
      logger.warn(
        { err: error, requestId, personalityId: personality.id },
        'LLM config resolution failed at job-chain build — using personality seed'
      );
    }
  }

  // VISION model: stamp personality.visionModel from the INDEPENDENT vision cascade,
  // plus the ordered DB-resolved fallback chain the worker retries down on a RUNTIME
  // vision failure. The worker has no Prisma, so all DB resolution stays here.
  if (visionConfigResolver !== undefined) {
    try {
      // resolveConfig picks the effective vision model; the two default readers supply the
      // fallback tiers. Parallel — each is cache-backed after warmup (job-build, not per-token).
      const [vision, globalDefault, freeDefault] = await Promise.all([
        visionConfigResolver.resolveConfig(userId, personality.id, personality),
        visionConfigResolver.getGlobalDefaultConfig(),
        visionConfigResolver.getFreeDefaultVisionConfig(),
      ]);
      // Skip the hardcoded-fallback tier (source='hardcoded' → MODEL_DEFAULTS.VISION_FALLBACK,
      // the slow model the resolver only returns before the vision globals are seeded).
      // Stamping it would make selectVisionModel priority-1 fire and force the fallback even
      // when the main model has native vision — the exact timeout this epic targets. Leaving
      // it unstamped lets priority-2 (main-model-vision) win during the bootstrap window.
      // Symmetric with the text leg, which skips the 'personality' (= seed) source.
      if (vision.source !== 'hardcoded') {
        stamped = { ...stamped, visionModel: vision.config.model };
      }
      // The DB-resolved fallback tiers (global → free), deduped + non-empty. The worker
      // composes its local native-main + hardcoded tiers around this; only these DB tiers
      // must cross the boundary. Stamped independently of visionModel — it's for the
      // runtime-failure path, not the initial pick.
      const fallbackModels = [
        ...new Set(
          [globalDefault?.model, freeDefault?.model].filter(
            (m): m is string => m !== undefined && m.length > 0
          )
        ),
      ];
      if (fallbackModels.length > 0) {
        stamped = { ...stamped, visionFallbackModels: fallbackModels };
      }
    } catch (error) {
      logger.warn(
        { err: error, requestId, personalityId: personality.id },
        'Vision config resolution failed at job-chain build — leaving vision model unstamped'
      );
    }
  }

  return { personality: stamped, configSource };
}
