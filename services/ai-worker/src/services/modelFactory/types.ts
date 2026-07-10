/**
 * Model Factory Types
 *
 * Shared type definitions for the model factory module.
 * Extracted to break the circular dependency between ModelFactory and CacheKeyBuilder.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AIProvider } from '@tzurot/common-types/constants/ai';
import type { ConvertedLlmParams } from '@tzurot/common-types/schemas/llmAdvancedParams';

/**
 * Model configuration for creating chat models.
 * Extends ConvertedLlmParams to include ALL parameters from advancedParameters JSONB.
 */
export interface ModelConfig extends ConvertedLlmParams {
  modelName?: string;
  apiKey?: string; // User-provided key (BYOK)
  /**
   * Per-request provider override. When set, ModelFactory uses this provider
   * instead of the env-level `config.AI_PROVIDER` default. Required to route
   * a single request to a non-default provider (e.g. z.ai-coding) based on
   * the resolved LlmConfig's provider field.
   */
  provider?: AIProvider;
  /**
   * Appended to the X-Title OpenRouter attribution header so background
   * workloads (e.g. fact extraction) show as a distinct app in the dashboard
   * instead of blending into chat-completion traffic. OpenRouter-only; other
   * providers ignore it.
   */
  appTitleSuffix?: string;
  /**
   * Whether the model supports reasoning parameters.
   * Resolved async by caller via checkModelReasoningSupport().
   * When false, reasoning params are silently skipped with a log warning.
   * When undefined, reasoning params are passed through (backward compatible).
   */
  supportsReasoning?: boolean;
}

/**
 * Result of creating a chat model
 */
export interface ChatModelResult {
  model: BaseChatModel;
  modelName: string;
}
