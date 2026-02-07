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
 * - `getModel()` → Returns `{ model: { invoke: fn }, modelName: 'test-model' }`
 * - `invokeWithRetry()` → Resolves to `{ content: 'AI response' }`
 *
 * Override in tests: `getLLMInvokerMock().invokeWithRetry.mockResolvedValue({ content: 'Custom' })`
 */
function createMockFunctions(): MockLLMInvokerInstance {
  return {
    getModel: vi.fn().mockReturnValue({
      model: {
        invoke: vi.fn().mockResolvedValue({ content: 'AI response' }),
      },
      modelName: 'test-model',
    }),
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
