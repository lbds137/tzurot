/**
 * Mock Personality Fixtures
 *
 * Factory functions for creating LoadedPersonality test data.
 * These are pure data factories - no vi.fn() or mocking involved.
 */

import type { LoadedPersonality } from '@tzurot/common-types';

/**
 * Create a mock LoadedPersonality with sensible defaults
 *
 * @example
 * ```typescript
 * const personality = createMockPersonality();
 * const custom = createMockPersonality({ name: 'CustomBot', temperature: 0.9 });
 * ```
 */
export function createMockPersonality(overrides?: Partial<LoadedPersonality>): LoadedPersonality {
  return {
    id: 'personality-123',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    systemPrompt: 'You are a helpful test bot.',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 8192,
    characterInfo: 'A friendly test bot',
    personalityTraits: 'Helpful, kind, knowledgeable',
    ...overrides,
  } as LoadedPersonality;
}
