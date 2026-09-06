/**
 * Top-level stage orchestration for `pnpm ops memory:render-pilot`. Each
 * stage writes `reports/render-pilot/<slug>/stage-<name>.json` and reads the
 * prior stage's file; `--stage all` runs every stage whose output is absent,
 * `--stage <name>` reruns exactly that stage. See
 * `docs/proposals/backlog/memory-archive-format.md` D0 for the design.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { getPrismaForEnv } from './prisma-env.js';
import { buildCorpus, type CorpusResult } from './render-pilot-corpus.js';
import { requireApiKey } from './render-pilot-llm.js';
import type { RenderPilotProvider } from './render-pilot-provider.js';
import { buildSummarizerUserMessage, buildQuestionUserMessage } from './render-pilot-prompts.js';
import { renderArmNotes } from './render-pilot-archive.js';
import { runSummariesStage, runQuestionsStage } from './render-pilot-stage-summarize.js';
import { runAnswersStage, runJudgeStage } from './render-pilot-stage-answer.js';
import { runVoiceStage, runReportStage } from './render-pilot-stage-voice.js';
import { buildReportJson, type ReportJson, type ReportBuildInput } from './render-pilot-metrics.js';
import { buildReportMarkdown } from './render-pilot-report-markdown.js';
import {
  STAGE_ORDER,
  stagePath,
  readStageFile,
  writeStageFile,
  shouldRunStage,
  selectWindowRows,
  type RenderPilotOptions,
  type RenderPilotStage,
  type SlugContext,
} from './render-pilot-shared.js';

export type { RenderPilotOptions, RenderPilotStage } from './render-pilot-shared.js';

const ANSWER_ARMS_COUNT = 3;

async function runStageByName(
  stage: Exclude<RenderPilotStage, 'all' | 'corpus'>,
  ctx: SlugContext,
  options: RenderPilotOptions,
  corpus: CorpusResult
): Promise<void> {
  if (stage === 'summaries') {
    await runSummariesStage(ctx, options, corpus);
  } else if (stage === 'questions') {
    await runQuestionsStage(ctx, options, corpus);
  } else if (stage === 'answers') {
    await runAnswersStage(ctx, options, corpus);
  } else if (stage === 'judge') {
    await runJudgeStage(ctx, options, corpus);
  } else if (stage === 'voice') {
    await runVoiceStage(ctx, options, corpus);
  } else {
    await runReportStage(ctx, corpus);
  }
}

export interface StageCallEstimate {
  stage: 'summaries' | 'questions' | 'answers' | 'judge' | 'voice';
  calls: number;
  inputTokens: number;
}

/**
 * Project per-stage call counts and INPUT token totals from the corpus alone
 * — no model calls. Output tokens are never estimated (the model hasn't run).
 * Answer/voice input tokens are measured over the actually-rendered arm-V
 * archive window as a stand-in for all three arms (F/S render shorter, so
 * this is a conservative upper bound, not an average).
 */
