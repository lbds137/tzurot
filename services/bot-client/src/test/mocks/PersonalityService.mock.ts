/**
 * Mock PersonalityService for testing
 *
 * Provides a test double for PersonalityService that avoids database calls
 */

import { vi } from 'vitest';
import type { PersonalityService } from '@tzurot/common-types';

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
export function createMockPersonalityService(
  personalities: MockPersonality[]
): PersonalityService {
  const personalityMap = new Map(
    personalities.map((p) => [p.name.toLowerCase(), p])
  );

  // Create a properly typed mock service
  // TypeScript will enforce that all PersonalityService methods are implemented
  const mockService: PersonalityService = {
    loadPersonality: vi.fn().mockImplementation(async (name: string) => {
      const personality = personalityMap.get(name.toLowerCase());
      if (!personality) {
        return null;
      }

      // Return a minimal mock personality object
      // In real code this would be a full Personality from the database
      return {
        id: 'mock-id',
        name: personality.name,
        displayName: personality.displayName,
        systemPrompt: { content: personality.systemPrompt },
        avatarUrl: personality.avatarUrl ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any; // Minimal type assertion for partial mock data
    }),

    // Add other PersonalityService methods as needed for tests
    getAllPersonalities: vi.fn().mockResolvedValue(personalities as any[]),
  };

  return mockService; // No type assertion needed - TypeScript verifies the interface!
}
