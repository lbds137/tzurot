/**
 * @tzurot/config-resolver
 *
 * Resolves the EFFECTIVE LLM / TTS / STT configuration for a request by walking
 * the override cascade: user-personality override → user default → personality
 * default → global admin default. Extracted from `@tzurot/common-types` so the
 * shared type package stays types/schemas/constants/utils only.
 *
 * This package holds the RESOLVER classes (the cascade logic). The config
 * mappers (`LlmConfigMapper`/`TtsConfigMapper`) and TTS provider types
 * (`TtsProvider`/`TtsProviderError`) stay in `@tzurot/common-types` — they're
 * data shapes consumed by common-types schemas + personality loading.
 *
 * Consumers construct the resolvers with an injected `PrismaClient` (the apps
 * own their client — see `createPrismaClient` in `@tzurot/common-types`).
 */

export {
  BaseConfigResolver,
  type BaseConfigResolverOptions,
  type ConfigOverrideEntry,
  type UserWithDefault,
} from './BaseConfigResolver.js';
export { LlmConfigResolver } from './LlmConfigResolver.js';
export { TtsConfigResolver } from './TtsConfigResolver.js';
export { VisionConfigResolver } from './VisionConfigResolver.js';
export { type SttResolutionResult, SttResolver, type SttResolverOptions } from './SttResolver.js';
export { ConfigCascadeResolver } from './ConfigCascadeResolver.js';
