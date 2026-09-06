import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CorpusResult } from './render-pilot-corpus.js';
import type { RenderPilotOptions, SlugContext } from './render-pilot-shared.js';
import type { CompletionResult } from './render-pilot-llm.js';

const { callChatCompletionMock } = vi.hoisted(() => ({ callChatCompletionMock: vi.fn() }));

vi.mock('./render-pilot-llm.js', async () => {
  const actual =
    await vi.importActual<typeof import('./render-pilot-llm.js')>('./render-pilot-llm.js');
  return { ...actual, callChatCompletion: callChatCompletionMock, requireApiKey: () => 'sk-test' };
});

import { runAnswersStage, runJudgeStage } from './render-pilot-stage-answer.js';
import { stagePath, readStageFile, writeStageFile } from './render-pilot-shared.js';

function makeCorpus(): CorpusResult {
  return {
    personality: {
      id: 'p1',
      name: 'Nova',
      displayName: 'Nova',
      personalityTraits: 'warm',
      personalityTone: null,
      conversationalExamples: null,
    },
    rows: [
      {
        id: 'm1',
        createdAt: '2026-01-01T00:00:00.000Z',
        contentChars: 20,
        subjectName: 'Alice',
        facts: [],
        split: { user: 'hi', assistant: 'hello', referenced: null },
      },
    ],
    stats: {
      rows: 1,
      unparseable: 0,
      excludedChunked: 0,
      eligibleTotal: 1,
      rowsWithReferenced: 0,
      rowsWithoutFacts: 1,
      factsPerRowMean: 0,
      userCharsP50: 0,
      userCharsP95: 0,
      assistantCharsP50: 0,
      assistantCharsP95: 0,
    },
  };
}

function baseOptions(overrides: Partial<RenderPilotOptions> = {}): RenderPilotOptions {
  return {
    env: 'dev',
    slugs: ['nova'],
    answerModel: 'answer-model',
    judgeModel: 'judge-model',
    summaryModel: 'summary-model',
    largest: 20,
    latest: 20,
    questionsPerRow: 2,
    window: 10,
    voiceWindow: 20,
    triggers: [],
    markers: [],
    outDir: '',
    stage: 'all',
    concurrency: 4,
    dryRun: false,
    glmProvider: 'zai-coding',
    summaryThinking: 'disabled',
    answerThinking: 'high',
    ...overrides,
  };
}

