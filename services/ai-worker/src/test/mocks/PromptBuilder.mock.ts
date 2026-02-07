/**
 * PromptBuilder Mock Factory
 *
 * Provides a reusable mock for the PromptBuilder class.
 */

import { vi } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

/**
 * Type definition for the PromptBuilder mock instance
 */
interface MockPromptBuilderInstance {
  formatUserMessage: ReturnType<typeof vi.fn>;
  buildSearchQuery: ReturnType<typeof vi.fn>;
  buildFullSystemPrompt: ReturnType<typeof vi.fn>;
  buildHumanMessage: ReturnType<typeof vi.fn>;
  countTokens: ReturnType<typeof vi.fn>;
  countMemoryTokens: ReturnType<typeof vi.fn>;
}

let mockInstance: MockPromptBuilderInstance | null = null;

/**
 * Create fresh mock functions with default implementations
 *
 * **Default Behaviors:**
 * - `formatUserMessage()` → Returns `'formatted user message'`
 * - `buildSearchQuery()` → Returns `'search query'`
 * - `buildFullSystemPrompt()` → Returns `SystemMessage('system prompt')`
 * - `buildHumanMessage()` → Returns `{ message: HumanMessage, contentForStorage: string }`
 * - `countTokens()` → Returns `100` tokens
 * - `countMemoryTokens()` → Returns `50` tokens
 *
 * Override in tests: `getPromptBuilderMock().countTokens.mockReturnValue(500)`
 */
function createMockFunctions(): MockPromptBuilderInstance {
  return {
    formatUserMessage: vi.fn().mockReturnValue('formatted user message'),
    buildSearchQuery: vi.fn().mockReturnValue('search query'),
    buildFullSystemPrompt: vi.fn().mockReturnValue(new SystemMessage('system prompt')),
    buildHumanMessage: vi.fn().mockReturnValue({
      message: new HumanMessage('human message'),
      contentForStorage: 'content for storage',
    }),
    countTokens: vi.fn().mockReturnValue(100),
    countMemoryTokens: vi.fn().mockReturnValue(50),
  };
}

/**
 * The mock module export - use this with vi.mock()
 */
export const mockPromptBuilder = {
  PromptBuilder: class MockPromptBuilder {
    formatUserMessage: ReturnType<typeof vi.fn>;
    buildSearchQuery: ReturnType<typeof vi.fn>;
    buildFullSystemPrompt: ReturnType<typeof vi.fn>;
    buildHumanMessage: ReturnType<typeof vi.fn>;
    countTokens: ReturnType<typeof vi.fn>;
    countMemoryTokens: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.formatUserMessage = fns.formatUserMessage;
      this.buildSearchQuery = fns.buildSearchQuery;
      this.buildFullSystemPrompt = fns.buildFullSystemPrompt;
      this.buildHumanMessage = fns.buildHumanMessage;
      this.countTokens = fns.countTokens;
      this.countMemoryTokens = fns.countMemoryTokens;
      mockInstance = this;
    }
  },
};

/**
 * Get the current mock instance
 */
export function getPromptBuilderMock(): MockPromptBuilderInstance {
  if (!mockInstance) {
    throw new Error('PromptBuilder mock not yet instantiated. Create the service first.');
  }
  return mockInstance;
}

/**
 * Reset the mock instance
 */
export function resetPromptBuilderMock(): void {
  mockInstance = null;
}
