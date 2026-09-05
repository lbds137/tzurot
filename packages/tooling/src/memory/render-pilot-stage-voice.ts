/**
 * Voice stage (pre-registered voice probe) and report stage (the aggregate
 * report + local spot-check file).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CorpusResult } from './render-pilot-corpus.js';
import {
  renderPersonaBlock,
  renderVoiceAnchor,
  renderNoteF,
  renderNoteS,
  type RenderArm,
} from './render-pilot-render.js';
import { renderArmNotes } from './render-pilot-archive.js';
import {
  callOpenRouter,
  requireApiKey,
  runWithConcurrency,
  clearStageUsage,
} from './render-pilot-llm.js';
import {
  countWords,
  exclamationsPer100Words,
  countEmoji,
  hasThirdPersonSelfReference,
  countMarkerHits,
  type AnswerRecord,
  type SummaryRecord,
  type SummaryJudgeRecord,
  type FactsRecord,
  type VoiceRecord,
  type UsageAggregateInput,
  type ReportBuildInput,
} from './render-pilot-metrics.js';
import { buildSpotCheckMarkdown } from './render-pilot-report-markdown.js';
import { pickEvenlySpaced } from './sampling.js';
import {
  stagePath,
  readStageFile,
  writeStageFile,
  shouldRunStage,
  logUsage,
  type RenderPilotOptions,
  type SlugContext,
} from './render-pilot-shared.js';
import { loadSummaryByRowId, loadQuestionsStageFile } from './render-pilot-stage-summarize.js';

const ARMS: RenderArm[] = ['V', 'F', 'S'];

interface VoiceCallContext {
  ctx: SlugContext;
  options: RenderPilotOptions;
  corpus: CorpusResult;
  summaryByRowId: ReturnType<typeof loadSummaryByRowId>;
  personaBlock: string;
  voiceAnchor: string;
  latestWindow: CorpusResult['rows'];
  apiKey: string;
}

async function answerVoiceTrigger(
  vc: VoiceCallContext,
  trigger: string,
  arm: RenderArm
): Promise<VoiceRecord> {
  const archive = renderArmNotes(arm, vc.corpus, vc.summaryByRowId, vc.latestWindow);
  const userMessage = vc.voiceAnchor.length > 0 ? `${vc.voiceAnchor}\n\n${trigger}` : trigger;
  const result = await callOpenRouter(
    {
      model: vc.options.answerModel,
      messages: [
        { role: 'system', content: `${vc.personaBlock}\n${archive}` },
        { role: 'user', content: userMessage },
      ],
      // Cap and temperature sit above/at observed production values so the
      // length metric this stage measures is not clipped by its own cap.
      temperature: 1.0,
      maxTokens: 1200,
    },
    vc.apiKey
  );
  logUsage(vc.ctx, 'voice', vc.options.answerModel, result);
  return {
    arm,
    chars: result.content.length,
    words: countWords(result.content),
    exclamationsPer100Words: exclamationsPer100Words(result.content),
    emojiCount: countEmoji(result.content),
    thirdPersonSelfReference: hasThirdPersonSelfReference(
      result.content,
      vc.corpus.personality.displayName
    ),
    markerHits: countMarkerHits(result.content, [...vc.options.markers]),
    truncated: result.finishReason === 'length',
    reply: result.content,
  };
}

/** Pre-registered voice probe: `voiceWindow` latest rows per arm + N triggers, answer model. */
export async function runVoiceStage(
  ctx: SlugContext,
  options: RenderPilotOptions,
  corpus: CorpusResult
): Promise<void> {
  const path = stagePath(ctx.outDir, ctx.slug, 'voice');
  if (!shouldRunStage(options, 'voice', path)) {
    return;
  }
  clearStageUsage(ctx.usageLogPath, 'voice');
  const apiKey = ctx.apiKey ?? requireApiKey();
  const sortedRows = [...corpus.rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestWindow = sortedRows.slice(-options.voiceWindow);
  const summaryByRowId = loadSummaryByRowId(ctx.outDir, ctx.slug);
  const cardFields = {
    displayName: corpus.personality.displayName,
    personalityTraits: corpus.personality.personalityTraits,
    personalityTone: corpus.personality.personalityTone,
    conversationalExamples: corpus.personality.conversationalExamples,
  };
  const personaBlock = renderPersonaBlock(cardFields);
  const voiceAnchor = renderVoiceAnchor(cardFields);
  const vc: VoiceCallContext = {
    ctx,
    options,
    corpus,
    summaryByRowId,
    personaBlock,
    voiceAnchor,
    latestWindow,
    apiKey,
  };

  const tasks: (() => Promise<VoiceRecord>)[] = [];
  for (const trigger of options.triggers) {
    for (const arm of ARMS) {
      tasks.push(() => answerVoiceTrigger(vc, trigger, arm));
    }
  }
  const results = await runWithConcurrency(tasks, options.concurrency);
  writeStageFile(path, { n: results.length, replies: results });
}

function readUsageLog(path: string): UsageAggregateInput[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as UsageAggregateInput);
}

