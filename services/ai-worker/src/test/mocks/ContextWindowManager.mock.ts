/**
 * ContextWindowManager Mock Factory
 *
 * Provides a reusable mock for the ContextWindowManager class.
 */

import { vi } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/**
 * Type definition for the ContextWindowManager mock instance
 */
interface MockContextWindowManagerInstance {
  buildContext: ReturnType<typeof vi.fn>;
  calculateHistoryBudget: ReturnType<typeof vi.fn>;
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
 * - `buildContext()` → Returns complete context with 8000 token budget, empty history
 * - `calculateHistoryBudget()` → Returns `7000` tokens
 * - `selectAndSerializeHistory()` → Returns serialized history with 1 message, 50 tokens
 * - `countHistoryTokens()` → Returns `100` tokens
 * - `calculateMemoryBudget()` → Returns `32000` tokens (25% of 128k)
 * - `selectMemoriesWithinBudget(memories)` → Returns ALL memories (no budget filtering by default)
 *
 * Override in tests: `getContextWindowManagerMock().calculateHistoryBudget.mockReturnValue(1000)`
 */
function createMockFunctions(): MockContextWindowManagerInstance {
  return {
    buildContext: vi.fn().mockReturnValue({
      systemPrompt: new SystemMessage('system prompt'),
      selectedHistory: [],
      currentMessage: new HumanMessage('current message'),
      budgetInfo: {
        totalBudget: 8000,
        systemPromptTokens: 500,
        memoriesTokens: 200,
        currentMessageTokens: 50,
        historyBudget: 7250,
        selectedHistoryTokens: 0,
      },
    }),
    calculateHistoryBudget: vi.fn().mockReturnValue(7000),
    selectAndSerializeHistory: vi.fn().mockReturnValue({
      serializedHistory: '<msg user="Lila" role="user">Previous message</msg>',
      historyTokensUsed: 50,
      messagesIncluded: 1,
      messagesDropped: 0,
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
    buildContext: ReturnType<typeof vi.fn>;
    calculateHistoryBudget: ReturnType<typeof vi.fn>;
    selectAndSerializeHistory: ReturnType<typeof vi.fn>;
    countHistoryTokens: ReturnType<typeof vi.fn>;
    calculateMemoryBudget: ReturnType<typeof vi.fn>;
    selectMemoriesWithinBudget: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.buildContext = fns.buildContext;
      this.calculateHistoryBudget = fns.calculateHistoryBudget;
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
