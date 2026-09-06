import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { writeStageFile, stagePath } from './render-pilot-shared.js';
import type { ReportBuildInput } from './render-pilot-metrics.js';
import type { CorpusResult } from './render-pilot-corpus.js';

const {
  buildCorpusMock,
  disconnectMock,
  runSummariesStageMock,
  runQuestionsStageMock,
  runAnswersStageMock,
  runJudgeStageMock,
  runVoiceStageMock,
  runReportStageMock,
  requireApiKeyMock,
} = vi.hoisted(() => ({
  buildCorpusMock: vi.fn(),
  disconnectMock: vi.fn().mockResolvedValue(undefined),
  runSummariesStageMock: vi.fn().mockResolvedValue(undefined),
  runQuestionsStageMock: vi.fn().mockResolvedValue(undefined),
  runAnswersStageMock: vi.fn().mockResolvedValue(undefined),
  runJudgeStageMock: vi.fn().mockResolvedValue(undefined),
  runVoiceStageMock: vi.fn().mockResolvedValue(undefined),
  runReportStageMock: vi.fn().mockResolvedValue(undefined),
  requireApiKeyMock: vi.fn(() => 'sk-test'),
}));

vi.mock('./prisma-env.js', () => ({
  getPrismaForEnv: vi.fn().mockResolvedValue({ prisma: {}, disconnect: disconnectMock }),
}));
vi.mock('./render-pilot-corpus.js', () => ({ buildCorpus: buildCorpusMock }));
vi.mock('./render-pilot-llm.js', () => ({ requireApiKey: requireApiKeyMock }));
vi.mock('./render-pilot-stage-summarize.js', () => ({
  runSummariesStage: runSummariesStageMock,
  runQuestionsStage: runQuestionsStageMock,
}));
vi.mock('./render-pilot-stage-answer.js', () => ({
  runAnswersStage: runAnswersStageMock,
  runJudgeStage: runJudgeStageMock,
}));
vi.mock('./render-pilot-stage-voice.js', () => ({
  runVoiceStage: runVoiceStageMock,
  runReportStage: runReportStageMock,
}));

import {
  runRenderPilot,
  estimateDryRunPlan,
  poolReportInputs,
  writeAggregateReport,
  type RenderPilotOptions,
} from './render-pilot.js';

function fakeCorpus(): CorpusResult {
  return {
    personality: {
      id: 'p1',
      name: 'Nova',
      displayName: 'Nova',
      personalityTraits: '',
      personalityTone: null,
      conversationalExamples: null,
    },
    rows: [],
    stats: {
      rows: 0,
      unparseable: 0,
      excludedChunked: 0,
      eligibleTotal: 0,
      rowsWithReferenced: 0,
      rowsWithoutFacts: 0,
      factsPerRowMean: 0,
      userCharsP50: 0,
      userCharsP95: 0,
      assistantCharsP50: 0,
      assistantCharsP95: 0,
    },
  };
}

function baseOptions(dir: string, overrides: Partial<RenderPilotOptions> = {}): RenderPilotOptions {
  return {
    env: 'dev',
    slugs: ['nova'],
    answerModel: 'a',
    judgeModel: 'j',
    summaryModel: 's',
    largest: 20,
    latest: 20,
    questionsPerRow: 2,
    window: 10,
    voiceWindow: 20,
    triggers: [],
    markers: [],
    outDir: dir,
    stage: 'all',
    concurrency: 4,
    dryRun: false,
    glmProvider: 'zai-coding',
    summaryThinking: 'disabled',
    answerThinking: 'high',
    ...overrides,
  };
}