/** Write a markdown file verbatim — unlike `writeStageFile`, does NOT JSON-encode it. */
function writeMarkdownFile(path: string, markdown: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, markdown);
}

/**
 * Assemble this slug's raw records into the shape `buildReportJson` (and the
 * pooled cross-character aggregation in `render-pilot.ts`) both consume.
 * Written to `report.json` — a per-slug LOCAL cache file, so it may (and
 * does) carry raw reply/summary text; only the aggregate report built FROM
 * it is text-free.
 */
export function buildReportInputForSlug(ctx: SlugContext, corpus: CorpusResult): ReportBuildInput {
  const judgeOutput = readStageFile<{
    answers: AnswerRecord[];
    summaries: SummaryJudgeRecord[];
    facts: FactsRecord[];
  }>(stagePath(ctx.outDir, ctx.slug, 'judge'));
  const summaries =
    readStageFile<SummaryRecord[]>(stagePath(ctx.outDir, ctx.slug, 'summaries')) ?? [];
  const voice = readStageFile<{ replies: VoiceRecord[] }>(stagePath(ctx.outDir, ctx.slug, 'voice'));
  const usage = readUsageLog(ctx.usageLogPath);
  const { droppedMalformed } = loadQuestionsStageFile(ctx.outDir, ctx.slug);

  return {
    characterName: corpus.personality.displayName,
    answers: judgeOutput?.answers ?? [],
    summaries,
    summaryJudgements: judgeOutput?.summaries ?? [],
    facts: judgeOutput?.facts ?? [],
    voice: voice?.replies ?? [],
    usage,
    droppedMalformedQuestions: droppedMalformed,
  };
}

/** Build this slug's report input + LOCAL-ONLY spot-check file. Cross-character aggregation into `summary.json`/`summary.md` happens in `render-pilot.ts` after every slug's report stage has run. */
export async function runReportStage(ctx: SlugContext, corpus: CorpusResult): Promise<void> {
  const reportInput = buildReportInputForSlug(ctx, corpus);
  writeStageFile(stagePath(ctx.outDir, ctx.slug, 'report'), reportInput);

  const summariesWithRowId =
    readStageFile<(SummaryRecord & { rowId: string })[]>(
      stagePath(ctx.outDir, ctx.slug, 'summaries')
    ) ?? [];
  const sortedRows = [...corpus.rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const spotCheckRows = pickEvenlySpaced(sortedRows, 10, 10).map(row => ({
    id: row.id,
    createdAt: row.createdAt,
    verbatim: `${row.subjectName}: ${row.split.user}\n${corpus.personality.displayName}: ${row.split.assistant}`,
    renderF: renderNoteF({
      createdAt: new Date(row.createdAt),
      subjectName: row.subjectName,
      displayName: corpus.personality.displayName,
      userText: row.split.user,
      assistantText: row.split.assistant,
      referenced: row.split.referenced,
      facts: row.facts,
      summary: null,
    }).xml,
    renderS: renderNoteS({
      createdAt: new Date(row.createdAt),
      subjectName: row.subjectName,
      displayName: corpus.personality.displayName,
      userText: row.split.user,
      assistantText: row.split.assistant,
      referenced: row.split.referenced,
      facts: row.facts,
      summary: summariesWithRowId.find(s => s.rowId === row.id)?.summary ?? '',
    }).xml,
  }));

  writeMarkdownFile(
    join(ctx.outDir, ctx.slug, 'spot-check.md'),
    buildSpotCheckMarkdown(corpus.personality.displayName, spotCheckRows)
  );
}
