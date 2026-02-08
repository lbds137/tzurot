/**
 * Mock Context Fixtures
 *
 * Factory functions for creating ConversationContext test data.
 * These are pure data factories - no vi.fn() or mocking involved.
 */

import type { ConversationContext } from '../../../services/ConversationalRAGTypes.js';

/**
 * Create a mock ConversationContext with sensible defaults
 *
 * @example
 * ```typescript
 * const context = createMockContext();
 * const withAttachments = createMockContext({
 *   attachments: [{ url: '...', contentType: 'image/png', name: 'img.png', size: 1024 }]
 * });
 * ```
 */
export function createMockContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    userId: 'user-123',
    channelId: 'channel-456',
    serverId: 'server-789',
    userName: 'TestUser',
    ...overrides,
  };
}
