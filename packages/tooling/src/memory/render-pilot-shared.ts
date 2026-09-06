/**
 * Shared types and helpers for render-pilot stage orchestration: the option
 * type, the per-slug on-disk stage cache, and window selection. Split out of
 * `render-pilot.ts` to keep the per-stage files under their line budget.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Environment } from '../utils/env-runner.js';
import { appendUsageRecord, type SettledResult } from './render-pilot-llm.js';
import type { RenderPilotProvider, ThinkingSetting } from './render-pilot-provider.js';

export type RenderPilotStage =
  'corpus' | 'summaries' | 'questions' | 'answers' | 'judge' | 'voice' | 'report' | 'all';

export interface RenderPilotOptions {
  env: Environment;
  slugs: string[];
  answerModel: string;
  judgeModel: string;
  summaryModel: string;
  largest: number;
  latest: number;
  questionsPerRow: number;
  window: number;
  voiceWindow: number;
  triggers: readonly string[];
  markers: readonly string[];
  outDir: string;
  stage: RenderPilotStage;
  concurrency: number;
  dryRun: boolean;
  /** Provider carrying the GLM answer/summary/voice calls — OpenRouter or the flat-rate z.ai coding plan. */
  glmProvider: RenderPilotProvider;
  summaryThinking: ThinkingSetting;
  answerThinking: ThinkingSetting;
}

/** Stage execution order; `corpus` always runs first and is handled by the caller. */
export const STAGE_ORDER: Exclude<RenderPilotStage, 'all'>[] = [
  'corpus',
  'summaries',
  'questions',
  'answers',
  'judge',
  'voice',
  'report',
];

/** Per-slug context threaded through every stage function. */
export interface SlugContext {
  slug: string;
  outDir: string;
  usageLogPath: string;
  /** Resolved API key per provider — `null` when that provider's stages don't run this pass (dry run, corpus/report-only, or the other provider's stages). */
  apiKeys: Record<RenderPilotProvider, string | null>;
}

export function stagePath(outDir: string, slug: string, stage: string): string {
  return join(outDir, slug, `stage-${stage}.json`);
}

export function readStageFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeStageFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/** Whether stage `name` should run this pass, given `--stage` and cache presence. */
export function shouldRunStage(
  options: RenderPilotOptions,
  name: Exclude<RenderPilotStage, 'all'>,
  path: string
): boolean {
  if (options.stage === 'all') {
    return !existsSync(path);
  }
  return options.stage === name;
}

/** Append one model call's usage to the slug's usage log. */
export function logUsage(
  ctx: SlugContext,
  stage: string,
  model: string,
  result: {
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    attempts: number;
    reasoningBlocksStripped: number;
    provider: RenderPilotProvider;
  }
): void {
  appendUsageRecord(ctx.usageLogPath, {
    stage,
    model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    reasoningBlocksStripped: result.reasoningBlocksStripped,
    timestamp: new Date().toISOString(),
    provider: result.provider,
  });
}

/** One fanned-out model call that failed, tagged with enough context to locate it without its error text. */
export interface StageCallFailure {
  index: number;
  rowId?: string;
  arm?: string;
  error: string;
}

/**
 * Split a `runWithConcurrencySettled` result into successful values (in
 * order, failed indices simply absent) and {@link StageCallFailure} records.
 * `describe` supplies whatever locating metadata (`rowId`/`arm`) the caller's
 * task list carries at that index — omitted entirely when absent, never
 * emitted as `undefined`.
 */
export function partitionSettled<T>(
  results: SettledResult<T>[],
  describe?: (index: number) => { rowId?: string; arm?: string } | undefined
): { values: T[]; failures: StageCallFailure[] } {
  const values: T[] = [];
  const failures: StageCallFailure[] = [];
  results.forEach((result, index) => {
    if (result.ok) {
      values.push(result.value);
      return;
    }
    const meta = describe?.(index);
    const failure: StageCallFailure = { index, error: result.error };
    if (meta?.rowId !== undefined) {
      failure.rowId = meta.rowId;
    }
    if (meta?.arm !== undefined) {
      failure.arm = meta.arm;
    }
    failures.push(failure);
  });
  return { values, failures };
}

/**
 * Log one count-only line when a stage had failures — deliberately no error
 * text, since a failure's message carries a 300-char body preview that may
 * include model output, and stdout must stay free of that.
 */
export function reportStageFailures(stage: string, failures: StageCallFailure[]): void {
  if (failures.length === 0) {
    return;
  }
  console.log(
    `[render-pilot] stage ${stage}: ${String(failures.length)} call(s) failed — see stage-${stage}.json`
  );
}

/**
 * Log one count-only line when the answers stage skipped cached questions
 * whose `rowId` is no longer in the current corpus — the corpus changed
 * (a re-run with different `--largest`/`--latest`) since the questions
 * stage cached them.
 */
export function reportOrphanedQuestions(count: number): void {
  if (count === 0) {
    return;
  }
  console.log(
    `[render-pilot] stage answers: ${String(count)} orphaned question(s) skipped — regenerate stage-questions.json after changing the corpus`
  );
}

/**
 * Pick `windowSize` rows centered on `centerIndex` from a chronologically
 * sorted pool, alternating before/after the center (deterministic — no RNG).
 */
export function selectWindowRows<T>(sortedRows: T[], centerIndex: number, windowSize: number): T[] {
  const picked = new Set<number>([centerIndex]);
  let before = centerIndex - 1;
  let after = centerIndex + 1;
  let takeBefore = true;
  const target = Math.min(windowSize, sortedRows.length);
  while (picked.size < target) {
    const tryBefore = takeBefore && before >= 0;
    const tryAfter = !takeBefore && after < sortedRows.length;
    if (tryBefore) {
      picked.add(before);
      before -= 1;
    } else if (tryAfter) {
      picked.add(after);
      after += 1;
    } else if (before >= 0) {
      picked.add(before);
      before -= 1;
    } else if (after < sortedRows.length) {
      picked.add(after);
      after += 1;
    } else {
      break;
    }
    takeBefore = !takeBefore;
  }
  return [...picked].sort((a, b) => a - b).map(i => sortedRows[i]);
}