export function estimateDryRunPlan(
  corpus: CorpusResult,
  options: RenderPilotOptions
): StageCallEstimate[] {
  const rows = corpus.rows;
  const rowCount = rows.length;

  const summariesTokens = rows.reduce(
    (sum, row) =>
      sum +
      countTextTokens(
        buildSummarizerUserMessage({
          displayName: corpus.personality.displayName,
          subjectName: row.subjectName,
          userText: row.split.user,
          assistantText: row.split.assistant,
          referenced: row.split.referenced,
        })
      ),
    0
  );

  const questionsTokens = rows.reduce(
    (sum, row) =>
      sum +
      countTextTokens(
        buildQuestionUserMessage({
          displayName: corpus.personality.displayName,
          subjectName: row.subjectName,
          userText: row.split.user,
          assistantText: row.split.assistant,
          referenced: row.split.referenced,
          questionsPerRow: options.questionsPerRow,
        })
      ),
    0
  );

  const answerCallsPerRow = options.questionsPerRow * ANSWER_ARMS_COUNT;
  const answerCalls = rowCount * answerCallsPerRow;
  const sortedRows = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const answerWindowTokens = sortedRows.reduce((sum, _row, index) => {
    const windowRows = selectWindowRows(sortedRows, index, options.window);
    return sum + countTextTokens(renderArmNotes('V', corpus, new Map(), windowRows).xml);
  }, 0);
  const answerInputTokens = answerWindowTokens * answerCallsPerRow;

  // Judge stage: one call per answer (i.e. per question per render arm),
  // plus one per-row summary judge and one per-row facts judge — each
  // carries roughly the verbatim episode's tokens.
  const verbatimTokensTotal = rows.reduce(
    (sum, row) => sum + countTextTokens(row.split.user + row.split.assistant),
    0
  );
  const judgeCalls = answerCalls + rowCount + rowCount;
  const judgeInputTokens = verbatimTokensTotal * (options.questionsPerRow * ANSWER_ARMS_COUNT + 2);

  const voiceCalls = options.triggers.length * ANSWER_ARMS_COUNT;
  const latestWindow = sortedRows.slice(-options.voiceWindow);
  const voiceArchiveTokens = countTextTokens(
    renderArmNotes('V', corpus, new Map(), latestWindow).xml
  );
  const voiceInputTokens = voiceArchiveTokens * voiceCalls;

  return [
    { stage: 'summaries', calls: rowCount, inputTokens: summariesTokens },
    { stage: 'questions', calls: rowCount, inputTokens: questionsTokens },
    { stage: 'answers', calls: answerCalls, inputTokens: answerInputTokens },
    { stage: 'judge', calls: judgeCalls, inputTokens: judgeInputTokens },
    { stage: 'voice', calls: voiceCalls, inputTokens: voiceInputTokens },
  ];
}

function printDryRunEstimate(
  slug: string,
  corpus: CorpusResult,
  options: RenderPilotOptions
): void {
  console.log(
    `[${slug}] dry-run per-stage estimate (INPUT tokens only — output tokens are never estimated, no model calls made):`
  );
  for (const estimate of estimateDryRunPlan(corpus, options)) {
    console.log(
      `  ${estimate.stage}: ${String(estimate.calls)} calls, ~${String(estimate.inputTokens)} input tokens`
    );
  }
}

async function runSlug(
  ctx: SlugContext,
  options: RenderPilotOptions,
  prisma: Awaited<ReturnType<typeof getPrismaForEnv>>['prisma']
): Promise<void> {
  const corpusPath = stagePath(ctx.outDir, ctx.slug, 'corpus');
  let corpus = readStageFile<CorpusResult>(corpusPath);
  if (corpus === null || shouldRunStage(options, 'corpus', corpusPath)) {
    corpus = await buildCorpus(prisma, {
      slug: ctx.slug,
      largest: options.largest,
      latest: options.latest,
    });
    writeStageFile(corpusPath, corpus);
    console.log(
      `[${ctx.slug}] corpus: ${String(corpus.stats.rows)} rows, ${String(corpus.stats.unparseable)} unparseable`
    );
  }

  if (options.dryRun) {
    printDryRunEstimate(ctx.slug, corpus, options);
    return;
  }
  if (options.stage === 'corpus') {
    return;
  }

  for (const stage of STAGE_ORDER) {
    if (stage === 'corpus') {
      continue;
    }
    await runStageByName(stage, ctx, options, corpus);
    if (options.stage !== 'all' && options.stage === stage) {
      return;
    }
  }
}

/** Sum each stage's failure count across every character's `callFailures` map. */
function sumCallFailures(inputs: ReportBuildInput[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const input of inputs) {
    for (const [stage, count] of Object.entries(input.callFailures)) {
      totals[stage] = (totals[stage] ?? 0) + count;
    }
  }
  return totals;
}

/**
 * Concatenate every character's raw records into one pooled `ReportBuildInput`
 * — NEVER average the per-character rates, which would weight a 5-row
 * character equally with a 40-row one.
 */
