/**
 * UserReferenceResolver Mock Factory
 *
 * Provides a reusable mock for the UserReferenceResolver class.
 *
 * **Usage Pattern:**
 * ```typescript
 * import { vi } from 'vitest';
 * import { mockUserReferenceResolver, getUserReferenceResolverMock } from '../test/mocks/UserReferenceResolver.mock.js';
 *
 * vi.mock('./UserReferenceResolver.js', () => mockUserReferenceResolver);
 *
 * const mock = getUserReferenceResolverMock();
 * mock.resolveUserReferences.mockResolvedValue({ processedText: 'resolved', resolvedPersonas: [] });
 * ```
 */

import { vi } from 'vitest';

/**
 * Type definition for the UserReferenceResolver mock instance
 */
export interface MockUserReferenceResolverInstance {
  resolveUserReferences: ReturnType<typeof vi.fn>;
  resolvePersonalityReferences: ReturnType<typeof vi.fn>;
}

let mockInstance: MockUserReferenceResolverInstance | null = null;

/**
 * Create fresh mock functions with default implementations
 *
 * **Default Behaviors:**
 * - `resolveUserReferences()` → Returns input text unchanged with empty resolvedPersonas
 * - `resolvePersonalityReferences()` → Returns personality unchanged with empty resolvedPersonas
 *
 * Override in tests: `getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({...})`
 */
function createMockFunctions(): MockUserReferenceResolverInstance {
  return {
    resolveUserReferences: vi.fn().mockImplementation((text: string) =>
      Promise.resolve({
        processedText: text,
        resolvedPersonas: [],
      })
    ),
    resolvePersonalityReferences: vi.fn().mockImplementation((personality: unknown) =>
      Promise.resolve({
        resolvedPersonality: personality,
        resolvedPersonas: [],
      })
    ),
  };
}

/**
 * The mock module export - use this with vi.mock()
 */
export const mockUserReferenceResolver = {
  UserReferenceResolver: class MockUserReferenceResolver {
    resolveUserReferences: ReturnType<typeof vi.fn>;
    resolvePersonalityReferences: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.resolveUserReferences = fns.resolveUserReferences;
      this.resolvePersonalityReferences = fns.resolvePersonalityReferences;
      mockInstance = this;
    }
  },
};

/**
 * Get the current mock instance
 */
export function getUserReferenceResolverMock(): MockUserReferenceResolverInstance {
  if (!mockInstance) {
    throw new Error('UserReferenceResolver mock not yet instantiated. Create the service first.');
  }
  return mockInstance;
}

/**
 * Reset the mock instance
 */
export function resetUserReferenceResolverMock(): void {
  mockInstance = null;
}
