/**
 * Pipeline-step prerequisite validation for GenerationStep.
 *
 * Extracted to keep GenerationStep.ts under the 400-line cap while
 * preserving the failure-mode messaging that downstream debugging relies on.
 */

import type { GenerationContext } from '../types.js';

/**
 * GenerationContext narrowed to the shape that's guaranteed after
 * `validatePrerequisites` succeeds — `config`, `auth`, and `preparedContext`
 * are all defined. The `asserts` annotation on the validator propagates
 * this narrowing transitively, so callers don't need redundant null checks
 * after invoking it.
 */
export type ReadyGenerationContext = GenerationContext & {
  config: NonNullable<GenerationContext['config']>;
  auth: NonNullable<GenerationContext['auth']>;
  preparedContext: NonNullable<GenerationContext['preparedContext']>;
};

/**
 * Validate that required pipeline steps have run. Asserts the narrowed
 * `ReadyGenerationContext` shape on success — TypeScript will treat the
 * argument as the narrower type for the remainder of the calling scope,
 * eliminating the need for redundant `if (!context.config) throw` guards
 * after the call.
 */
export function validatePrerequisites(
  context: GenerationContext
): asserts context is ReadyGenerationContext {
  if (!context.config) {
    throw new Error('[GenerationStep] ConfigStep must run before GenerationStep');
  }
  if (!context.auth) {
    throw new Error('[GenerationStep] AuthStep must run before GenerationStep');
  }
  if (!context.preparedContext) {
    throw new Error('[GenerationStep] ContextStep must run before GenerationStep');
  }
}
