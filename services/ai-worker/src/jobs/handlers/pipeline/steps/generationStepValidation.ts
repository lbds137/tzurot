/**
 * Pipeline-step prerequisite validation for GenerationStep.
 *
 * Extracted to keep GenerationStep.ts under the 400-line cap while
 * preserving the failure-mode messaging that downstream debugging relies on.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { GenerationContext } from '../types.js';
import {
  type FreeTierRequestQuota,
  FREE_TIER_QUOTA_ERROR_MESSAGE,
} from '../../../../services/FreeTierRequestQuota.js';

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

/**
 * Site 1 of the shared-free-key fair-share meter: a guest (no BYOK key) runs on
 * the SHARED system key, so the rolling-window cap applies. The owner is never
 * limited; a BYOK user (`isGuestMode` false) is metered instead on the
 * credit-exhausted fallback path inside `runWithQuotaFallback` (mutually
 * exclusive with this branch — no double-count). `requestId` is the
 * retry-stable idempotency member. Over-share throws the FREE_TIER_QUOTA
 * sentinel, which GenerationStep's catch turns into an in-character failure.
 * A missing quota (test fixtures) is a no-op; `tryConsume` itself fails open.
 *
 * A z.ai free-tier upgrade (`provider === 'zai-coding'`) bills the CODING-PLAN
 * pool, already charged at AuthStep admission — this OpenRouter meter skips it.
 * If that request later degrades onto the OpenRouter pool mid-turn, the
 * fallback runner's meter charges it there (its zai-guest-degrade branch).
 */
export async function enforceGuestFreeTierQuota(
  freeTierQuota: FreeTierRequestQuota | undefined,
  isGuestMode: boolean,
  userId: string,
  requestId: string,
  effectiveProvider?: AIProvider
): Promise<void> {
  if (effectiveProvider === AIProvider.ZaiCoding) {
    return;
  }
  if (isGuestMode && freeTierQuota !== undefined && !isBotOwner(userId)) {
    const verdict = await freeTierQuota.tryConsume(userId, requestId);
    if (!verdict.allowed) {
      throw new Error(FREE_TIER_QUOTA_ERROR_MESSAGE);
    }
  }
}
