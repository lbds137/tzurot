/**
 * Shared types and helpers for render-pilot stage orchestration: the option
 * type, the per-slug on-disk stage cache, and window selection. Split out of
 * `render-pilot.ts` to keep the per-stage files under their line budget.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Environment } from '../utils/env-runner.js';
import { appendUsageRecord } from './render-pilot-llm.js';

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
  apiKey: string | null;
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
  });
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