export function poolReportInputs(inputs: ReportBuildInput[]): ReportBuildInput {
  return {
    characterName: 'pooled',
    answers: inputs.flatMap(i => i.answers),
    summaries: inputs.flatMap(i => i.summaries),
    summaryJudgements: inputs.flatMap(i => i.summaryJudgements),
    facts: inputs.flatMap(i => i.facts),
    voice: inputs.flatMap(i => i.voice),
    usage: inputs.flatMap(i => i.usage),
    droppedMalformedQuestions: inputs.reduce((sum, i) => sum + i.droppedMalformedQuestions, 0),
    callFailures: sumCallFailures(inputs),
  };
}

/**
 * Aggregate every slug's per-character `report.json` into one top-level
 * `summary.json`/`summary.md`: a `perCharacter` block per slug plus a
 * `pooled` block over every character's records combined.
 */
export function writeAggregateReport(outDir: string, slugs: string[]): void {
  const perCharacterInputs = new Map<string, ReportBuildInput>();
  for (const slug of slugs) {
    const input = readStageFile<ReportBuildInput>(stagePath(outDir, slug, 'report'));
    if (input !== null) {
      perCharacterInputs.set(slug, input);
    }
  }

  const perCharacter: Record<string, ReportJson> = {};
  for (const [slug, input] of perCharacterInputs) {
    perCharacter[slug] = buildReportJson(input);
  }
  const pooled = buildReportJson(poolReportInputs([...perCharacterInputs.values()]));

  const pooledReport = { perCharacter, pooled };
  writeStageFile(join(outDir, 'summary.json'), pooledReport);

  // buildReportMarkdown returns real markdown, NOT JSON — write it verbatim
  // rather than through writeStageFile (which always JSON-encodes).
  const summaryMdPath = join(outDir, 'summary.md');
  mkdirSync(dirname(summaryMdPath), { recursive: true });
  writeFileSync(summaryMdPath, buildReportMarkdown(pooledReport));
}

/**
 * Resolve each provider's API key up front, once per run — never per stage,
 * per slug, or per call. A provider is resolved only when this run actually
 * reaches a stage that calls it; a dry run or a corpus/report-only run
 * resolves neither, so a plan-only GLM run never demands `OPENROUTER_API_KEY`
 * and vice versa. `glmProvider` may itself be `'openrouter'`, in which case
 * one resolution serves both roles.
 */
function resolveApiKeys(options: RenderPilotOptions): Record<RenderPilotProvider, string | null> {
  const keys: Record<RenderPilotProvider, string | null> = { openrouter: null, 'zai-coding': null };
  if (options.dryRun || options.stage === 'corpus' || options.stage === 'report') {
    return keys;
  }
  const needsJudgeFamily =
    options.stage === 'questions' || options.stage === 'judge' || options.stage === 'all';
  const needsGlmFamily =
    options.stage === 'summaries' ||
    options.stage === 'answers' ||
    options.stage === 'voice' ||
    options.stage === 'all';

  if (needsJudgeFamily) {
    keys.openrouter = requireApiKey('openrouter');
  }
  if (needsGlmFamily) {
    keys[options.glmProvider] = keys[options.glmProvider] ?? requireApiKey(options.glmProvider);
  }
  return keys;
}

/** Run the render pilot across every configured slug. */
export async function runRenderPilot(options: RenderPilotOptions): Promise<void> {
  const { prisma, disconnect } = await getPrismaForEnv(options.env);
  try {
    const apiKeys = resolveApiKeys(options);
    for (const slug of options.slugs) {
      const ctx: SlugContext = {
        slug,
        outDir: options.outDir,
        usageLogPath: join(options.outDir, slug, 'usage.jsonl'),
        apiKeys,
      };
      await runSlug(ctx, options, prisma);
    }
    const reportStageRan =
      !options.dryRun && (options.stage === 'all' || options.stage === 'report');
    if (reportStageRan) {
      writeAggregateReport(options.outDir, options.slugs);
    }
  } finally {
    await disconnect();
  }
}
