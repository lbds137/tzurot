/**
 * ContextWindowManager Mock Factory
 *
 * Provides a reusable mock for the ContextWindowManager class.
 */

import { vi } from 'vitest';

/**
 * Type definition for the ContextWindowManager mock instance
 */
interface MockContextWindowManagerInstance {
  selectAndSerializeHistory: ReturnType<typeof vi.fn>;
  countHistoryTokens: ReturnType<typeof vi.fn>;
  calculateMemoryBudget: ReturnType<typeof vi.fn>;
  selectMemoriesWithinBudget: ReturnType<typeof vi.fn>;
}

let mockInstance: MockContextWindowManagerInstance | null = null;

/**
 * Create fresh mock functions with default implementations
 *
 * **Default Behaviors:**
 * - `selectAndSerializeHistory()` → Returns serialized history with 1 message, 50 tokens
 * - `countHistoryTokens()` → Returns `100` tokens
 * - `calculateMemoryBudget()` → Returns `32000` tokens (25% of 128k)
 * - `selectMemoriesWithinBudget(memories)` → Returns ALL memories (no budget filtering by default)
 *
 */
function createMockFunctions(): MockContextWindowManagerInstance {
  return {
    selectAndSerializeHistory: vi.fn().mockReturnValue({
      serializedHistory: '<msg user="Lila" role="user">Previous message</msg>',
      historyTokensUsed: 50,
      messagesIncluded: 1,
      messagesDropped: 0,
      crossChannelMessagesIncluded: 0,
      selectedEntries: [],
    }),
    countHistoryTokens: vi.fn().mockReturnValue(100),
    calculateMemoryBudget: vi.fn().mockReturnValue(32000), // 25% of 128k
    selectMemoriesWithinBudget: vi.fn().mockImplementation((memories: unknown[]) => ({
      selectedMemories: memories, // Return all memories by default
      tokensUsed: 500,
      memoriesDropped: 0,
      droppedDueToSize: 0,
    })),
  };
}

/**
 * The mock module export - use this with vi.mock()
 */
export const mockContextWindowManager = {
  ContextWindowManager: class MockContextWindowManager {
    selectAndSerializeHistory: ReturnType<typeof vi.fn>;
    countHistoryTokens: ReturnType<typeof vi.fn>;
    calculateMemoryBudget: ReturnType<typeof vi.fn>;
    selectMemoriesWithinBudget: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.selectAndSerializeHistory = fns.selectAndSerializeHistory;
      this.countHistoryTokens = fns.countHistoryTokens;
      this.calculateMemoryBudget = fns.calculateMemoryBudget;
      this.selectMemoriesWithinBudget = fns.selectMemoriesWithinBudget;
      mockInstance = this;
    }
  },
};

/**
 * Get the current mock instance
 */
export function getContextWindowManagerMock(): MockContextWindowManagerInstance {
  if (!mockInstance) {
    throw new Error('ContextWindowManager mock not yet instantiated. Create the service first.');
  }
  return mockInstance;
}

/**
 * Reset the mock instance
 */
export function resetContextWindowManagerMock(): void {
  mockInstance = null;
}
