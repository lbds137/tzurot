/**
 * Preset Types
 *
 * Shared type definitions for preset dashboard and sections.
 * Extracted to avoid circular dependencies between config.ts and presetSections.ts.
 */

import type { AdvancedParams } from '@tzurot/common-types/schemas/llmAdvancedParams';
import type { EntityPermissions } from '@tzurot/common-types/utils/permissions';
import type { BrowseContext } from '../../utils/dashboard/types.js';

/**
 * Preset data structure returned by API
 * Includes all LLM configuration params from advancedParameters
 */
export interface PresetData {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  isGlobal: boolean;
  isDefault?: boolean;
  isFreeDefault?: boolean;
  isOwned: boolean;
  /** Server-computed permissions for the requesting user */
  permissions: EntityPermissions;
  /** Context window token budget (model-coupled, stays in LlmConfig) */
  contextWindowTokens: number;
  /** Model's full context window (from OpenRouter), undefined if unknown */
  modelContextLength?: number;
  /** Model-derived cap for contextWindowTokens (computeContextCap), undefined if unknown */
  contextWindowCap?: number;
  /**
   * True when the model is a z.ai-only coding-plan model (absent from OpenRouter)
   * AND the viewing user has no active z.ai-coding key — the preset can't run for
   * them without one. Drives the "requires z.ai key" dashboard badge.
   */
  requiresZaiKey?: boolean;
  /** Advanced parameters, exactly the AdvancedParamsSchema shape */
  params: AdvancedParams;
}

/**
 * Flattened preset data for modal editing
 * Converts nested params to flat string values for Discord modals
 * Index signature uses `unknown` for Record<string, unknown> compatibility
 * while preserving strict types for known properties.
 */
export interface FlattenedPresetData {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  isGlobal: boolean;
  isOwned: boolean;
  canEdit: boolean;
  canDelete: boolean;
  // Sampling params
  temperature: string;
  top_p: string;
  top_k: string;
  max_tokens: string;
  seed: string;
  // Penalty params
  frequency_penalty: string;
  presence_penalty: string;
  repetition_penalty: string;
  min_p: string;
  top_a: string;
  // Thinking param (canonical level; empty string = provider default)
  thinking: string;
  /**
   * Stored params the form cannot represent (e.g. logit_bias, transforms,
   * verbosity), carried unchanged through an edit so the gateway's wholesale
   * replace does not drop them. Populated from the API detail's `params`;
   * absent on synthetic flat data with no params payload.
   */
  nonFormParams?: AdvancedParams;
  // Context window (model-coupled, stays in LlmConfig)
  contextWindowTokens: string;
  /** Model's full context window (display-only, not editable) */
  modelContextLength?: number;
  /** Model-derived cap for contextWindowTokens (display-only, not editable) */
  contextWindowCap?: number;
  /** True when the model needs a z.ai-coding key the viewer lacks (display-only) */
  requiresZaiKey?: boolean;
  /** Browse context when opened from browse (for back navigation) */
  browseContext?: BrowseContext;
}
