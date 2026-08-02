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
  buildSystemMessage: ReturnType<typeof vi.fn>;
  buildVolatilePrefix: ReturnType<typeof vi.fn>;
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
 * - `buildSystemMessage()` → Returns `{ message: SystemMessage('system prompt'), sections: [] }`
 * - `buildVolatilePrefix()` → Returns `'<context>volatile prefix</context>'`
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
    buildSystemMessage: vi.fn().mockReturnValue({
      message: new SystemMessage('system prompt'),
      sections: [],
    }),
    buildVolatilePrefix: vi.fn().mockReturnValue('<context>volatile prefix</context>'),
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
    buildSystemMessage: ReturnType<typeof vi.fn>;
    buildVolatilePrefix: ReturnType<typeof vi.fn>;
    buildHumanMessage: ReturnType<typeof vi.fn>;
    countTokens: ReturnType<typeof vi.fn>;
    countMemoryTokens: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.formatUserMessage = fns.formatUserMessage;
      this.buildSearchQuery = fns.buildSearchQuery;
      this.buildSystemMessage = fns.buildSystemMessage;
      this.buildVolatilePrefix = fns.buildVolatilePrefix;
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
