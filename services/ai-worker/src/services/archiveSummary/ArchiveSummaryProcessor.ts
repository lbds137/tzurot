/**
 * Memory-archive summarizer processor (slice B1, write side).
 *
 * One job = one memory row. Flow: load the row, check idempotence, run the
 * three delay gates (model switch, route, budget), split the stored
 * template, run the summarizer (with at most one regeneration pass and an
 * optional referent check), and write the result. Every model call writes
 * its own `usage_logs` row — including a call whose response failed to
 * parse — because a parse failure still spent tokens.
 *
 * Zero-spend throws (the invoker itself threw — timeout, 429, network) refund
 * the budget, write NOTHING to the row, and rethrow so BullMQ retries with
 * backoff; after the job's attempts are exhausted the row simply stays
 * `pending` for a later slice's stale-pending sweep, mirroring
 * `rosterBlurbSweep.ts`'s reasoning for not stamping a failure on a call that
 * never got a response. A throw AFTER a call already returned (e.g. one of
 * the raw-SQL row writers failing post-invoke) does NOT refund — that unit
 * was genuinely billed — and is warn-logged instead of silently swallowed.
 */

import { DelayedError } from 'bullmq';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { splitMemoryContent } from '@tzurot/common-types/utils/memoryContentSplit';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { replacePromptPlaceholders } from '../../utils/promptPlaceholders.js';
import {
  resolveSystemModelRoute,
  type SystemModelInvoker,
  type SystemModelResult,
} from '../systemModel/systemModelCall.js';
import { makeArchiveSummaryInvoker } from './makeArchiveSummaryInvoker.js';
import type { ArchiveSummaryBudget } from './ArchiveSummaryBudget.js';
import {
  ARCHIVE_SUMMARY_PROMPT_VERSION,
  SWITCH_OFF_DELAY_MS,
  BUDGET_DELAY_MS,
  SUMMARY_SOFT_CAP_TOKENS,
  SUMMARY_HARD_CAP_TOKENS,
  ROUTE_ERROR_LOG_INTERVAL_MS,
} from './constants.js';
import { buildSummarizerPrompt, type SummarizerMessageInput } from './archiveSummaryPrompt.js';
import { hasFirstPerson, decideLengthState } from './archiveSummaryValidation.js';
import {
  loadArchiveSummaryRow,
  writeArchiveSummarySuccess,
  writeArchiveSummaryFailure,
  writeArchiveSummaryNoTemplate,
} from './archiveSummaryStore.js';
import type { ArchiveSummaryJobData } from '@tzurot/common-types/types/jobs';
import { hashContentFull, CallTally } from './archiveSummaryFeedback.js';
import {
  callAndParse,
  checkReferent,
  runRegeneration,
  type SummaryRowRef,
} from './archiveSummaryRound.js';

const logger = createLogger('ArchiveSummaryProcessor');

/** Narrow structural handle over the BullMQ job — mirrors `BusyJobContext` in
 *  `factExtractionSetup.ts` so unit tests need no real BullMQ. */
export interface ArchiveSummaryJobHandle {
  id?: string;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export interface ArchiveSummaryOutcome {
  outcome: 'done' | 'failed' | 'dead' | 'skipped' | 'superseded';
}

export interface ArchiveSummaryDeps {
  prisma: PrismaClient;
  budget: ArchiveSummaryBudget;
  invokeModel?: SystemModelInvoker;
}

/** Throttled to at most once per hour per process: an OpenRouter route can
 *  never bill a summary (it cannot disable reasoning), so a misconfiguration
 *  is loud but not spammy — and a repeat misconfiguration later in the
 *  process's life is still surfaced rather than latched silent forever. */
let lastRouteErrorAt = 0;

/** Test-only: clears the route-error log throttle so a suite can pin both
 *  the throttled and the past-the-window branches. */
export function __resetRouteErrorThrottleForTests(): void {
  lastRouteErrorAt = 0;
}

export class ArchiveSummaryProcessor {
  constructor(private readonly deps: ArchiveSummaryDeps) {}

