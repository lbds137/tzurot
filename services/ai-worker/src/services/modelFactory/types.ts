/**
 * Model Factory Types
 *
 * Shared type definitions for the model factory module.
 * Extracted to break the circular dependency between ModelFactory and CacheKeyBuilder.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ConvertedLlmParams } from '@tzurot/common-types';

/**
 * Model configuration for creating chat models.
 * Extends ConvertedLlmParams to include ALL parameters from advancedParameters JSONB.
 */
export interface ModelConfig extends ConvertedLlmParams {
  modelName?: string;
  apiKey?: string; // User-provided key (BYOK)
}

/**
 * Result of creating a chat model
 */
export interface ChatModelResult {
  model: BaseChatModel;
  modelName: string;
}
