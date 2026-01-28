/**
 * BYOK (Bring Your Own Key) Types
 *
 * Shared type definitions for user API key management,
 * LLM config management, and usage tracking.
 */

import type { EntityPermissions } from '../utils/permissions.js';

/**
 * Summary of a personality for autocomplete/listing
 * Used in responses for /user/personality
 */
export interface PersonalitySummary {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  /** True if the requesting user created this personality (truthful attribution) */
  isOwned: boolean;
  /** True if the personality is publicly visible */
  isPublic: boolean;
  /** Owner's internal user ID */
  ownerId: string | null;
  /** Owner's Discord user ID (for fetching display name) */
  ownerDiscordId: string | null;
  /** Computed permissions for the requesting user */
  permissions: EntityPermissions;
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
  /** True if the requesting user created this config (truthful attribution) */
  isOwned: boolean;
  /** Computed permissions for the requesting user */
  permissions: EntityPermissions;
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
  /** True if results were truncated due to query limits */
  limitReached?: boolean;
}
