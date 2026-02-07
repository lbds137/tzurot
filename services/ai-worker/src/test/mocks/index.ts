/**
 * AI Worker Test Mocks - Central Export
 *
 * This file provides a single import point for all test mocks and fixtures.
 *
 * **Usage:**
 * ```typescript
 * import { vi } from 'vitest';
 * import {
 *   // Mock modules for vi.mock()
 *   mockLLMInvoker,
 *   mockMemoryRetriever,
 *   mockPromptBuilder,
 *   mockContextWindowManager,
 *   mockLongTermMemoryService,
 *   mockReferencedMessageFormatter,
 *   mockMultimodalProcessor,
 *   mockResponseCleanup,
 *   mockPromptPlaceholders,
 *   mockErrorHandling,
 *
 *   // Instance accessors
 *   getLLMInvokerMock,
 *   getMemoryRetrieverMock,
 *   getPromptBuilderMock,
 *   getContextWindowManagerMock,
 *   getLongTermMemoryServiceMock,
 *   getReferencedMessageFormatterMock,
 *
 *   // Utility mock functions (direct access)
 *   mockProcessAttachments,
 *   mockReplacePromptPlaceholders,
 *
 *   // Fixtures
 *   createMockPersonality,
 *   createMockContext,
 *
 *   // Reset helpers
 *   resetAllMocks,
 * } from '../test/mocks/index.js';
 *
 * // Set up mocks (at top of file, before imports of tested module)
 * vi.mock('./LLMInvoker.js', () => mockLLMInvoker);
 * vi.mock('./MemoryRetriever.js', () => mockMemoryRetriever);
 * // ... etc
 * ```
 */

// Service mocks
export { getLLMInvokerMock } from './LLMInvoker.mock.js';

export { getMemoryRetrieverMock } from './MemoryRetriever.mock.js';

export { getPromptBuilderMock } from './PromptBuilder.mock.js';

export { getContextWindowManagerMock } from './ContextWindowManager.mock.js';

export { getLongTermMemoryServiceMock } from './LongTermMemoryService.mock.js';

export { getReferencedMessageFormatterMock } from './ReferencedMessageFormatter.mock.js';

export { getUserReferenceResolverMock } from './UserReferenceResolver.mock.js';

// Utility function mocks
export { mockProcessAttachments, mockReplacePromptPlaceholders } from './utils.mock.js';

// Fixtures
export * from './fixtures/index.js';

// Import reset functions for the combined reset helper
import { resetLLMInvokerMock } from './LLMInvoker.mock.js';
import { resetMemoryRetrieverMock } from './MemoryRetriever.mock.js';
import { resetPromptBuilderMock } from './PromptBuilder.mock.js';
import { resetContextWindowManagerMock } from './ContextWindowManager.mock.js';
import { resetLongTermMemoryServiceMock } from './LongTermMemoryService.mock.js';
import { resetReferencedMessageFormatterMock } from './ReferencedMessageFormatter.mock.js';
import { resetUserReferenceResolverMock } from './UserReferenceResolver.mock.js';
import { resetUtilityMocks } from './utils.mock.js';

/**
 * Reset all mock instances and utility mocks
 *
 * Call this in beforeEach when you need fresh mock state
 */
export function resetAllMocks(): void {
  resetLLMInvokerMock();
  resetMemoryRetrieverMock();
  resetPromptBuilderMock();
  resetContextWindowManagerMock();
  resetLongTermMemoryServiceMock();
  resetReferencedMessageFormatterMock();
  resetUserReferenceResolverMock();
  resetUtilityMocks();
}
