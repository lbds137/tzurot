/**
 * Mock PersonalityService for testing
 *
 * Provides a test double for PersonalityService that avoids database calls
 */

import { vi } from 'vitest';
import type { PersonalityService, LoadedPersonality } from '@tzurot/common-types';

interface MockPersonality {
  name: string;
  displayName: string;
  systemPrompt: string;
  avatarUrl?: string | null;
}

/**
 * Create a mock PersonalityService with predefined personalities
 *
 * @param personalities - List of personalities the mock should "know about"
 * @returns Type-safe mock PersonalityService that returns these personalities
 *
 * @example
 * ```typescript
 * const service = createMockPersonalityService([
 *   { name: 'Lilith', displayName: 'Lilith', systemPrompt: '...' },
 *   { name: 'Bambi Prime', displayName: 'Bambi Prime', systemPrompt: '...' },
 * ]);
 *
 * const result = await service.loadPersonality('Lilith');
 * // Returns the mock personality object
 * ```
 */
export function createMockPersonalityService(personalities: MockPersonality[]): PersonalityService {
  const personalityMap = new Map(personalities.map(p => [p.name.toLowerCase(), p]));

  // Create a mock that implements the PersonalityService interface methods we need
  // We use double type assertion (as unknown as PersonalityService) because this is a test mock
  // that only implements the methods we need, not the full class with all properties
  return {
    loadPersonality: vi.fn().mockImplementation((name: string) => {
      const personality = personalityMap.get(name.toLowerCase());
      if (!personality) {
        return Promise.resolve(null);
      }

      // Return a minimal mock personality object
      // In real code this would be a full LoadedPersonality from the database
      return Promise.resolve({
        id: 'mock-id',
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
      } as unknown as LoadedPersonality);
    }),

    // Add other PersonalityService methods as needed for tests
    loadAllPersonalities: vi
      .fn()
      .mockResolvedValue(personalities as unknown as LoadedPersonality[]),
  } as unknown as PersonalityService;
}
