/**
 * Model and provider resolution, shared by the factory, the cache key and the
 * invocation log.
 *
 * Kept in one place so every consumer gates on the same id and provider the
 * factory gates on, including the case where the requested id is empty and
 * the `fallbackTextModel` setting supplies it.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import type { AIProvider } from '@tzurot/common-types/constants/ai';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';

/**
 * Requested model id when non-empty, else the `fallbackTextModel` system
 * setting. The one resolution both the factory and the cache key use, so the
 * key's caching gate sees the id the factory gates on.
 */
export function resolveModelName(requestedModel: string | undefined): string {
  return requestedModel !== undefined && requestedModel.length > 0
    ? requestedModel
    : getSystemSetting('fallbackTextModel');
}

/**
 * Requested provider when set (a per-request override), else the env-level
 * `AI_PROVIDER` default. The one provider resolution the factory, the cache key
 * and the invocation log share, so the caching gate sees the provider the
 * factory gates on. Reads config at call time: the default is not captured at
 * module load.
 */
export function resolveProvider(provider: AIProvider | undefined): AIProvider {
  return provider ?? getConfig().AI_PROVIDER;
}
