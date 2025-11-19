/**
 * Interface for services that can load personalities
 * Implemented by both PersonalityService and PersonalityIdCache
 */

import type { LoadedPersonality } from '@tzurot/common-types';

export interface IPersonalityLoader {
  loadPersonality(nameOrId: string): Promise<LoadedPersonality | null>;
}