describe('runRenderPilot', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-pilot-orch-'));
    buildCorpusMock.mockReset();
    buildCorpusMock.mockResolvedValue(fakeCorpus());
    disconnectMock.mockClear();
    requireApiKeyMock.mockReset();
    requireApiKeyMock.mockReturnValue('sk-test');
    for (const mock of [
      runSummariesStageMock,
      runQuestionsStageMock,
      runAnswersStageMock,
      runJudgeStageMock,
      runVoiceStageMock,
      runReportStageMock,
    ]) {
      mock.mockClear();
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('dry-run builds the corpus and calls no stage functions', async () => {
    await runRenderPilot(baseOptions(dir, { dryRun: true }));
    expect(buildCorpusMock).toHaveBeenCalledTimes(1);
    expect(runSummariesStageMock).not.toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('--stage corpus builds the corpus and stops', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'corpus' }));
    expect(buildCorpusMock).toHaveBeenCalledTimes(1);
    expect(runSummariesStageMock).not.toHaveBeenCalled();
  });

  // Canary (F2): the corpus stage never calls a model, so it must not demand
  // an API key — reverting the `options.stage === 'corpus'` skip reddens this.
  it('--stage corpus does not require an API key', async () => {
    requireApiKeyMock.mockImplementation(() => {
      throw new Error('OPENROUTER_API_KEY is not set');
    });
    await expect(runRenderPilot(baseOptions(dir, { stage: 'corpus' }))).resolves.toBeUndefined();
    expect(requireApiKeyMock).not.toHaveBeenCalled();
  });

  it('--stage all runs every stage in order', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'all' }));
    expect(runSummariesStageMock).toHaveBeenCalledTimes(1);
    expect(runQuestionsStageMock).toHaveBeenCalledTimes(1);
    expect(runAnswersStageMock).toHaveBeenCalledTimes(1);
    expect(runJudgeStageMock).toHaveBeenCalledTimes(1);
    expect(runVoiceStageMock).toHaveBeenCalledTimes(1);
    expect(runReportStageMock).toHaveBeenCalledTimes(1);
  });

  it('--stage summaries runs only the summaries stage', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'summaries' }));
    expect(runSummariesStageMock).toHaveBeenCalledTimes(1);
    expect(runQuestionsStageMock).not.toHaveBeenCalled();
  });

  it('disconnects prisma even when a stage throws', async () => {
    buildCorpusMock.mockRejectedValue(new Error('db down'));
    await expect(runRenderPilot(baseOptions(dir))).rejects.toThrow('db down');
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  // Wiring pin: resolveApiKeys must resolve BOTH provider families for a full
  // run — the judge family always on 'openrouter', the GLM family on
  // whichever provider glmProvider names. requireApiKeyMock is
  // argument-agnostic by default, so without asserting the specific argument
  // this couldn't catch a resolveApiKeys that silently dropped a provider or
  // resolved the wrong one.
  it('--stage all with glmProvider zai-coding resolves both openrouter and zai-coding keys', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'all', glmProvider: 'zai-coding' }));
    expect(requireApiKeyMock).toHaveBeenCalledWith('openrouter');
    expect(requireApiKeyMock).toHaveBeenCalledWith('zai-coding');
  });

  it('--stage answers with glmProvider zai-coding resolves only zai-coding, never openrouter', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'answers', glmProvider: 'zai-coding' }));
    expect(requireApiKeyMock).toHaveBeenCalledWith('zai-coding');
    expect(requireApiKeyMock).not.toHaveBeenCalledWith('openrouter');
  });

  it('--stage summaries with glmProvider zai-coding resolves only zai-coding, never openrouter', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'summaries', glmProvider: 'zai-coding' }));
    expect(requireApiKeyMock).toHaveBeenCalledWith('zai-coding');
    expect(requireApiKeyMock).not.toHaveBeenCalledWith('openrouter');
  });

  it('--stage voice with glmProvider zai-coding resolves only zai-coding, never openrouter', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'voice', glmProvider: 'zai-coding' }));
    expect(requireApiKeyMock).toHaveBeenCalledWith('zai-coding');
    expect(requireApiKeyMock).not.toHaveBeenCalledWith('openrouter');
  });

  it('--stage judge resolves only openrouter, never zai-coding', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'judge', glmProvider: 'zai-coding' }));
    expect(requireApiKeyMock).toHaveBeenCalledWith('openrouter');
    expect(requireApiKeyMock).not.toHaveBeenCalledWith('zai-coding');
  });

  it('--stage questions resolves only openrouter, never zai-coding', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'questions', glmProvider: 'zai-coding' }));
    expect(requireApiKeyMock).toHaveBeenCalledWith('openrouter');
    expect(requireApiKeyMock).not.toHaveBeenCalledWith('zai-coding');
  });

  it('--stage report resolves neither provider', async () => {
    await runRenderPilot(baseOptions(dir, { stage: 'report', glmProvider: 'zai-coding' }));
    expect(requireApiKeyMock).not.toHaveBeenCalled();
  });
});

