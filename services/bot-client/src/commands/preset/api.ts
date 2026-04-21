/**
 * Preset Command - API Client Functions
 *
 * Handles communication with the API gateway for preset operations.
 * Uses callGatewayApi for user endpoints and adminFetch for admin endpoints.
 */

import {
  callGatewayApi,
  GatewayApiError,
  type GatewayUser,
} from '../../utils/userGatewayClient.js';
import { adminFetch, adminPutJson } from '../../utils/adminApiClient.js';
import type { PresetData, PresetResponse } from './types.js';

/** Conservative limit — leaves room for the "❌ " prefix and Discord's 2000-char cap */
const MAX_DISCORD_CONTENT = 1800;

/**
 * Extract user-facing error message from API errors.
 *
 * API errors follow the format "Failed to X preset: HTTP_STATUS - api_message".
 * This extracts the api_message portion for display. Returns null for network
 * errors or unexpected formats, signaling callers to use a generic fallback.
 * Truncates to Discord's content limit to avoid silent send failures.
 */
export function extractApiErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = /: \d{3} - (.+)$/.exec(error.message);
  if (match?.[1] === undefined) {
    return null;
  }
  const msg = match[1];
  return msg.length > MAX_DISCORD_CONTENT ? msg.slice(0, MAX_DISCORD_CONTENT) + '…' : msg;
}

/**
 * Fetch a preset by ID (user endpoint)
 */
export async function fetchPreset(presetId: string, user: GatewayUser): Promise<PresetData | null> {
  const result = await callGatewayApi<PresetResponse>(
    `/user/llm-config/${encodeURIComponent(presetId)}`,
    {
      user,
    }
  );

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
  user: GatewayUser
): Promise<PresetData> {
  const result = await callGatewayApi<PresetResponse>(
    `/user/llm-config/${encodeURIComponent(presetId)}`,
    {
      method: 'PUT',
      user,
      body: data,
    }
  );

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
    // Read body once, then try parsing as JSON (structured API error).
    // Falls back to raw text. Avoids surfacing garbled HTML from gateway errors.
    let detail: string;
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text) as { message?: string; error?: string };
        detail = json.message ?? json.error ?? 'Unknown';
      } catch {
        detail = text;
      }
    } catch {
      detail = 'Unknown';
    }
    throw new Error(`Failed to update global preset: ${response.status} - ${detail}`);
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
    /**
     * When true, server bumps the `(Copy N)` suffix on name collision
     * instead of returning NAME_COLLISION. Used by the clone flow so a
     * single HTTP call handles any number of existing copies.
     */
    autoSuffixOnCollision?: boolean;
  },
  user: GatewayUser
): Promise<PresetData> {
  const result = await callGatewayApi<PresetResponse>('/user/llm-config', {
    method: 'POST',
    user,
    body: data,
  });

  if (!result.ok) {
    // Use GatewayApiError so retry/branching logic can match on `code`
    // (e.g. 'NAME_COLLISION') instead of regex-matching the message.
    throw new GatewayApiError(
      `Failed to create preset: ${result.status} - ${result.error ?? 'Unknown'}`,
      result.status,
      result.code
    );
  }

  return result.data.config;
}
