/**
 * MemoryRetriever Mock Factory
 *
 * Provides a reusable mock for the MemoryRetriever class.
 *
 * **Usage Pattern:**
 * ```typescript
 * import { vi } from 'vitest';
 * import { mockMemoryRetriever, getMemoryRetrieverMock } from '../test/mocks/MemoryRetriever.mock.js';
 *
 * vi.mock('./MemoryRetriever.js', () => mockMemoryRetriever);
 *
 * const mock = getMemoryRetrieverMock();
 * mock.retrieveRelevantMemories.mockResolvedValue({
 *   memories: [{ pageContent: 'memory', metadata: {} }],
 *   focusModeEnabled: false,
 * });
 * ```
 */

import { vi } from 'vitest';

/**
 * Type definition for the MemoryRetriever mock instance
 */
export interface MockMemoryRetrieverInstance {
  retrieveRelevantMemories: ReturnType<typeof vi.fn>;
  getAllParticipantPersonas: ReturnType<typeof vi.fn>;
  resolvePersonaForMemory: ReturnType<typeof vi.fn>;
  getUserPersonaForPersonality: ReturnType<typeof vi.fn>;
}

let mockInstance: MockMemoryRetrieverInstance | null = null;

/**
 * Create fresh mock functions with default implementations
 *
 * **Default Behaviors:**
 * - `retrieveRelevantMemories()` → Resolves to `{ memories: [], focusModeEnabled: false }` (empty memories - tests can add via override)
 * - `getAllParticipantPersonas()` → Resolves to empty `Map()` (no participants)
 * - `resolvePersonaForMemory()` → Resolves to `{ personaId: 'persona-123', shareLtmAcrossPersonalities: false }`
 * - `getUserPersonaForPersonality()` → Same as resolvePersonaForMemory
 *
 * Override in tests: `getMemoryRetrieverMock().retrieveRelevantMemories.mockResolvedValue({ memories: [...], focusModeEnabled: false })`
 */
function createMockFunctions(): MockMemoryRetrieverInstance {
  return {
    retrieveRelevantMemories: vi.fn().mockResolvedValue({ memories: [], focusModeEnabled: false }),
    getAllParticipantPersonas: vi.fn().mockResolvedValue(new Map()),
    resolvePersonaForMemory: vi.fn().mockResolvedValue({
      personaId: 'persona-123',
      shareLtmAcrossPersonalities: false,
    }),
    getUserPersonaForPersonality: vi.fn().mockResolvedValue({
      personaId: 'persona-123',
      shareLtmAcrossPersonalities: false,
    }),
  };
}

/**
 * The mock module export - use this with vi.mock()
 */
export const mockMemoryRetriever = {
  MemoryRetriever: class MockMemoryRetriever {
    retrieveRelevantMemories: ReturnType<typeof vi.fn>;
    getAllParticipantPersonas: ReturnType<typeof vi.fn>;
    resolvePersonaForMemory: ReturnType<typeof vi.fn>;
    getUserPersonaForPersonality: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.retrieveRelevantMemories = fns.retrieveRelevantMemories;
      this.getAllParticipantPersonas = fns.getAllParticipantPersonas;
      this.resolvePersonaForMemory = fns.resolvePersonaForMemory;
      this.getUserPersonaForPersonality = fns.getUserPersonaForPersonality;
      mockInstance = this;
    }
  },
};

/**
 * Get the current mock instance
 */
export function getMemoryRetrieverMock(): MockMemoryRetrieverInstance {
  if (!mockInstance) {
    throw new Error('MemoryRetriever mock not yet instantiated. Create the service first.');
  }
  return mockInstance;
}

/**
 * Reset the mock instance
 */
export function resetMemoryRetrieverMock(): void {
  mockInstance = null;
}
