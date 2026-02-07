/**
 * LongTermMemoryService Mock Factory
 *
 * Provides a reusable mock for the LongTermMemoryService class.
 */

import { vi } from 'vitest';

/**
 * Type definition for the LongTermMemoryService mock instance
 */
interface MockLongTermMemoryServiceInstance {
  storeInteraction: ReturnType<typeof vi.fn>;
}

let mockInstance: MockLongTermMemoryServiceInstance | null = null;

/**
 * Create fresh mock functions with default implementations
 *
 * **Default Behaviors:**
 * - `storeInteraction()` → Resolves to `undefined` (success, no return value)
 *
 * Override to simulate failure: `getLongTermMemoryServiceMock().storeInteraction.mockRejectedValue(new Error('DB error'))`
 */
function createMockFunctions(): MockLongTermMemoryServiceInstance {
  return {
    storeInteraction: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * The mock module export - use this with vi.mock()
 */
export const mockLongTermMemoryService = {
  LongTermMemoryService: class MockLongTermMemoryService {
    storeInteraction: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.storeInteraction = fns.storeInteraction;
      mockInstance = this;
    }
  },
};

/**
 * Get the current mock instance
 */
export function getLongTermMemoryServiceMock(): MockLongTermMemoryServiceInstance {
  if (!mockInstance) {
    throw new Error('LongTermMemoryService mock not yet instantiated. Create the service first.');
  }
  return mockInstance;
}

/**
 * Reset the mock instance
 */
export function resetLongTermMemoryServiceMock(): void {
  mockInstance = null;
}
