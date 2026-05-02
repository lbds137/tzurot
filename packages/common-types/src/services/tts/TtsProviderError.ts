/**
 * TtsProviderError — typed error for TTS provider operations.
 *
 * Carries:
 *   - `category`: routes user-facing error messages (reuses the existing
 *     `ApiErrorCategory` taxonomy with `VOICE_NOT_FOUND` + `CLONING_FAILED`
 *     additions, rather than inventing a parallel TTS hierarchy).
 *   - `provider`: distinguishes "ElevenLabs rate limit" from "Mistral rate
 *     limit" in logs without parsing message strings (GLM's catch).
 *   - `isFallbackEligible`: per Kimi's catch — not all errors should
 *     trigger fallback. Without this, the dispatcher would burn credits
 *     trying the next provider on a 400 (text too long, content filtered)
 *     only to fail again with the same input.
 *
 * Eligibility table (see `docs/proposals/backlog/tts-engine-upgrade-phase-1-plan.md`
 * section 2):
 *
 *   | Category          | isFallbackEligible | Reason                                            |
 *   | ----------------- | ------------------ | ------------------------------------------------- |
 *   | RATE_LIMIT        | true               | Different provider has different quota            |
 *   | AUTHENTICATION    | true (skip)        | Different provider has different key              |
 *   | TIMEOUT           | true               | Network blip — try alternative                    |
 *   | SERVER_ERROR (5xx)| true               | Provider problem, not request problem             |
 *   | QUOTA_EXCEEDED    | true               | Different provider has different quota            |
 *   | VOICE_NOT_FOUND   | false              | Same slug missing in gateway = same fail anywhere |
 *   | CLONING_FAILED    | false (mostly)     | Likely malformed reference — same fail anywhere   |
 *   | BAD_REQUEST       | false              | Input-shape problem — fallback won't fix it       |
 */

import type { ApiErrorCategory } from '../../constants/error.js';
import type { TtsProviderId } from './TtsProvider.js';

export class TtsProviderError extends Error {
  /**
   * @param category - Reuses the existing `ApiErrorCategory` enum with
   *   `VOICE_NOT_FOUND` + `CLONING_FAILED` additions for TTS-specific cases.
   * @param provider - Which TTS provider raised the error.
   * @param isFallbackEligible - Whether the dispatcher should try the next
   *   provider in the fallback chain on this error. False for input-shape
   *   problems (BAD_REQUEST, VOICE_NOT_FOUND on a malformed reference) that
   *   would fail identically on any provider.
   * @param message - Human-readable error message.
   * @param cause - Wrapped underlying error (network error, provider response, etc.).
   */
  constructor(
    public readonly category: ApiErrorCategory,
    public readonly provider: TtsProviderId,
    public readonly isFallbackEligible: boolean,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TtsProviderError';
    // Restore the prototype chain for `instanceof` checks across the
    // ES2015-class transpilation boundary (ts-essentials pattern).
    Object.setPrototypeOf(this, TtsProviderError.prototype);
  }
}
