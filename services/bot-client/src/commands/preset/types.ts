/**
 * Preset Types
 *
 * Shared type definitions for preset dashboard and sections.
 * Extracted to avoid circular dependencies between config.ts and presetSections.ts.
 */

import type { EntityPermissions } from '@tzurot/common-types';
import type { BrowseContext } from '../../utils/dashboard/types.js';

/**
 * API response wrapper for single preset endpoint
 * Used by GET /user/llm-config/:id
 */
export interface PresetResponse {
  config: PresetData;
}

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
  visionModel: string | null;
  isGlobal: boolean;
  isDefault?: boolean;
  isFreeDefault?: boolean;
  isOwned: boolean;
  /** Server-computed permissions for the requesting user */
  permissions: EntityPermissions;
  maxReferencedMessages: number;
  /** Memory retrieval score threshold (0.0-1.0) */
  memoryScoreThreshold: number | null;
  /** Maximum number of memories to retrieve */
  memoryLimit: number | null;
  /** Context window token budget */
  contextWindowTokens: number;
  // Context settings - control how much history to fetch
  /** Max messages to fetch from conversation history (1-100) */
  maxMessages: number;
  /** Max age in seconds for messages (null = no time limit) */
  maxAge: number | null;
  /** Max images to process from extended context (0-20, 0 disables) */
  maxImages: number;
  params: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    seed?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    min_p?: number;
    top_a?: number;
    reasoning?: {
      effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
      max_tokens?: number;
      exclude?: boolean;
      enabled?: boolean;
    };
    /** Whether to display thinking blocks to users */
    show_thinking?: boolean;
  };
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
  visionModel: string;
  isGlobal: boolean;
  isOwned: boolean;
  canEdit: boolean;
  maxReferencedMessages: string;
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
  // Reasoning params
  reasoning_effort: string;
  reasoning_max_tokens: string;
  reasoning_exclude: string;
  reasoning_enabled: string;
  // Output params
  show_thinking: string;
  // Context settings
  maxMessages: string;
  maxAge: string;
  maxImages: string;
  /** Browse context when opened from browse (for back navigation) */
  browseContext?: BrowseContext;
}
