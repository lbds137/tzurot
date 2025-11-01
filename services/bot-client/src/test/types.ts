/**
 * Test Utility Types
 *
 * These utility types make testing with complex external dependencies easier
 * while maintaining as much type safety as possible.
 */

/**
 * Mockable<T> - Makes all properties writable and optional
 *
 * **Problem:** Discord.js has extensive readonly properties that break mock creation.
 * **Solution:** This utility type removes readonly modifiers and makes everything optional.
 *
 * **Usage:**
 * ```typescript
 * const mockMember: Mockable<GuildMember> = {
 *   id: '12345',
 *   displayName: 'Test User',
 * };
 * // TypeScript gives you autocomplete and catches typos!
 *
 * const member = mockMember as GuildMember;
 * // Safe type assertion after validation
 * ```
 *
 * **Why this works:**
 * 1. You get type safety while building the mock (autocomplete, typo detection)
 * 2. TypeScript validates your mock against the real type structure
 * 3. The final `as T` assertion is controlled and understood
 * 4. Much better than `as unknown as` which bypasses all checking
 *
 * **Credit:** Recommended by Gemini after evaluating vitest-mock-extended limitations
 */
export type Mockable<T> = {
  -readonly [P in keyof T]?: T[P];
};

/**
 * Utility to get all keys of T whose values are NOT functions
 */
type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends Function ? never : K;
}[keyof T];

/**
 * Utility to get all keys of T whose values ARE functions
 */
type FunctionKeys<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

/**
 * MockData<T> - Type for override parameters in mock factories
 *
 * **Problem:** When passing override objects like `{ id: 'foo' }`, Object.prototype methods
 * like `toString(): string` clash with Discord.js's specialized method signatures like
 * `toString(): \`<#${string}>\``.
 *
 * **Solution:** Split type T into data properties and method properties, making both optional.
 * This prevents Object.prototype methods from causing type conflicts.
 *
 * **Usage:**
 * ```typescript
 * export function createMockTextChannel(overrides: MockData<TextChannel> = {}): TextChannel {
 *   // overrides can be data properties, methods, or both
 *   // No conflicts with Object.prototype!
 * }
 * ```
 *
 * **Credit:** Recommended by Gemini to solve Object.prototype method conflicts
 */
export type MockData<T> = Partial<Pick<T, NonFunctionKeys<T>>> & Partial<Pick<T, FunctionKeys<T>>>;
