/**
 * BYOK (Bring Your Own Key) Types
 *
 * Shared type definitions for user API key management,
 * LLM config management, and usage tracking.
 */

/**
 * Summary of a personality for autocomplete/listing
 * Used in responses for /user/personality
 */
export interface PersonalitySummary {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  /** True if the requesting user owns this personality */
  isOwned: boolean;
  /** True if the personality is publicly visible */
  isPublic: boolean;
}

/**
 * Summary of an LLM configuration
 * Used in list responses for /user/llm-config
 */
export interface LlmConfigSummary {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  visionModel: string | null;
  isGlobal: boolean;
  isDefault: boolean;
  /** True if the requesting user owns this config */
  isOwned: boolean;
}

/**
 * Summary of a model override
 * Used in list responses for /user/model-override
 */
export interface ModelOverrideSummary {
  personalityId: string;
  personalityName: string;
  configId: string | null;
  configName: string | null;
}

/**
 * Token usage breakdown by category
 */
export interface UsageBreakdown {
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Valid time periods for usage queries
 */
export type UsagePeriod = 'day' | 'week' | 'month' | 'all';

/**
 * Token usage statistics
 * Used in responses for /user/usage
 */
export interface UsageStats {
  period: UsagePeriod;
  periodStart: string | null;
  periodEnd: string;
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokens: number;
  byProvider: Record<string, UsageBreakdown>;
  byModel: Record<string, UsageBreakdown>;
  byRequestType: Record<string, UsageBreakdown>;
}
