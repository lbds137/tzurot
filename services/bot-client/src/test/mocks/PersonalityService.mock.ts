/**
 * Mock personality loader for testing
 *
 * Provides a test double for the personality-loading dependency (an
 * `IPersonalityLoader` — the interface consumers like `findPersonalityMentions`
 * actually accept) that avoids any gateway/database calls. bot-client never
 * touches the Prisma-backed `PersonalityService`, so the mock is typed to the
 * interface, not the concrete class.
 */

import { vi } from 'vitest';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { IPersonalityLoader } from '../../types/IPersonalityLoader.js';

interface MockPersonality {
  name: string;
  displayName: string;
  systemPrompt: string;
  avatarUrl?: string | null;
}

/**
 * Create a mock personality loader with predefined personalities.
 *
 * @param personalities - List of personalities the mock should "know about"
 * @returns Type-safe IPersonalityLoader mock that returns these personalities
 *
 * @example
 * ```typescript
 * const loader = createMockPersonalityService([
 *   { name: 'Lilith', displayName: 'Lilith', systemPrompt: '...' },
 *   { name: 'Bambi Prime', displayName: 'Bambi Prime', systemPrompt: '...' },
 * ]);
 *
 * const result = await loader.loadPersonality('Lilith');
 * // Returns the mock personality object
 * ```
 */
export function createMockPersonalityService(personalities: MockPersonality[]): IPersonalityLoader {
  const personalityMap = new Map(personalities.map(p => [p.name.toLowerCase(), p]));

  // The mock implements only loadPersonality — the single method
  // IPersonalityLoader (and its consumers, e.g. findPersonalityMentions) need —
  // so the object satisfies the interface directly, no cast required.
  return {
    loadPersonality: vi.fn().mockImplementation((name: string) => {
      const personality = personalityMap.get(name.toLowerCase());
      if (!personality) {
        return Promise.resolve(null);
      }

      // Return a minimal mock personality object.
      // In real code this would be a full LoadedPersonality from the gateway.
      return Promise.resolve({
        id: `mock-id-${personality.name.toLowerCase()}`,
        name: personality.name,
        displayName: personality.displayName,
        systemPrompt: personality.systemPrompt,
        avatarUrl: personality.avatarUrl ?? null,
        slug: personality.name.toLowerCase(),
        model: 'mock-model',
        temperature: 0.8,
        maxTokens: 1000,
        contextWindowTokens: 131072,
        characterInfo: '',
        personalityTraits: '',
        voiceEnabled: false,
      } as unknown as LoadedPersonality);
    }),
  };
}