function corpusWithRows(rowCount: number) {
  const corpus = fakeCorpus();
  for (let i = 0; i < rowCount; i++) {
    corpus.rows.push({
      id: `m${String(i)}`,
      createdAt: new Date(2026, 0, i + 1).toISOString(),
      contentChars: 30,
      subjectName: 'Alice',
      facts: [],
      split: { user: 'hello there', assistant: 'hi, how are you?', referenced: null },
    });
  }
  return corpus;
}

describe('estimateDryRunPlan', () => {
  it('projects call counts from the corpus size and options, with no model calls', () => {
    const corpus = corpusWithRows(4);
    const options = baseOptions('unused', { questionsPerRow: 2, triggers: ['a', 'b', 'c'] });
    const plan = estimateDryRunPlan(corpus, options);

    const byStage = Object.fromEntries(plan.map(p => [p.stage, p]));
    expect(byStage.summaries.calls).toBe(4);
    expect(byStage.questions.calls).toBe(4);
    // answers: rows * questionsPerRow * 3 arms
    expect(byStage.answers.calls).toBe(4 * 2 * 3);
    // judge: answer calls + one per-row summary judge + one per-row facts judge
    expect(byStage.judge.calls).toBe(4 * 2 * 3 + 4 + 4);
    // voice: triggers * 3 arms
    expect(byStage.voice.calls).toBe(3 * 3);
  });

  it('projects zero calls and zero tokens for an empty corpus', () => {
    const plan = estimateDryRunPlan(fakeCorpus(), baseOptions('unused'));
    for (const estimate of plan) {
      expect(estimate.calls).toBe(0);
      expect(estimate.inputTokens).toBe(0);
    }
  });

  it('projects nonzero input tokens for a nonempty corpus', () => {
    const plan = estimateDryRunPlan(corpusWithRows(2), baseOptions('unused', { triggers: ['hi'] }));
    for (const estimate of plan) {
      expect(estimate.inputTokens).toBeGreaterThan(0);
    }
  });

  // Canary (F2): dropping the ×3 answer-arms factor from the judge-stage
  // token estimate (back to `questionsPerRow + 2`) must redden this test.
  it('scales the judge-stage input-token estimate by questionsPerRow * answer arms + 2', () => {
    const corpus = corpusWithRows(1);
    const options = baseOptions('unused', { questionsPerRow: 2 });
    const plan = estimateDryRunPlan(corpus, options);
    const byStage = Object.fromEntries(plan.map(p => [p.stage, p]));

    const verbatimTokens = countTextTokens('hello there' + 'hi, how are you?');
    expect(verbatimTokens).toBeGreaterThan(0);
    // 8 = questionsPerRow (2) * ANSWER_ARMS_COUNT (3) + 2 (summary judge + facts judge)
    expect(byStage.judge.inputTokens).toBe(verbatimTokens * 8);
  });
});

function fakeReportInput(overrides: Partial<ReportBuildInput> = {}): ReportBuildInput {
  return {
    characterName: 'x',
    answers: [],
    summaries: [],
    summaryJudgements: [],
    facts: [],
    voice: [],
    usage: [],
    droppedMalformedQuestions: 0,
    callFailures: {},
    ...overrides,
  };
}

