/**
 * Preset Command - API Client Functions
 *
 * Handles communication with the API gateway for preset operations.
 * Uses callGatewayApi for user endpoints and adminFetch for admin endpoints.
 */

import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { adminFetch, adminPutJson } from '../../utils/adminApiClient.js';
import type { PresetData } from './config.js';

/**
 * API response type for single preset endpoint
 */
interface PresetResponse {
  config: PresetData;
}

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
 * Note: Adds isOwned and permissions since admin endpoint doesn't include them
 * Admin can always edit global presets, so permissions are set accordingly
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
  // Admin endpoint doesn't include isOwned/permissions, add for dashboard compatibility
  // Admin always has full permissions on global presets
  return {
    ...data.config,
    isOwned: false,
    permissions: { canEdit: true, canDelete: true },
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
  return result.config;
}
