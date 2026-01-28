/**
 * Entity Permissions Utilities
 *
 * Centralized permission computation for API responses.
 * All permission decisions are made server-side and returned as part of the DTO.
 *
 * This pattern ensures:
 * - Bot-client doesn't need local permission logic
 * - Adding new roles (e.g., moderators) only requires backend changes
 * - `isOwned` is truthful (did I create this?) vs permissions (can I edit this?)
 */

import { isBotOwner } from './ownerMiddleware.js';

/**
 * Standard permissions returned with entities
 * Used for personalities, LLM configs, personas, etc.
 */
export interface EntityPermissions {
  /** Whether the requesting user can edit this entity */
  canEdit: boolean;
  /** Whether the requesting user can delete this entity */
  canDelete: boolean;
}

/**
 * Compute permissions for a personality
 *
 * Rules:
 * - Creator can edit/delete their own personalities
 * - Bot owner (admin) can edit/delete any personality
 *
 * @param ownerId - The personality's owner internal user ID
 * @param requestingUserId - The requesting user's internal ID (null if not logged in)
 * @param discordUserId - The requesting user's Discord ID (for admin check)
 */
export function computePersonalityPermissions(
  ownerId: string,
  requestingUserId: string | null,
  discordUserId: string
): EntityPermissions {
  const isCreator = requestingUserId !== null && ownerId === requestingUserId;
  const isAdmin = isBotOwner(discordUserId);

  return {
    canEdit: isCreator || isAdmin,
    canDelete: isCreator || isAdmin,
  };
}

/**
 * Compute permissions for an LLM config (preset)
 *
 * Rules:
 * - Global configs: only admin can edit/delete
 * - User configs: only creator can edit/delete
 * - Admin can also edit/delete user configs (for cleanup)
 *
 * @param config - The config object with ownerId and isGlobal flags
 * @param requestingUserId - The requesting user's internal ID (null if not logged in)
 * @param discordUserId - The requesting user's Discord ID (for admin check)
 */
export function computeLlmConfigPermissions(
  config: { ownerId: string; isGlobal: boolean },
  requestingUserId: string | null,
  discordUserId: string
): EntityPermissions {
  const isCreator = requestingUserId !== null && config.ownerId === requestingUserId;
  const isAdmin = isBotOwner(discordUserId);

  // Global configs: only admin can edit/delete
  // User configs: creator or admin can edit/delete
  if (config.isGlobal) {
    return {
      canEdit: isAdmin,
      canDelete: isAdmin,
    };
  }

  return {
    canEdit: isCreator || isAdmin,
    canDelete: isCreator || isAdmin,
  };
}

/**
 * Compute permissions for a persona
 *
 * Rules:
 * - Creator can edit/delete their own personas
 * - Personas are always user-owned (no global personas currently)
 *
 * Note: Personas don't currently need admin override since they're
 * user-specific. This may change if we add shared/global personas.
 *
 * @param ownerId - The persona's owner internal user ID
 * @param requestingUserId - The requesting user's internal ID (null if not logged in)
 */
export function computePersonaPermissions(
  ownerId: string,
  requestingUserId: string | null
): EntityPermissions {
  const isCreator = requestingUserId !== null && ownerId === requestingUserId;

  return {
    canEdit: isCreator,
    canDelete: isCreator,
  };
}
