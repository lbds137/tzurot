/**
 * Preset Command - API Client Functions
 *
 * Handles communication with the API gateway for preset operations.
 * Uses callGatewayApi for user endpoints and adminFetch for admin endpoints.
 */

import type { EnvConfig } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { adminFetch, adminPutJson } from '../../utils/adminApiClient.js';
import type { PresetData, PresetResponse } from './types.js';

/**
 * Fetch a preset by ID (user endpoint)
 */
export async function fetchPreset(presetId: string, userId: string): Promise<PresetData | null> {
  const result = await callGatewayApi<PresetResponse>(`/user/llm-config/${presetId}`, {
    userId,
  });

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch preset: ${result.status}`);
  }

  return result.data.config;
}

/**
 * Fetch a global preset by ID (admin endpoint)
 *
 * IMPORTANT: This function is ONLY callable by bot owners because:
 * 1. It uses adminFetch which requires admin credentials
 * 2. The /preset global edit command is restricted to bot owners via isBotOwner check
 *
 * Therefore, we can safely hardcode full permissions - only admins reach this code path.
 * The admin endpoint doesn't return permissions (it assumes admin access), so we add them
 * for dashboard compatibility.
 */
export async function fetchGlobalPreset(presetId: string): Promise<PresetData | null> {
  const response = await adminFetch(`/admin/llm-config/${presetId}`);

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch global preset: ${response.status}`);
  }

  const data = (await response.json()) as PresetResponse;
  // Admin endpoint doesn't include isOwned/permissions - add for dashboard compatibility
  // Safe to hardcode: this function is only reachable by bot owners (see JSDoc above)
  return {
    ...data.config,
    isOwned: true, // Admin owns global presets
    permissions: { canEdit: true, canDelete: true }, // Admin always has full permissions
  };
}

/**
 * Update a preset (user endpoint)
 */
export async function updatePreset(
  presetId: string,
  data: Record<string, unknown>,
  userId: string
): Promise<PresetData> {
  const result = await callGatewayApi<PresetResponse>(`/user/llm-config/${presetId}`, {
    method: 'PUT',
    userId,
    body: data,
  });

  if (!result.ok) {
    throw new Error(`Failed to update preset: ${result.status} - ${result.error ?? 'Unknown'}`);
  }

  return result.data.config;
}

/**
 * Update a global preset (admin endpoint)
 *
 * IMPORTANT: Like fetchGlobalPreset, this function is ONLY callable by bot owners.
 * The admin endpoint doesn't return permissions, so we add them for dashboard compatibility.
 */
export async function updateGlobalPreset(
  presetId: string,
  data: Record<string, unknown>
): Promise<PresetData> {
  const response = await adminPutJson(`/admin/llm-config/${presetId}`, data);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update global preset: ${response.status} - ${text}`);
  }

  const result = (await response.json()) as PresetResponse;
  // Admin endpoint doesn't include isOwned/permissions - add for dashboard compatibility
  // Safe to hardcode: this function is only reachable by bot owners (see JSDoc above)
  return {
    ...result.config,
    isOwned: true, // Admin owns global presets
    permissions: { canEdit: true, canDelete: true }, // Admin always has full permissions
  };
}

/**
 * Create a new preset (user endpoint)
 */
export async function createPreset(
  data: {
    name: string;
    model: string;
    provider?: string;
    description?: string;
    visionModel?: string;
    maxReferencedMessages?: number;
  },
  userId: string,
  _config: EnvConfig
): Promise<PresetData> {
  const result = await callGatewayApi<PresetResponse>('/user/llm-config', {
    method: 'POST',
    userId,
    body: data,
  });

  if (!result.ok) {
    throw new Error(`Failed to create preset: ${result.status} - ${result.error ?? 'Unknown'}`);
  }

  return result.data.config;
}
