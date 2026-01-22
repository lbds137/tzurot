/**
 * Preset Types
 *
 * Shared type definitions for preset dashboard and sections.
 * Extracted to avoid circular dependencies between config.ts and presetSections.ts.
 */

import type { EntityPermissions } from '@tzurot/common-types';

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
 * Index signature allows usage with generic Record<string, unknown> types
 */
export interface FlattenedPresetData {
  [key: string]: string | boolean;
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
}
