/**
 * Pure helpers split out of `ArchiveSummaryProcessor.ts` purely to stay
 * under the `max-lines` limit — no behavior change, no `this` dependency.
 */

import { createHash } from 'crypto';
import { SUMMARY_SOFT_CAP_TOKENS } from './constants.js';

/** Full 64-char sha256 hex — `duplicateDetection.ts`'s `contentHash` is NOT
 *  reused here: that one lowercases, trims, and truncates to 16 chars (a
 *  case-only edit would be invisible), while `memories.source_content_hash`
 *  is VarChar(64) and this idempotence check needs the exact content. */
export function hashContentFull(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Assemble the concrete regeneration feedback lines from the first pass's
 *  validation signals — only those that apply. */
export function buildRegenerationFeedback(
  firstTokens: number,
  firstPersonFirstPass: boolean,
  danglingFirstPass: string[]
): string[] {
  const feedback: string[] = [];
  if (firstTokens > SUMMARY_SOFT_CAP_TOKENS) {
    feedback.push('over the length cap');
  }
  if (firstPersonFirstPass) {
    feedback.push('contains a first-person pronoun');
  }
  if (danglingFirstPass.length > 0) {
    feedback.push(`names: ${danglingFirstPass.join(', ')}`);
  }
  return feedback;
}

/**
 * Per-job running total across every model call a job made (summarize,
 * referent checks, regenerate) — a job can make up to four calls, and the
 * per-job log line must report the SUM of tokens billed, not just the first
 * call's counts.
 */
export class CallTally {
  calls = 0;
  tokensIn = 0;
  tokensOut = 0;

  record(usage: { tokensIn: number; tokensOut: number }): void {
    this.calls += 1;
    this.tokensIn += usage.tokensIn;
    this.tokensOut += usage.tokensOut;
  }
}
