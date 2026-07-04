/**
 * ModelCapabilityService
 *
 * Resolves a model's modality capabilities into the unified, provider-agnostic
 * {@link ModelCapabilities} shape, regardless of which provider serves it. This
 * is the first concrete step toward decoupling capability resolution from any
 * single provider — today it unifies OpenRouter (authoritative) and the z.ai
 * coding-plan catalog; future providers slot in as additional resolution
 * sources without every caller learning each provider's native format.
 *
 * Capabilities are a property of the MODEL, not the requesting user — a model's
 * vision support doesn't change with who's asking. Access concerns (e.g. "needs
 * a z.ai-coding key to actually run this") live in the context/access
 * validators, not here, so `resolve` takes only the model id.
 */

import { zaiCodingPlanModelCapabilities } from '@tzurot/common-types/constants/ai';
import { type ModelCapabilities } from '@tzurot/common-types/types/ai';
import type { OpenRouterModelCache } from './OpenRouterModelCache.js';

export class ModelCapabilityService {
  /**
   * @param modelCache - OpenRouter model cache. May be `undefined` (not wired
   *   in local dev / tests) — resolution then falls back to the static z.ai
   *   catalog, and returns `null` for any OpenRouter-only model.
   */
  constructor(private readonly modelCache: OpenRouterModelCache | undefined) {}

  /**
   * Resolve `modelId`'s capabilities. Resolution priority:
   *
   * 1. **OpenRouter (authoritative).** If the model is in the OpenRouter cache,
   *    its capability tags win — even for `z-ai/`-namespaced models that also
   *    live on OpenRouter (e.g. `z-ai/glm-5.1`). Per project direction,
   *    OpenRouter is the source of truth for any model it carries.
   * 2. **z.ai coding-plan catalog.** For `z-ai/`-prefixed models absent from
   *    OpenRouter (e.g. `z-ai/glm-5.2`), fall back to the static z.ai catalog
   *    (text-only today). `zaiCodingPlanModelCapabilities` handles the
   *    prefix-strip / case-normalize / non-member-null itself.
   * 3. **null.** Unknown to both sources — the caller treats this as "can't
   *    confirm," which fails closed for a vision gate.
   *
   * Returns `null` (not an error) when the OpenRouter cache is unavailable AND
   * the model isn't a z.ai-catalog member, mirroring `getModelById`'s
   * graceful-degrade contract (it returns null both on cache-miss and
   * cache-unavailable).
   */
  async resolve(modelId: string): Promise<ModelCapabilities | null> {
    const openRouterModel = await this.modelCache?.getModelById(modelId);
    if (openRouterModel !== null && openRouterModel !== undefined) {
      return {
        supportsVision: openRouterModel.supportsVision,
        supportsImageGeneration: openRouterModel.supportsImageGeneration,
        supportsAudioInput: openRouterModel.supportsAudioInput,
        supportsAudioOutput: openRouterModel.supportsAudioOutput,
        contextLength: openRouterModel.contextLength,
        source: 'openrouter',
      };
    }

    // Not on OpenRouter (or cache unavailable): try the z.ai catalog, else null.
    return zaiCodingPlanModelCapabilities(modelId);
  }

  /**
   * Convenience: just the vision flag. Defaults to `false` when capability is
   * unknown (cache unavailable + not a z.ai-catalog member) — fail-closed, so an
   * unresolvable model is never treated as vision-eligible.
   */
  async supportsVision(modelId: string): Promise<boolean> {
    return (await this.resolve(modelId))?.supportsVision ?? false;
  }
}
