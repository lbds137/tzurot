/**
 * The archive summarizer's real model invoker.
 *
 * A factory rather than a bare function so the route the processor's gate
 * accepted is the route the call bills: `invokeSystemModel` would otherwise
 * re-resolve it, and `extractionProvider` is a live setting.
 */

import type { AIProvider } from '@tzurot/common-types/constants/ai';
import { invokeSystemModel, type SystemModelInvoker } from '../systemModel/systemModelCall.js';
import { ARCHIVE_SUMMARY_TIMEOUT_MS, ARCHIVE_SUMMARY_MAX_TOKENS } from './constants.js';

/** Build the real invoker: reasoning off, a per-call output cap, and the
 *  caller's already-resolved route. */
export function makeArchiveSummaryInvoker(route: {
  provider: AIProvider;
  apiKey?: string;
}): SystemModelInvoker {
  return prompt =>
    invokeSystemModel(prompt, {
      appTitleSuffix: 'ArchiveSummary',
      timeoutMs: ARCHIVE_SUMMARY_TIMEOUT_MS,
      thinking: 'off',
      maxTokens: ARCHIVE_SUMMARY_MAX_TOKENS,
      route,
    });
}