describe('render-pilot answer/judge stages', () => {
  let dir: string;
  let ctx: SlugContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-pilot-answer-'));
    ctx = {
      slug: 'nova',
      outDir: dir,
      usageLogPath: join(dir, 'nova', 'usage.jsonl'),
      apiKeys: { openrouter: 'sk-test', 'zai-coding': 'sk-test' },
    };
    callChatCompletionMock.mockReset();
    writeStageFile(stagePath(dir, 'nova', 'questions'), {
      questions: [{ rowId: 'm1', q: 'what did Nova say?', a: 'hello', basis: 'assistant' }],
      droppedMalformed: 0,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers each question in all three arms using the answer model', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    expect(callChatCompletionMock).toHaveBeenCalledTimes(3);
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ model: string }];
      expect(request.model).toBe('answer-model');
    }
    const results = readStageFile<{ answers: { arm: string }[] }>(
      stagePath(dir, 'nova', 'answers')
    );
    expect(results?.answers.map(r => r.arm).sort()).toEqual(['F', 'S', 'V']);
  });

  it('caps answer calls at 6000 tokens', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ maxTokens: number }];
      expect(request.maxTokens).toBe(6000);
    }
  });

  // Wiring pin: the answers stage must forward options.glmProvider to the
  // call's `provider` field, not a hardcoded value. Asserting only the
  // default ('zai-coding') would also pass against a hardcoded
  // `provider: 'zai-coding'` — vary the option and check both values track it.
  it('forwards glmProvider to the answers call when set to zai-coding', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runAnswersStage(
      ctx,
      baseOptions({ outDir: dir, glmProvider: 'zai-coding' }),
      makeCorpus()
    );
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ provider: string }];
      expect(request.provider).toBe('zai-coding');
    }
  });

  it('forwards glmProvider to the answers call when set to openrouter', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'openrouter',
    } satisfies CompletionResult);
    await runAnswersStage(
      ctx,
      baseOptions({ outDir: dir, glmProvider: 'openrouter' }),
      makeCorpus()
    );
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ provider: string }];
      expect(request.provider).toBe('openrouter');
    }
  });

  // Same crux for `thinking`: vary answerThinking across both real values so
  // a hardcoded 'high' (or 'disabled') couldn't slip through unnoticed.
  it('forwards answerThinking to the answers call when set to disabled', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runAnswersStage(
      ctx,
      baseOptions({ outDir: dir, answerThinking: 'disabled' }),
      makeCorpus()
    );
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ thinking: string }];
      expect(request.thinking).toBe('disabled');
    }
  });

  it('forwards answerThinking to the answers call when set to high', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runAnswersStage(ctx, baseOptions({ outDir: dir, answerThinking: 'high' }), makeCorpus());
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ thinking: string }];
      expect(request.thinking).toBe('high');
    }
  });

  // Canary (F3): a bare `continue` on an orphaned question (no increment)
  // must redden this test — reverting to it drops `orphanedQuestions` back
  // to 0 while the answer count stays correct, which is exactly what the
  // finding caught.
  it('skips a question whose rowId is no longer in the corpus and counts it as orphaned', async () => {
    writeStageFile(stagePath(dir, 'nova', 'questions'), {
      questions: [
        { rowId: 'm1', q: 'what did Nova say?', a: 'hello', basis: 'assistant' },
        { rowId: 'gone', q: 'orphaned question', a: 'n/a', basis: 'assistant' },
      ],
      droppedMalformed: 0,
    });
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    logSpy.mockRestore();

    // Only the in-corpus question's 3 arms were answered — the orphaned
    // question generated no tasks at all.
    expect(callChatCompletionMock).toHaveBeenCalledTimes(3);
    const results = readStageFile<{ orphanedQuestions: number }>(stagePath(dir, 'nova', 'answers'));
    expect(results?.orphanedQuestions).toBe(1);
  });

  // Canary (F4): flipping `result.finishReason === 'length'` at the write
  // site must redden this test.
  it('marks an answer truncated when finishReason is "length"', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: 'length',
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    const results = readStageFile<{ answers: { truncated: boolean }[] }>(
      stagePath(dir, 'nova', 'answers')
    );
    expect(results?.answers.every(r => r.truncated === true)).toBe(true);
  });

  it('marks an answer not truncated when finishReason is "stop"', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: 'stop',
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    const results = readStageFile<{ answers: { truncated: boolean }[] }>(
      stagePath(dir, 'nova', 'answers')
    );
    expect(results?.answers.every(r => r.truncated === false)).toBe(true);
  });

  it('judges answers, summaries, and facts using the judge model', async () => {
    writeStageFile(stagePath(dir, 'nova', 'answers'), {
      answers: [
        {
          rowId: 'm1',
          question: 'q',
          referenceAnswer: 'a',
          basis: 'assistant',
          arm: 'V',
          reply: 'reply text',
          tailTokens: 5,
        },
      ],
      failures: [],
    });
    writeStageFile(stagePath(dir, 'nova', 'summaries'), {
      summaries: [
        {
          rowId: 'm1',
          summary: 'a summary',
          tokens: 10,
          state: 'within_soft',
          hasFirstPerson: false,
        },
      ],
      failures: [],
    });
    callChatCompletionMock.mockResolvedValue({
      content:
        '{"correct": true, "faithful": true, "unsupported_claims": [], "missing_commitments": [], "dangling_reference": false}',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'openrouter',
    } satisfies CompletionResult);
    await runJudgeStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [
        { model: string; temperature: number; maxTokens: number; jsonMode: boolean },
      ];
      expect(request.model).toBe('judge-model');
      expect(request.temperature).toBe(0);
      expect(request.maxTokens).toBe(2000);
      expect(request.jsonMode).toBe(true);
    }
    const result = readStageFile<{ answers: unknown[]; summaries: unknown[]; facts: unknown[] }>(
      stagePath(dir, 'nova', 'judge')
    );
    expect(result?.answers).toHaveLength(1);
    expect(result?.summaries).toHaveLength(1);
    expect(result?.facts).toHaveLength(1);
  });

  // Wiring pin: the judge stage is hardcoded to 'openrouter' regardless of
  // glmProvider — this is what keeps the judge family off the flat-rate GLM
  // plan. Setting glmProvider to 'zai-coding' here is the point: if the judge
  // call ever started forwarding glmProvider instead of the hardcoded value,
  // this would be the only test to catch it.
  it('hardcodes judge calls to openrouter even when glmProvider is zai-coding, with no thinking setting', async () => {
    writeStageFile(stagePath(dir, 'nova', 'answers'), {
      answers: [
        {
          rowId: 'm1',
          question: 'q',
          referenceAnswer: 'a',
          basis: 'assistant',
          arm: 'V',
          reply: 'reply text',
          tailTokens: 5,
        },
      ],
      failures: [],
    });
    writeStageFile(stagePath(dir, 'nova', 'summaries'), {
      summaries: [
        {
          rowId: 'm1',
          summary: 'a summary',
          tokens: 10,
          state: 'within_soft',
          hasFirstPerson: false,
        },
      ],
      failures: [],
    });
    callChatCompletionMock.mockResolvedValue({
      content:
        '{"correct": true, "faithful": true, "unsupported_claims": [], "missing_commitments": [], "dangling_reference": false}',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'openrouter',
    } satisfies CompletionResult);
    await runJudgeStage(ctx, baseOptions({ outDir: dir, glmProvider: 'zai-coding' }), makeCorpus());
    expect(callChatCompletionMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ provider: string; thinking?: string }];
      expect(request.provider).toBe('openrouter');
      expect(request.thinking).toBeUndefined();
    }
  });

  // Canary (B6): the judge stage must run answer/summary/facts judgements
  // through ONE shared concurrency pool. Three separate pools (one per
  // family) would each independently respect the cap while their UNION
  // triples the true in-flight bound — this test catches that regression by
  // measuring the actual high-water mark across all three families at once.
  it('never runs more in-flight judge calls than options.concurrency, across all three judge families', async () => {
    const rowCount = 4;
    const corpus = makeCorpus();
    corpus.rows = Array.from({ length: rowCount }, (_, i) => ({
      ...corpus.rows[0],
      id: `m${String(i)}`,
    }));
    writeStageFile(stagePath(dir, 'nova', 'answers'), {
      answers: corpus.rows.map(row => ({
        rowId: row.id,
        question: 'q',
        referenceAnswer: 'a',
        basis: 'assistant' as const,
        arm: 'V' as const,
        reply: 'reply text',
        tailTokens: 5,
      })),
      failures: [],
    });
    writeStageFile(stagePath(dir, 'nova', 'summaries'), {
      summaries: corpus.rows.map(row => ({
        rowId: row.id,
        summary: 'a summary',
        tokens: 10,
        state: 'within_soft',
        hasFirstPerson: false,
      })),
      failures: [],
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: (() => void)[] = [];
    callChatCompletionMock.mockImplementation(
      () =>
        new Promise(resolve => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve({
              content:
                '{"correct": true, "faithful": true, "unsupported_claims": [], "missing_commitments": []}',
              promptTokens: 10,
              completionTokens: 5,
              latencyMs: 10,
              attempts: 1,
              reasoningBlocksStripped: 0,
              finishReason: null,
              provider: 'openrouter',
            } satisfies CompletionResult);
          });
        })
    );

    const concurrency = 2;
    const totalCalls = rowCount * 3; // one answer judge + one summary judge + one facts judge per row
    const promise = runJudgeStage(ctx, baseOptions({ outDir: dir, concurrency }), corpus);
    for (let i = 0; i < totalCalls; i++) {
      while (resolvers.length <= i) {
        await Promise.resolve();
      }
      resolvers[i]();
    }
    await promise;

    expect(maxInFlight).toBeLessThanOrEqual(concurrency);
  });
});
