/**
 * Roster-blurb generation: one card in, one third-person blurb out.
 *
 * Fail-to-skip, matching fact extraction's posture: a malformed or
 * schema-violating response yields `null` and NOTHING is written, so a bad
 * generation leaves the previous blurb (or no blurb) in place rather than
 * storing garbage into every sibling character's prompt. The caller decides
 * what to do with `null`; it must not invent a fallback blurb.
 *
 * The token counts come back with the blurb because the caller writes the
 * `usage_logs` row, and it must write one whether or not the response parsed —
 * a parse failure still spent the tokens.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { extractJsonPayload } from '../extraction/extractionPrompt.js';
import {
  invokeSystemModel,
  type SystemModelInvoker,
  type SystemModelResult,
} from '../systemModel/systemModelCall.js';
import type { RosterBlurbCard } from '@tzurot/common-types/utils/rosterBlurbCard';
import { buildRosterBlurbPrompt, rosterBlurbResponseSchema } from './rosterBlurbPrompt.js';

const logger = createLogger('RosterBlurbGenerator');

/**
 * Deadline for one summarization call.
 *
 * Far tighter than extraction's 180s: that budget covers a batch of episodes
 * with a numbered supersession context, while this is a single short card
 * producing at most a paragraph. A summary that has not arrived in 60s is not
 * going to arrive usefully, and the sweep has other characters to get to.
 */
const ROSTER_BLURB_TIMEOUT_MS = 60_000;

/** One generation attempt: the blurb if it parsed, plus what the call cost. */
export interface RosterBlurbGeneration {
  /** The generated blurb, or `null` when the response failed to parse. */
  blurb: string | null;
  /** Token counts + billed provider — the caller's usage row needs these
   *  regardless of whether the blurb parsed. */
  usage: SystemModelResult;
}

/** The real summarizer call — extraction's route and model, this job's deadline. */
export function invokeRosterBlurbModel(prompt: string): Promise<SystemModelResult> {
  return invokeSystemModel(prompt, {
    appTitleSuffix: 'RosterBlurb',
    timeoutMs: ROSTER_BLURB_TIMEOUT_MS,
  });
}

/**
 * Generate one character's roster blurb.
 *
 * @param card the summarizer's input fields — the SAME object the staleness
 *   checksum is taken over, so a blurb can never be stored against a hash of
 *   different content.
 * @param invokeModel injectable model seam (tests, eval harness).
 */
export async function generateRosterBlurb(
  card: RosterBlurbCard,
  invokeModel: SystemModelInvoker = invokeRosterBlurbModel
): Promise<RosterBlurbGeneration> {
  const usage = await invokeModel(buildRosterBlurbPrompt(card));

  let payload: unknown;
  try {
    payload = JSON.parse(extractJsonPayload(usage.content));
  } catch (error) {
    logger.warn({ err: error }, 'Roster blurb response was not JSON — skipping');
    return { blurb: null, usage };
  }

  const parsed = rosterBlurbResponseSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues },
      'Roster blurb response failed the schema — skipping'
    );
    return { blurb: null, usage };
  }

  return { blurb: parsed.data.blurb, usage };
}
