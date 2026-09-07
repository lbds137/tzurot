/**
 * Memory-archive summarizer: the per-call model round (invoke, log usage,
 * parse, and the content-guarded failure write on a parse miss) plus the
 * single regeneration pass built on top of it.
 *
 * Split out of ArchiveSummaryProcessor.ts to keep both modules under the
 * max-lines limit — no behavior change.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { extractJsonPayload } from '../extraction/extractionPrompt.js';
import type { SystemModelInvoker, SystemModelResult } from '../systemModel/systemModelCall.js';
import {
  buildRegeneratePrompt,
  buildReferentCheckPrompt,
  summaryResponseSchema,
  referentCheckResponseSchema,
  type SummarizerMessageInput,
} from './archiveSummaryPrompt.js';
import { writeArchiveSummaryFailure } from './archiveSummaryStore.js';
import { buildRegenerationFeedback, type CallTally } from './archiveSummaryFeedback.js';
import { writeArchiveSummaryUsageLog } from './archiveSummaryUsageLog.js';
import { ARCHIVE_SUMMARY_PROMPT_VERSION } from './constants.js';

const logger = createLogger('ArchiveSummaryProcessor');

/** The loaded row's fields the model round needs: identity for the write
 *  guard, the content each guarded write matches on, and the persona owner
 *  the usage row is attributed to. */
export interface SummaryRowRef {
  id: string;
  content: string;
  personalityId: string;
  ownerId: string | null;
}

/** One summarizer-family call + usage row + parse. Returns null on a parse
 *  failure, having already written the billed failure against the row's
 *  current content hash — or `'superseded'` when that guarded write
 *  matched no row because a concurrent content edit landed first. */
export async function callAndParse(ctx: {
  prisma: PrismaClient;
  invoke: SystemModelInvoker;
  prompt: string;
  row: SummaryRowRef;
  hash: string;
  tally: CallTally;
}): Promise<{ summary: string; usage: SystemModelResult } | 'superseded' | null> {
  const { prisma, invoke, prompt, row, hash, tally } = ctx;
  const start = Date.now();
  const usage = await invoke(prompt);
  tally.record(usage);
  const latencyMs = Date.now() - start;
  // @spec MEM-ARCH-023
  await writeArchiveSummaryUsageLog(prisma, usage, row, latencyMs);

  let payload: unknown;
  try {
    payload = JSON.parse(extractJsonPayload(usage.content));
  } catch {
    payload = undefined;
  }
  const parsed = payload === undefined ? undefined : summaryResponseSchema.safeParse(payload);
  if (parsed?.success !== true) {
    const affected = await writeArchiveSummaryFailure(prisma, {
      memoryId: row.id,
      expectedContent: row.content,
      sourceContentHash: hash,
      errorClass: 'parse_failure',
      promptVersion: ARCHIVE_SUMMARY_PROMPT_VERSION,
    });
    return affected === 0 ? 'superseded' : null;
  }
  return { summary: parsed.data.summary, usage };
}

/** Referent check for a candidate summary — degrades to an empty list on any
 *  failure: the call itself (timeout, rate limit) as well as its own parse
 *  failure, so a transient referent-check outage reads as "no dangling
 *  referents". The warn log is the only trace, and amendment 3's dangling
 *  rate is measured against checks that actually ran. */
export async function checkReferent(ctx: {
  prisma: PrismaClient;
  invoke: SystemModelInvoker;
  input: SummarizerMessageInput;
  summary: string;
  row: SummaryRowRef;
  tally: CallTally;
}): Promise<string[]> {
  const { prisma, invoke, input, summary, row, tally } = ctx;
  const start = Date.now();
  let usage: SystemModelResult;
  try {
    usage = await invoke(buildReferentCheckPrompt(input, summary));
  } catch (error) {
    logger.warn(
      { err: error, memoryId: row.id },
      'Referent check call failed — treating as no dangling referents'
    );
    return [];
  }
  tally.record(usage);
  const latencyMs = Date.now() - start;
  await writeArchiveSummaryUsageLog(prisma, usage, row, latencyMs);

  try {
    const payload: unknown = JSON.parse(extractJsonPayload(usage.content));
    const parsed = referentCheckResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.dangling;
  } catch {
    return [];
  }
}

/** The single regeneration pass: one regenerate call, plus a post-regen
 *  referent check when the row carries referenced content. Returns null
 *  when the regenerate call's response failed to parse (the caller returns
 *  the `parse_failure` outcome exactly as it would inline), or
 *  `'superseded'` when a concurrent content edit meant the billed-failure
 *  write matched no row. */
export async function runRegeneration(ctx: {
  prisma: PrismaClient;
  invoke: SystemModelInvoker;
  input: SummarizerMessageInput;
  row: SummaryRowRef;
  hash: string;
  firstSummary: string;
  firstTokens: number;
  firstPersonFirstPass: boolean;
  danglingFirstPass: string[];
  tally: CallTally;
}): Promise<
  | {
      finalSummary: string;
      finalTokens: number;
      danglingAfterRegen: string[];
    }
  | 'superseded'
  | null
> {
  const {
    prisma,
    invoke,
    input,
    row,
    hash,
    firstSummary,
    firstTokens,
    firstPersonFirstPass,
    danglingFirstPass,
    tally,
  } = ctx;
  const feedback = buildRegenerationFeedback(firstTokens, firstPersonFirstPass, danglingFirstPass);

  const regen = await callAndParse({
    prisma,
    invoke,
    prompt: buildRegeneratePrompt(input, firstSummary, feedback),
    row,
    hash,
    tally,
  });
  if (regen === 'superseded' || regen === null) {
    return regen;
  }

  const finalSummary = regen.summary;
  const finalTokens = countTextTokens(finalSummary);
  let danglingAfterRegen: string[] = [];
  if (input.referenced !== null) {
    danglingAfterRegen = await checkReferent({
      prisma,
      invoke,
      input,
      summary: finalSummary,
      row,
      tally,
    });
  }
  return { finalSummary, finalTokens, danglingAfterRegen };
}