  async process(
    job: ArchiveSummaryJobHandle,
    token: string | undefined,
    data: ArchiveSummaryJobData
  ): Promise<ArchiveSummaryOutcome> {
    const { prisma } = this.deps;
    const row = await loadArchiveSummaryRow(prisma, data.memoryId);
    if (row === null) {
      logger.info({ memoryId: data.memoryId }, 'Archive-summary row not found — skipping');
      return { outcome: 'skipped' };
    }

    const hash = hashContentFull(row.content);
    const isCurrent =
      hash === row.sourceContentHash && row.summaryPromptVersion === ARCHIVE_SUMMARY_PROMPT_VERSION;
    if (isCurrent && (row.summaryStatus === 'done' || row.summaryStatus === 'dead')) {
      return { outcome: 'skipped' };
    }

    // @spec MEM-ARCH-014
    if (getSystemSetting('archiveSummaryModelEnabled') === false) {
      await this.delay(job, token, SWITCH_OFF_DELAY_MS);
    }
    const route = resolveSystemModelRoute();
    if (route.provider !== AIProvider.ZaiCoding) {
      const now = Date.now();
      if (now - lastRouteErrorAt >= ROUTE_ERROR_LOG_INTERVAL_MS) {
        // An OpenRouter route is not a valid summarizer route (it cannot
        // disable reasoning) and must never be billed for a summary.
        logger.error(
          { provider: route.provider },
          'Archive-summary route is not zai-coding — delaying until reconfigured'
        );
        lastRouteErrorAt = now;
      }
      await this.delay(job, token, SWITCH_OFF_DELAY_MS);
    }

    // The split is a zero-spend terminal check, so it runs before the budget
    // is charged; the two delay gates above still precede it because a `dead`
    // write must not happen while the summarizer is switched off or misrouted.
    // @spec MEM-ARCH-015
    const split = splitMemoryContent(row.content);
    if (split === null) {
      const affected = await writeArchiveSummaryNoTemplate(prisma, {
        memoryId: row.id,
        expectedContent: row.content,
        sourceContentHash: hash,
        promptVersion: ARCHIVE_SUMMARY_PROMPT_VERSION,
      });
      if (affected === 0) {
        logger.info(
          { memoryId: row.id },
          'Archive-summary row changed under the job — leaving the edit path to re-enqueue'
        );
        return { outcome: 'superseded' };
      }
      return { outcome: 'dead' };
    }

    const charge = await this.deps.budget.tryConsume();
    if (!charge.allowed) {
      // The denied attempt spent nothing, so the unit is returned via the
      // closure over the SAME day key this call charged — otherwise each
      // hourly retry re-charges and a retry past UTC midnight eats the next
      // day's cap.
      await charge.refund();
      await this.delay(job, token, BUDGET_DELAY_MS);
    }

    const subjectName = row.personaName ?? 'the user';
    const displayName = row.personalityName;
    const input: SummarizerMessageInput = {
      displayName,
      subjectName,
      userText: replacePromptPlaceholders(split.user, subjectName, displayName),
      assistantText: replacePromptPlaceholders(split.assistant, subjectName, displayName),
      referenced:
        split.referenced === null
          ? null
          : replacePromptPlaceholders(split.referenced, subjectName, displayName),
    };

    const tally = new CallTally();
    try {
      return await this.runSummarization({ row, hash, input, reason: data.reason, route, tally });
    } catch (error) {
      await this.handleSummarizationThrow({ row, tally, charge, error });
      throw error;
    }
  }