describe('poolReportInputs', () => {
  it('sums record counts across characters rather than averaging their rates', () => {
    const small = fakeReportInput({
      answers: Array.from({ length: 5 }, () => ({
        arm: 'V' as const,
        basis: 'assistant' as const,
        judged: true,
        correct: true,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'x',
        summaryFallbackRows: 0,
      })),
    });
    const large = fakeReportInput({
      answers: Array.from({ length: 40 }, () => ({
        arm: 'V' as const,
        basis: 'assistant' as const,
        judged: true,
        correct: false,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'y',
        summaryFallbackRows: 0,
      })),
    });
    const pooled = poolReportInputs([small, large]);
    // A mean-of-rates pool would read (1.0 + 0.0) / 2 = 50% correct.
    // Pooling raw records must instead reflect the true weighted total: 5/45.
    expect(pooled.answers).toHaveLength(45);
    expect(pooled.answers.filter(a => a.correct)).toHaveLength(5);
  });

  it('sums callFailures per stage across characters', () => {
    const a = fakeReportInput({ callFailures: { summaries: 2, judge: 1 } });
    const b = fakeReportInput({ callFailures: { summaries: 1, voice: 3 } });
    const pooled = poolReportInputs([a, b]);
    expect(pooled.callFailures).toEqual({ summaries: 3, judge: 1, voice: 3 });
  });
});

describe('writeAggregateReport', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-pilot-aggregate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a pooled block whose counts are sums, not means, across characters', () => {
    writeStageFile(
      stagePath(dir, 'nova', 'report'),
      fakeReportInput({
        answers: [
          {
            arm: 'V',
            basis: 'assistant',
            judged: true,
            correct: true,
            faithful: true,
            unsupportedClaims: [],
            tailTokens: 10,
            truncated: false,
            reply: 'x',
            summaryFallbackRows: 0,
          },
        ],
      })
    );
    writeStageFile(
      stagePath(dir, 'luna', 'report'),
      fakeReportInput({
        answers: [
          {
            arm: 'V',
            basis: 'assistant',
            judged: true,
            correct: true,
            faithful: true,
            unsupportedClaims: [],
            tailTokens: 10,
            truncated: false,
            reply: 'y',
            summaryFallbackRows: 0,
          },
          {
            arm: 'V',
            basis: 'assistant',
            judged: true,
            correct: false,
            faithful: true,
            unsupportedClaims: [],
            tailTokens: 10,
            truncated: false,
            reply: 'z',
            summaryFallbackRows: 0,
          },
        ],
      })
    );

    writeAggregateReport(dir, ['nova', 'luna']);

    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as {
      perCharacter: Record<string, { arms: { V: { n: number } } }>;
      pooled: { arms: { V: { n: number; correctnessRate: number } } };
    };
    expect(summary.perCharacter.nova.arms.V.n).toBe(1);
    expect(summary.perCharacter.luna.arms.V.n).toBe(2);
    expect(summary.pooled.arms.V.n).toBe(3);
    expect(summary.pooled.arms.V.correctnessRate).toBeCloseTo(2 / 3, 5);
  });

  // Canary: if writeAggregateReport reads `.reply`/`.summary` text into the
  // pooled/per-character JSON or markdown, this reddens.
  it('does not leak reply/summary text from per-slug report.json into summary.json or summary.md', () => {
    const SENTINEL = 'SENTINEL-aggregate-leak-check';
    writeStageFile(
      stagePath(dir, 'nova', 'report'),
      fakeReportInput({
        answers: [
          {
            arm: 'V',
            basis: 'assistant',
            judged: true,
            correct: true,
            faithful: true,
            unsupportedClaims: [],
            tailTokens: 10,
            truncated: false,
            reply: SENTINEL,
            summaryFallbackRows: 0,
          },
        ],
        summaries: [
          {
            tokens: 10,
            state: 'within_soft',
            hasFirstPerson: false,
            parseFailed: false,
            summary: SENTINEL,
          },
        ],
      })
    );

    writeAggregateReport(dir, ['nova']);

    const summaryJson = readFileSync(join(dir, 'summary.json'), 'utf8');
    const summaryMd = readFileSync(join(dir, 'summary.md'), 'utf8');
    expect(summaryJson).not.toContain(SENTINEL);
    expect(summaryMd).not.toContain(SENTINEL);
    // Canary (G3): summary.md must be real markdown, not a JSON dump — assert
    // the table shape rather than a fenced JSON.stringify blob.
    expect(summaryMd).toContain('| Arm | n |');
    expect(summaryMd).not.toContain('```json');
  });

  it('skips a slug with no report.json rather than throwing', () => {
    expect(() => writeAggregateReport(dir, ['missing-slug'])).not.toThrow();
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as {
      perCharacter: object;
    };
    expect(summary.perCharacter).toEqual({});
  });
});
