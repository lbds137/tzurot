/**
 * Interface for services that can load personalities
 * Implemented by both PersonalityService and PersonalityIdCache
 */

import type { LoadedPersonality } from '@tzurot/common-types';

export interface IPersonalityLoader {
  /**
   * Load a personality by name, ID, slug, or alias
   *
   * Access Control:
   * When userId is provided, only returns personalities that are:
   * - Public (isPublic = true), OR
   * - Owned by the requesting user (ownerId = userId)
   *
   * @param nameOrId - Personality name, UUID, slug, or alias
   * @param userId - Discord user ID for access control (optional - omit for internal operations)
   * @returns LoadedPersonality or null if not found or access denied
   */
  loadPersonality(nameOrId: string, userId?: string): Promise<LoadedPersonality | null>;
}
