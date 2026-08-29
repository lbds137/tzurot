/**
 * LLMInvoker Mock Factory
 *
 * Provides a reusable mock for the LLMInvoker class.
 *
 * **Usage Pattern:**
 * ```typescript
 * import { vi } from 'vitest';
 * import { mockLLMInvoker, getLLMInvokerMock } from '../test/mocks/LLMInvoker.mock.js';
 *
 * // At top of test file (hoisted)
 * vi.mock('./LLMInvoker.js', () => mockLLMInvoker);
 *
 * // In tests
 * const mock = getLLMInvokerMock();
 * mock.invokeWithRetry.mockResolvedValue({ content: 'Custom response' });
 * ```
 */

import { vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatModelResult } from '../../services/modelFactory/types.js';

/**
 * Type definition for the LLMInvoker mock instance
 */
interface MockLLMInvokerInstance {
  getModel: ReturnType<typeof vi.fn>;
  invokeWithRetry: ReturnType<typeof vi.fn>;
}

// Singleton instance tracker - populated when mock class is instantiated
let mockInstance: MockLLMInvokerInstance | null = null;

/**
 * Create fresh mock functions with default implementations
 *
 * **Default Behaviors:**
 * - `getModel()` → Returns
 *   `{ model: { invoke: fn }, modelName: 'test-model', expectsRawResponse: true }`
 * - `invokeWithRetry()` → Resolves to `{ content: 'AI response' }`
 *
 * Override in tests: `getLLMInvokerMock().invokeWithRetry.mockResolvedValue({ content: 'Custom' })`
 */
function createMockFunctions(): MockLLMInvokerInstance {
  // Typed rather than a bare literal so a new required field on
  // ChatModelResult breaks this fixture at compile time instead of drifting
  // silently (02-code-standards § Testing Standards, "new fixtures should be
  // typed"). The `model` stub needs the cast because a real BaseChatModel has
  // ~65 members no mock reproduces; the cast is scoped to that one field so
  // every OTHER field stays compiler-checked, which is where the drift the
  // rule cares about actually happens.
  const modelResult: ChatModelResult = {
    model: {
      invoke: vi.fn().mockResolvedValue({ content: 'AI response' }),
    } as unknown as BaseChatModel,
    modelName: 'test-model',
    expectsRawResponse: true,
  };
  return {
    getModel: vi.fn().mockReturnValue(modelResult),
    invokeWithRetry: vi.fn().mockResolvedValue({
      content: 'AI response',
    }),
  };
}

/**
 * The mock module export - use this with vi.mock()
 */
export const mockLLMInvoker = {
  LLMInvoker: class MockLLMInvoker {
    getModel: ReturnType<typeof vi.fn>;
    invokeWithRetry: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.getModel = fns.getModel;
      this.invokeWithRetry = fns.invokeWithRetry;
      mockInstance = this;
    }
  },
};

/**
 * Get the current mock instance (after ConversationalRAGService is instantiated)
 *
 * @throws Error if accessed before the service creates the mock
 */
export function getLLMInvokerMock(): MockLLMInvokerInstance {
  if (!mockInstance) {
    throw new Error('LLMInvoker mock not yet instantiated. Create the service first.');
  }
  return mockInstance;
}

/**
 * Reset the mock instance (call in beforeEach if needed)
 */
export function resetLLMInvokerMock(): void {
  mockInstance = null;
}
