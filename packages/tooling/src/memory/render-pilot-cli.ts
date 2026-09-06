/**
 * CLI option parsing for `pnpm ops memory:render-pilot`, split out of
 * `commands/memory.ts` to keep that router under its line budget.
 */

import { readFileSync } from 'node:fs';
import type { Environment } from '../utils/env-runner.js';
import { parseIntFlag } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';
import { DEFAULT_VOICE_TRIGGERS } from './render-pilot-prompts.js';
import type { RenderPilotProvider, ThinkingSetting } from './render-pilot-provider.js';
import type { RenderPilotOptions, RenderPilotStage } from './render-pilot.js';

/** Raw CLI options as cac parses them (camelCase, all strings/booleans). */
export interface RawRenderPilotOptions {
  env?: Environment;
  personality?: string;
  answerModel?: string;
  judgeModel?: string;
  summaryModel?: string;
  largest?: string;
  latest?: string;
  questionsPerRow?: string;
  window?: string;
  voiceWindow?: string;
  triggersFile?: string;
  markersFile?: string;
  out?: string;
  stage?: string;
  concurrency?: string;
  dryRun?: boolean;
  glmProvider?: string;
  summaryThinking?: string;
  answerThinking?: string;
}

const VALID_STAGES = new Set<string>([
  'corpus',
  'summaries',
  'questions',
  'answers',
  'judge',
  'voice',
  'report',
  'all',
]);

function requireModel(raw: string | undefined, flag: string): string {
  if (raw === undefined || raw.trim().length === 0) {
    throw new UsageError(`${flag} is required — model ids drift, so there is no default`);
  }
  return raw;
}

function parseSlugs(raw: string | undefined): string[] {
  const slugs = (raw ?? '')
    .split(',')
    .map(slug => slug.trim())
    .filter(slug => slug.length > 0);
  if (slugs.length === 0) {
    throw new UsageError('--personality is required (comma-separated slugs)');
  }
  return slugs;
}

function parseStage(raw: string | undefined): RenderPilotStage {
  const stage = raw ?? 'all';
  if (!VALID_STAGES.has(stage)) {
    throw new UsageError(`--stage must be one of ${[...VALID_STAGES].join('|')}, got: '${stage}'`);
  }
  return stage as RenderPilotStage;
}

const VALID_GLM_PROVIDERS = new Set<string>(['openrouter', 'zai-coding']);
const VALID_THINKING_SETTINGS = new Set<string>(['disabled', 'high']);

/** Validate `--glm-provider`, defaulting to the flat-rate coding plan. */
function parseGlmProvider(raw: string | undefined): RenderPilotProvider {
  const provider = raw ?? 'zai-coding';
  if (!VALID_GLM_PROVIDERS.has(provider)) {
    throw new UsageError(
      `--glm-provider must be one of ${[...VALID_GLM_PROVIDERS].join('|')}, got: '${provider}'`
    );
  }
  return provider as RenderPilotProvider;
}

/** Validate a `disabled|high` thinking flag, naming it in the error so two call sites don't collide on one message. */
function parseThinkingSetting(
  raw: string | undefined,
  flag: string,
  fallback: ThinkingSetting
): ThinkingSetting {
  const setting = raw ?? fallback;
  if (!VALID_THINKING_SETTINGS.has(setting)) {
    throw new UsageError(
      `${flag} must be one of ${[...VALID_THINKING_SETTINGS].join('|')}, got: '${setting}'`
    );
  }
  return setting as ThinkingSetting;
}

/** Read a JSON `{"triggers": [string]}` or `{"markers": [string]}` file, validating the shape. */
function readStringArrayFile(
  path: string | undefined,
  key: 'triggers' | 'markers'
): string[] | null {
  if (path === undefined) {
    return null;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const value =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)[key]
      : undefined;
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) {
    throw new UsageError(`${path} must be JSON of the shape {"${key}": [string, ...]}`);
  }
  return value;
}

/** Validate and default the raw CLI options into a full `RenderPilotOptions`. */
export function buildRenderPilotOptions(raw: RawRenderPilotOptions): RenderPilotOptions {
  return {
    env: raw.env ?? 'dev',
    slugs: parseSlugs(raw.personality),
    answerModel: requireModel(raw.answerModel, '--answer-model'),
    judgeModel: requireModel(raw.judgeModel, '--judge-model'),
    summaryModel: requireModel(raw.summaryModel, '--summary-model'),
    largest: parseIntFlag(raw.largest, '--largest', { min: 1 }) ?? 20,
    latest: parseIntFlag(raw.latest, '--latest', { min: 1 }) ?? 20,
    questionsPerRow: parseIntFlag(raw.questionsPerRow, '--questions-per-row', { min: 1 }) ?? 2,
    window: parseIntFlag(raw.window, '--window', { min: 1 }) ?? 10,
    voiceWindow: parseIntFlag(raw.voiceWindow, '--voice-window', { min: 1 }) ?? 20,
    triggers: readStringArrayFile(raw.triggersFile, 'triggers') ?? DEFAULT_VOICE_TRIGGERS,
    markers: readStringArrayFile(raw.markersFile, 'markers') ?? [],
    outDir: raw.out ?? 'reports/render-pilot',
    stage: parseStage(raw.stage),
    concurrency: parseIntFlag(raw.concurrency, '--concurrency', { min: 1 }) ?? 4,
    dryRun: raw.dryRun ?? false,
    glmProvider: parseGlmProvider(raw.glmProvider),
    summaryThinking: parseThinkingSetting(raw.summaryThinking, '--summary-thinking', 'disabled'),
    answerThinking: parseThinkingSetting(raw.answerThinking, '--answer-thinking', 'high'),
  };
}
