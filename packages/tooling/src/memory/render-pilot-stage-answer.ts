/**
 * Answers stage (each row × question × arm, answered in-character) and judge
 * stage (per-answer correctness/faithfulness, plus the two render-level
 * judgements over arm S and arm F).
 */

import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { CorpusResult, CorpusRow } from './render-pilot-corpus.js';
import { renderPersonaBlock, type RenderArm } from './render-pilot-render.js';
import { renderArmNotes } from './render-pilot-archive.js';
import {
  buildJudgeAnswerUserMessage,
  buildJudgeSummaryUserMessage,
  buildJudgeFactsUserMessage,
  JUDGE_ANSWER_SYSTEM_PROMPT,
  JUDGE_SUMMARY_SYSTEM_PROMPT,
  JUDGE_FACTS_SYSTEM_PROMPT,
} from './render-pilot-prompts.js';
import {
  callChatCompletion,
  requireApiKey,
  runWithConcurrencySettled,
  clearStageUsage,
} from './render-pilot-llm.js';
import {
  parseAnswerJudgement,
  parseSummaryJudgement,
  parseFactsJudgement,
  type AnswerRecord,
  type SummaryJudgeRecord,
  type FactsRecord,
  type ParsedAnswerJudgement,
  type ParsedSummaryJudgement,
  type ParsedFactsJudgement,
} from './render-pilot-metrics.js';
import {
  stagePath,
  readStageFile,
  writeStageFile,
  shouldRunStage,
  logUsage,
  selectWindowRows,
  partitionSettled,
  reportStageFailures,
  reportOrphanedQuestions,
  type RenderPilotOptions,
  type SlugContext,
  type StageCallFailure,
} from './render-pilot-shared.js';
import {
  loadSummaryByRowId,
  loadQuestionsStageFile,
  type QuestionRecord,
} from './render-pilot-stage-summarize.js';

export interface AnswerStageRecord {
  rowId: string;
  question: string;
  referenceAnswer: string;
  basis: 'assistant' | 'user';
  arm: RenderArm;
  reply: string;
  tailTokens: number;
  /** `finishReason === 'length'` — the reply was cut off by the token cap. */
  truncated: boolean;
  /** Rows in this answer's window rendered as arm F instead of arm S for lacking a usable summary. Meaningful only for arm S; always 0 for arms V and F. */
  summaryFallbackRows: number;
}

const ARMS: RenderArm[] = ['V', 'F', 'S'];

interface AnswerCallContext {
  ctx: SlugContext;
  options: RenderPilotOptions;
  corpus: CorpusResult;
  summaryByRowId: ReturnType<typeof loadSummaryByRowId>;
  personaBlock: string;
  apiKey: string;
}

async function answerOneQuestionArm(
  ac: AnswerCallContext,
  question: QuestionRecord,
  windowRows: CorpusRow[],
  arm: RenderArm
): Promise<AnswerStageRecord> {
  const { xml: archive, summaryFallbackRows } = renderArmNotes(
    arm,
    ac.corpus,
    ac.summaryByRowId,
    windowRows
  );
  const result = await callChatCompletion(
    {
      model: ac.options.answerModel,
      messages: [
        { role: 'system', content: `${ac.personaBlock}\n${archive}` },
        { role: 'user', content: question.q },
      ],
      temperature: 0.7,
      // Cap sits above observed production reply lengths so the length
      // metric this stage measures is not clipped by its own cap.
      // Cap must leave headroom for a reasoning model's thinking tokens, which are
      // emitted before any content: a live run at a tight cap came back
      // finish_reason "length" with no content at all. The thinking-first ordering
      // is inferred from that finish_reason, not separately probed.
      // A live run at the previous 4000 cap still exhausted it on 71 of 678
      // answer calls, and the loss skewed toward arms F and S (observed 15
      // and 12 for one character, versus 5 on arm V) — a cap that bites
      // unevenly across arms biases the sample rather than merely trimming it.
      maxTokens: 6000,
      provider: ac.options.glmProvider,
      thinking: ac.options.answerThinking,
    },
    ac.apiKey
  );
  logUsage(ac.ctx, 'answers', ac.options.answerModel, result);
  return {
    rowId: question.rowId,
    question: question.q,
    referenceAnswer: question.a,
    basis: question.basis,
    arm,
    reply: result.content,
    tailTokens: countTextTokens(archive),
    truncated: result.finishReason === 'length',
    summaryFallbackRows,
  };
}

/** On-disk shape of the answers stage cache file. */
export interface AnswersStageFile {
  answers: AnswerStageRecord[];
  failures: StageCallFailure[];
  /** Cached questions whose `rowId` was no longer in the corpus when this stage ran — skipped, not answered. */
  orphanedQuestions: number;
}

/** Read the cached answers stage file, defaulting to empty when absent. */
export function loadAnswersStageFile(outDir: string, slug: string): AnswersStageFile {
  const file = readStageFile<AnswersStageFile>(stagePath(outDir, slug, 'answers'));
  return file ?? { answers: [], failures: [], orphanedQuestions: 0 };
}

