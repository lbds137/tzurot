/**
 * Preset Command - API Client Functions
 *
 * Handles communication with the API gateway for preset operations.
 * User-scoped operations go through `userClient`; bot-owner global-preset
 * operations go through `ownerClient`.
 */

import { type LlmConfigDetail, type LlmConfigUpdateInput } from '@tzurot/common-types';
import { GatewayApiError, type OwnerClient, type UserClient } from '@tzurot/clients';
import type { PresetData } from './types.js';

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
 * Adapt a fetched LlmConfig detail payload to the dashboard's PresetData shape.
 *
 * `LlmConfigDetailSchema` now enumerates every field the dashboard reads
 * (`contextWindowTokens`, `params`, `modelContextLength`, `contextWindowCap`,
 * plus the ownership fields the gateway emits for both user and admin scopes),
 * so the typed response IS structurally a `PresetData` — no cast needed. Admin
 * and user responses share this shape: the gateway attaches `isOwned`/
 * `permissions` on both, so there's no longer a separate admin adapter.
 */
function toPresetData(config: LlmConfigDetail): PresetData {
  return config;
}

/**
 * Fetch a preset by ID (user endpoint)
 */
export async function fetchPreset(
  presetId: string,
  userClient: UserClient
): Promise<PresetData | null> {
  const result = await userClient.getUserLlmConfig(presetId);

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch preset: ${result.status}`);
  }

  return toPresetData(result.data.config);
}

/**
 * Fetch a global preset by ID (admin endpoint)
 *
 * Only reachable when the caller is a bot owner — the slash command is
 * gated upstream.
 */
export async function fetchGlobalPreset(
  presetId: string,
  ownerClient: OwnerClient
): Promise<PresetData | null> {
  const result = await ownerClient.getGlobalLlmConfig(presetId);

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch global preset: ${result.status}`);
  }

  return toPresetData(result.data.config);
}

/**
 * Update a preset (user endpoint)
 */
export async function updatePreset(
  presetId: string,
  data: LlmConfigUpdateInput,
  userClient: UserClient
): Promise<PresetData> {
  const result = await userClient.updateUserLlmConfig(presetId, data);

  if (!result.ok) {
    throw new Error(`Failed to update preset: ${result.status} - ${result.error ?? 'Unknown'}`);
  }

  return toPresetData(result.data.config);
}

/**
 * Update a global preset (admin endpoint)
 *
 * Only reachable when the caller is a bot owner.
 */
export async function updateGlobalPreset(
  presetId: string,
  data: LlmConfigUpdateInput,
  ownerClient: OwnerClient
): Promise<PresetData> {
  const result = await ownerClient.updateGlobalLlmConfig(presetId, data);

  if (!result.ok) {
    throw new Error(
      `Failed to update global preset: ${result.status} - ${result.error ?? 'Unknown'}`
    );
  }

  return toPresetData(result.data.config);
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
  userClient: UserClient
): Promise<PresetData> {
  const result = await userClient.createUserLlmConfig(data);

  if (!result.ok) {
    // Use GatewayApiError so retry/branching logic can match on `code`
    // (e.g. 'NAME_COLLISION') instead of regex-matching the message.
    throw new GatewayApiError(
      `Failed to create preset: ${result.status} - ${result.error ?? 'Unknown'}`,
      result.status,
      result.code
    );
  }

  return toPresetData(result.data.config);
}
