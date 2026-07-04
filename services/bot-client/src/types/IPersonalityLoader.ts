/**
 * Interface for services that can load personalities.
 * Implemented by PersonalityService and HttpPersonalityLoader.
 */

import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

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

  /**
   * Like {@link loadPersonality}, but distinguishes a genuine miss from a
   * gateway FAILURE: returns `null` ONLY when the personality genuinely does not
   * exist / access is denied, and THROWS `InfraError` (infra) /
   * `GatewayClientError` (non-404 4xx) on a failed load.
   *
   * Use from USER-FACING command/interaction paths so a transient blip surfaces
   * as "try again" rather than a false "not found". Routing / mention-parsing
   * paths keep using the lenient {@link loadPersonality}, which collapses every
   * failure to `null` ("treat unknown as no-match") and never throws.
   */
  loadPersonalityStrict(nameOrId: string, userId?: string): Promise<LoadedPersonality | null>;
}