  /** Refund-or-warn decision for a throw out of `runSummarization`. Split out
   *  of `process` purely to stay under the per-function complexity limit —
   *  no behavior change. */
  private async handleSummarizationThrow(ctx: {
    row: SummaryRowRef;
    tally: CallTally;
    charge: { refund(): Promise<void> };
    error: unknown;
  }): Promise<void> {
    const { row, tally, charge, error } = ctx;
    if (tally.calls === 0) {
      // Genuinely zero-spend: no invoker call ever returned (`CallTally`
      // records only after `invoke()` resolves), so nothing was billed.
      // Refund the one unit this row consumed — via the closure over the
      // SAME key this call charged — and write NOTHING to the row; BullMQ
      // retries with backoff, and after the job's attempts are exhausted
      // the row simply stays `pending` for a later slice's stale-pending
      // sweep.
      await charge.refund();
      return;
    }
    // A call already returned and was billed before this throw (a raw-SQL
    // write failing after the model round is the shape that gets here), so
    // refunding would hand back a unit that was genuinely spent. The retry
    // re-charges, which is the correct direction for a soft daily cap.
    logger.warn(
      { memoryId: row.id, calls: tally.calls, err: error },
      'Archive-summary job threw after a billed call — no refund; BullMQ retries'
    );
  }

  private async delay(
    job: ArchiveSummaryJobHandle,
    token: string | undefined,
    delayMs: number
  ): Promise<never> {
    await job.moveToDelayed(Date.now() + delayMs, token);
    throw new DelayedError();
  }

  /** The model round: first pass, optional regeneration, final verdict + write. */
  private async runSummarization(ctx: {
    row: SummaryRowRef;
    hash: string;
    input: SummarizerMessageInput;
    reason: ArchiveSummaryJobData['reason'];
    route: { provider: AIProvider; apiKey?: string };
    tally: CallTally;
  }): Promise<ArchiveSummaryOutcome> {
    const invoke = this.deps.invokeModel ?? makeArchiveSummaryInvoker(ctx.route);
    const { row, hash, input, reason, tally } = ctx;
    const hadReferenced = input.referenced !== null;
    const logOutcome = (
      outcome: ArchiveSummaryOutcome['outcome'],
      extra: Record<string, unknown>
    ): ArchiveSummaryOutcome => {
      logger.info(
        {
          memoryId: row.id,
          personalityId: row.personalityId,
          reason,
          promptVersion: ARCHIVE_SUMMARY_PROMPT_VERSION,
          calls: tally.calls,
          tokensIn: tally.tokensIn,
          tokensOut: tally.tokensOut,
          hadReferenced,
          outcome,
          ...extra,
        },
        'Archive-summary job complete'
      );
      return { outcome };
    };

    const first = await callAndParse({
      prisma: this.deps.prisma,
      invoke,
      prompt: buildSummarizerPrompt(input),
      row,
      hash,
      tally,
    });
    if (first === 'superseded') {
      return logOutcome('superseded', {});
    }
    if (first === null) {
      return logOutcome('failed', { errorClass: 'parse_failure' });
    }

    const firstTokens = countTextTokens(first.summary);
    const firstPersonFirstPass = hasFirstPerson(first.summary);
    let danglingFirstPass: string[] = [];
    if (input.referenced !== null) {
      danglingFirstPass = await checkReferent({
        prisma: this.deps.prisma,
        invoke,
        input,
        summary: first.summary,
        row,
        tally,
      });
    }

    const resolved = await this.resolveFinalSummary({
      invoke,
      input,
      row,
      hash,
      tally,
      first,
      firstTokens,
      firstPersonFirstPass,
      danglingFirstPass,
      logOutcome,
    });
    if ('outcome' in resolved) {
      return resolved.outcome;
    }
    const { finalSummary, finalTokens, regenerated, danglingAfterRegen } = resolved;

    const commonExtra = {
      model: first.usage.model,
      provider: first.usage.provider,
      lengthState: decideLengthState({ firstTokens, finalTokens, regenerated }),
      finalTokens,
      danglingFirstPass: danglingFirstPass.length,
      danglingAfterRegen: danglingAfterRegen.length,
      firstPersonFirstPass,
      regenerated,
    };

    return this.writeFinalOutcome({
      row,
      hash,
      finalSummary,
      finalTokens,
      finalFirstPerson: hasFirstPerson(finalSummary),
      model: first.usage.model,
      commonExtra,
      logOutcome,
    });
  }

