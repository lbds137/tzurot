/**
 * Config stamping for the job chain.
 *
 * Resolves the user's effective TEXT + VISION model ONCE (gateway-side, where the
 * resolvers + DB live) and stamps them onto the personality so every job in the chain
 * shares the same user-cascaded values. Split out of `jobChainOrchestrator` to keep that
 * module under the line limit and to give the resolve-and-stamp logic its own test surface.
 */

import { createLogger, type LoadedPersonality, type ConfigSourceId } from '@tzurot/common-types';
import type { LlmConfigResolver, VisionConfigResolver } from '@tzurot/config-resolver';

const logger = createLogger('ConfigStamping');

/**
 * Resolve the user's effective TEXT model AND vision model ONCE and stamp both onto
 * the personality, so every job in the chain (the conversation job AND the
 * image-description child job) shares the same user-cascaded values. Without this,
 * the image-description job would consume the personality SEED values (the load-time
 * defaults) because it never runs ai-worker's `ConfigStep` cascade.
 *
 * The TEXT model (`personality.model`) and the VISION model (`personality.visionModel`,
 * the carrier `selectVisionModel` reads at priority 1) resolve through INDEPENDENT
 * cascades — `LlmConfigResolver` (kind='text') and `VisionConfigResolver` (kind='vision').
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
        // user-personality | user-default → stamp the resolved (already-merged) model.
        stamped = { ...stamped, model: resolved.config.model };
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