/** For every (row, question, arm), render the window and answer in-character. */
export async function runAnswersStage(
  ctx: SlugContext,
  options: RenderPilotOptions,
  corpus: CorpusResult
): Promise<void> {
  const path = stagePath(ctx.outDir, ctx.slug, 'answers');
  if (!shouldRunStage(options, 'answers', path)) {
    return;
  }
  clearStageUsage(ctx.usageLogPath, 'answers');
  const apiKey = ctx.apiKeys[options.glmProvider] ?? requireApiKey(options.glmProvider);
  const summaryByRowId = loadSummaryByRowId(ctx.outDir, ctx.slug);
  const { questions } = loadQuestionsStageFile(ctx.outDir, ctx.slug);
  const sortedRows = [...corpus.rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const personaBlock = renderPersonaBlock({
    displayName: corpus.personality.displayName,
    personalityTraits: corpus.personality.personalityTraits,
    personalityTone: corpus.personality.personalityTone,
    conversationalExamples: corpus.personality.conversationalExamples,
  });
  const ac: AnswerCallContext = { ctx, options, corpus, summaryByRowId, personaBlock, apiKey };

  const tasks: (() => Promise<AnswerStageRecord>)[] = [];
  const meta: { rowId: string; arm: RenderArm }[] = [];
  let orphanedQuestions = 0;
  for (const question of questions) {
    const centerIndex = sortedRows.findIndex(r => r.id === question.rowId);
    if (centerIndex === -1) {
      orphanedQuestions += 1;
      continue;
    }
    const windowRows = selectWindowRows(sortedRows, centerIndex, options.window);
    for (const arm of ARMS) {
      tasks.push(() => answerOneQuestionArm(ac, question, windowRows, arm));
      meta.push({ rowId: question.rowId, arm });
    }
  }
  reportOrphanedQuestions(orphanedQuestions);
  const settled = await runWithConcurrencySettled(tasks, options.concurrency);
  const { values, failures } = partitionSettled(settled, index => meta[index]);
  reportStageFailures('answers', failures);
  const file: AnswersStageFile = { answers: values, failures, orphanedQuestions };
  writeStageFile(path, file);
}

interface JudgeCallContext {
  ctx: SlugContext;
  options: RenderPilotOptions;
  apiKey: string;
  displayName: string;
}

/**
 * The shared judge request: identical model/temperature/cap/JSON-mode shape and
 * usage logging for all three judge families, so only the prompts differ.
 */
async function callJudge(
  jc: JudgeCallContext,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const result = await callChatCompletion(
    {
      model: jc.options.judgeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      // Cap must leave headroom for a reasoning model's thinking tokens, which are
      // emitted before any content: a live run at a tight cap came back
      // finish_reason "length" with no content at all. The thinking-first ordering
      // is inferred from that finish_reason, not separately probed.
      maxTokens: 2000,
      jsonMode: true,
      provider: 'openrouter',
    },
    jc.apiKey
  );
  logUsage(jc.ctx, 'judge', jc.options.judgeModel, result);
  return result.content;
}

async function judgeAnswer(
  jc: JudgeCallContext,
  row: CorpusRow,
  answer: AnswerStageRecord
): Promise<ParsedAnswerJudgement | null> {
  const userMessage = buildJudgeAnswerUserMessage({
    subjectName: row.subjectName,
    displayName: jc.displayName,
    userText: row.split.user,
    assistantText: row.split.assistant,
    referenced: row.split.referenced,
    question: answer.question,
    referenceAnswer: answer.referenceAnswer,
    reply: answer.reply,
  });
  const content = await callJudge(jc, JUDGE_ANSWER_SYSTEM_PROMPT, userMessage);
  return parseAnswerJudgement(content);
}

async function judgeSummary(
  jc: JudgeCallContext,
  row: CorpusRow,
  summary: string
): Promise<ParsedSummaryJudgement | null> {
  const userMessage = buildJudgeSummaryUserMessage({
    subjectName: row.subjectName,
    displayName: jc.displayName,
    userText: row.split.user,
    assistantText: row.split.assistant,
    referenced: row.split.referenced,
    summary,
  });
  const content = await callJudge(jc, JUDGE_SUMMARY_SYSTEM_PROMPT, userMessage);
  return parseSummaryJudgement(content);
}

async function judgeFacts(
  jc: JudgeCallContext,
  row: CorpusRow
): Promise<ParsedFactsJudgement | null> {
  const userMessage = buildJudgeFactsUserMessage({
    subjectName: row.subjectName,
    displayName: jc.displayName,
    userText: row.split.user,
    assistantText: row.split.assistant,
    referenced: row.split.referenced,
    factStatements: row.facts.map(f => f.statement),
  });
  const content = await callJudge(jc, JUDGE_FACTS_SYSTEM_PROMPT, userMessage);
  return parseFactsJudgement(content);
}

/** One unit of judge work, tagged so a single task list can carry all three families. */
type JudgeTaskResult =
  | { kind: 'answer'; record: AnswerRecord }
  | { kind: 'summary'; record: SummaryJudgeRecord }
  | { kind: 'facts'; record: FactsRecord };

async function judgeOneAnswer(
  jc: JudgeCallContext,
  row: CorpusRow | undefined,
  answer: AnswerStageRecord
): Promise<AnswerRecord> {
  const judgement = row === undefined ? null : await judgeAnswer(jc, row, answer);
  return {
    arm: answer.arm,
    basis: answer.basis,
    judged: judgement !== null,
    correct: judgement?.correct ?? false,
    faithful: judgement?.faithful ?? false,
    unsupportedClaims: judgement?.unsupportedClaims ?? [],
    tailTokens: answer.tailTokens,
    truncated: answer.truncated,
    reply: answer.reply,
    summaryFallbackRows: answer.summaryFallbackRows,
  };
}

async function judgeOneSummary(
  jc: JudgeCallContext,
  row: CorpusRow,
  summary: string | undefined
): Promise<SummaryJudgeRecord> {
  const judgement = summary === undefined ? null : await judgeSummary(jc, row, summary);
  return {
    judged: judgement !== null,
    faithful: judgement?.faithful ?? false,
    danglingReference: judgement?.danglingReference ?? false,
    missingCommitments: judgement?.missingCommitments ?? [],
    hasReferenced: row.split.referenced !== null,
  };
}

async function judgeOneFactsRow(jc: JudgeCallContext, row: CorpusRow): Promise<FactsRecord> {
  const judgement = await judgeFacts(jc, row);
  return {
    hadFacts: row.facts.length > 0,
    missingCommitments: judgement?.missingCommitments ?? [],
  };
}

/**
 * Build the single task list covering every judge call for this slug (per-answer,
 * per-row summary, per-row facts) so the whole stage runs under ONE concurrency
 * pool — three separate pools would triple the effective in-flight bound.
 * `meta` runs parallel to `tasks` — the rowId each task's failure would be attributed to.
 */
function buildJudgeTasks(
  jc: JudgeCallContext,
  corpus: CorpusResult
): { tasks: (() => Promise<JudgeTaskResult>)[]; meta: { rowId: string }[] } {
  const { answers } = loadAnswersStageFile(jc.ctx.outDir, jc.ctx.slug);
  const rowById = new Map(corpus.rows.map(r => [r.id, r]));
  const summaryByRowId = loadSummaryByRowId(jc.ctx.outDir, jc.ctx.slug);

  const answerTasks = answers.map(answer => async (): Promise<JudgeTaskResult> => ({
    kind: 'answer' as const,
    record: await judgeOneAnswer(jc, rowById.get(answer.rowId), answer),
  }));
  const summaryTasks = corpus.rows.map(row => async (): Promise<JudgeTaskResult> => ({
    kind: 'summary' as const,
    record: await judgeOneSummary(jc, row, summaryByRowId.get(row.id)?.summary),
  }));
  const factsTasks = corpus.rows.map(row => async (): Promise<JudgeTaskResult> => ({
    kind: 'facts' as const,
    record: await judgeOneFactsRow(jc, row),
  }));

  const rowMeta = corpus.rows.map(r => ({ rowId: r.id }));
  return {
    tasks: [...answerTasks, ...summaryTasks, ...factsTasks],
    meta: [...answers.map(a => ({ rowId: a.rowId })), ...rowMeta, ...rowMeta],
  };
}

/** Judge every cached answer, plus the two render-level judgements (arm S, arm F). */
export async function runJudgeStage(
  ctx: SlugContext,
  options: RenderPilotOptions,
  corpus: CorpusResult
): Promise<void> {
  const path = stagePath(ctx.outDir, ctx.slug, 'judge');
  if (!shouldRunStage(options, 'judge', path)) {
    return;
  }
  clearStageUsage(ctx.usageLogPath, 'judge');
  const jc: JudgeCallContext = {
    ctx,
    options,
    apiKey: ctx.apiKeys.openrouter ?? requireApiKey('openrouter'),
    displayName: corpus.personality.displayName,
  };

  const { tasks, meta } = buildJudgeTasks(jc, corpus);
  const settled = await runWithConcurrencySettled(tasks, options.concurrency);
  const { values: results, failures } = partitionSettled(settled, index => meta[index]);
  reportStageFailures('judge', failures);

  const answerRecords: AnswerRecord[] = [];
  const summaryJudgeRecords: SummaryJudgeRecord[] = [];
  const factsRecords: FactsRecord[] = [];
  for (const result of results) {
    if (result.kind === 'answer') {
      answerRecords.push(result.record);
    } else if (result.kind === 'summary') {
      summaryJudgeRecords.push(result.record);
    } else {
      factsRecords.push(result.record);
    }
  }
  writeStageFile(path, {
    answers: answerRecords,
    summaries: summaryJudgeRecords,
    facts: factsRecords,
    failures,
  });
}
