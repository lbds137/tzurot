/**
 * ReferencedMessageFormatter Mock Factory
 *
 * Provides a reusable mock for the ReferencedMessageFormatter class.
 */

import { vi } from 'vitest';

/**
 * Type definition for the ReferencedMessageFormatter mock instance
 */
interface MockReferencedMessageFormatterInstance {
  formatReferencedMessages: ReturnType<typeof vi.fn>;
  extractTextForSearch: ReturnType<typeof vi.fn>;
}

let mockInstance: MockReferencedMessageFormatterInstance | null = null;

/**
 * Create fresh mock functions with default implementations
 *
 * **Default Behaviors:**
 * - `formatReferencedMessages()` → Resolves to `'formatted references'`
 * - `extractTextForSearch()` → Returns `'reference text for search'`
 *
 * Override in tests: `getReferencedMessageFormatterMock().formatReferencedMessages.mockResolvedValue('custom')`
 */
function createMockFunctions(): MockReferencedMessageFormatterInstance {
  return {
    formatReferencedMessages: vi.fn().mockResolvedValue('formatted references'),
    extractTextForSearch: vi.fn().mockReturnValue('reference text for search'),
  };
}

/**
 * The mock module export - use this with vi.mock()
 */
export const mockReferencedMessageFormatter = {
  ReferencedMessageFormatter: class MockReferencedMessageFormatter {
    formatReferencedMessages: ReturnType<typeof vi.fn>;
    extractTextForSearch: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.formatReferencedMessages = fns.formatReferencedMessages;
      this.extractTextForSearch = fns.extractTextForSearch;
      mockInstance = this;
    }
  },
};

/**
 * Get the current mock instance
 */
export function getReferencedMessageFormatterMock(): MockReferencedMessageFormatterInstance {
  if (!mockInstance) {
    throw new Error(
      'ReferencedMessageFormatter mock not yet instantiated. Create the service first.'
    );
  }
  return mockInstance;
}

/**
 * Reset the mock instance
 */
export function resetReferencedMessageFormatterMock(): void {
  mockInstance = null;
}
