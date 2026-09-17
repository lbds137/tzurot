/**
 * The recent-days digest's real model invoker.
 *
 * A factory rather than a bare function so the route the sweep's gate
 * accepted is the route the call bills: `invokeSystemModel` would otherwise
 * re-resolve it, and `extractionProvider` is a live setting. Same shape as
 * `makeArchiveSummaryInvoker.ts`.
 */

import type { AIProvider } from '@tzurot/common-types/constants/ai';
import { invokeSystemModel, type SystemModelInvoker } from '../systemModel/systemModelCall.js';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';

/** Build the real invoker: reasoning off, a per-call output cap, and the
 *  caller's already-resolved route. */
export function makeRecentDaysDigestInvoker(route: {
  provider: AIProvider;
  apiKey?: string;
}): SystemModelInvoker {
  return prompt =>
    invokeSystemModel(prompt, {
      appTitleSuffix: 'RecentDaysDigest',
      timeoutMs: RECENT_DAYS_DIGEST.TIMEOUT_MS,
      thinking: 'off',
      maxTokens: RECENT_DAYS_DIGEST.MAX_OUTPUT_TOKENS,
      route,
    });
}