  /** Decide whether a regeneration pass is needed and run it, folding its
   *  outcome into either an early `ArchiveSummaryOutcome` (superseded/failed)
   *  or the final-text fields `writeFinalOutcome` needs. Split out of
   *  `runSummarization` purely to stay under the per-function line limit —
   *  no behavior change. */
  private async resolveFinalSummary(ctx: {
    invoke: SystemModelInvoker;
    input: SummarizerMessageInput;
    row: SummaryRowRef;
    hash: string;
    tally: CallTally;
    first: { summary: string; usage: SystemModelResult };
    firstTokens: number;
    firstPersonFirstPass: boolean;
    danglingFirstPass: string[];
    logOutcome: (
      outcome: ArchiveSummaryOutcome['outcome'],
      extra: Record<string, unknown>
    ) => ArchiveSummaryOutcome;
  }): Promise<
    | { outcome: ArchiveSummaryOutcome }
    | {
        finalSummary: string;
        finalTokens: number;
        regenerated: boolean;
        danglingAfterRegen: string[];
      }
  > {
    const {
      invoke,
      input,
      row,
      hash,
      tally,
      first,
      firstTokens,
      firstPersonFirstPass,
      danglingFirstPass,
      logOutcome,
    } = ctx;
    const needsRegen =
      firstTokens > SUMMARY_SOFT_CAP_TOKENS || firstPersonFirstPass || danglingFirstPass.length > 0;
    if (!needsRegen) {
      return {
        finalSummary: first.summary,
        finalTokens: firstTokens,
        regenerated: false,
        danglingAfterRegen: [],
      };
    }

    const regenResult = await runRegeneration({
      prisma: this.deps.prisma,
      invoke,
      input,
      row,
      hash,
      firstSummary: first.summary,
      firstTokens,
      firstPersonFirstPass,
      danglingFirstPass,
      tally,
    });
    if (regenResult === 'superseded') {
      return { outcome: logOutcome('superseded', { regenerated: true }) };
    }
    if (regenResult === null) {
      return { outcome: logOutcome('failed', { errorClass: 'parse_failure', regenerated: true }) };
    }
    return {
      finalSummary: regenResult.finalSummary,
      finalTokens: regenResult.finalTokens,
      regenerated: true,
      danglingAfterRegen: regenResult.danglingAfterRegen,
    };
  }

  /** The final verdict on the FINAL text: a hard-cap or first-person failure
   *  is billed and written; otherwise the summary is stored as done. Either
   *  write is content-guarded, so a concurrent content edit resolves to
   *  `superseded` rather than resurrecting a summary of stale content. Split
   *  out of `runSummarization` purely to stay under the per-function line
   *  limit — no behavior change. */
  private async writeFinalOutcome(ctx: {
    row: SummaryRowRef;
    hash: string;
    finalSummary: string;
    finalTokens: number;
    finalFirstPerson: boolean;
    model: string;
    commonExtra: Record<string, unknown>;
    logOutcome: (
      outcome: ArchiveSummaryOutcome['outcome'],
      extra: Record<string, unknown>
    ) => ArchiveSummaryOutcome;
  }): Promise<ArchiveSummaryOutcome> {
    const {
      row,
      hash,
      finalSummary,
      finalTokens,
      finalFirstPerson,
      model,
      commonExtra,
      logOutcome,
    } = ctx;

    const errorClass =
      finalTokens > SUMMARY_HARD_CAP_TOKENS ? 'overflow' : finalFirstPerson ? 'first_person' : null;
    // @spec MEM-ARCH-016
    const affected =
      errorClass !== null
        ? await writeArchiveSummaryFailure(this.deps.prisma, {
            memoryId: row.id,
            expectedContent: row.content,
            sourceContentHash: hash,
            errorClass,
            promptVersion: ARCHIVE_SUMMARY_PROMPT_VERSION,
          })
        : await writeArchiveSummarySuccess(this.deps.prisma, {
            memoryId: row.id,
            expectedContent: row.content,
            summary: finalSummary,
            model,
            promptVersion: ARCHIVE_SUMMARY_PROMPT_VERSION,
            sourceContentHash: hash,
          });
    if (affected === 0) {
      return logOutcome('superseded', { ...commonExtra, errorClass });
    }
    return logOutcome(errorClass === null ? 'done' : 'failed', { ...commonExtra, errorClass });
  }
}
