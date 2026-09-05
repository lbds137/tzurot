import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CorpusResult } from './render-pilot-corpus.js';
import type { RenderPilotOptions, SlugContext } from './render-pilot-shared.js';

const { callOpenRouterMock } = vi.hoisted(() => ({ callOpenRouterMock: vi.fn() }));

vi.mock('./render-pilot-llm.js', async () => {
  const actual =
    await vi.importActual<typeof import('./render-pilot-llm.js')>('./render-pilot-llm.js');
  return { ...actual, callOpenRouter: callOpenRouterMock, requireApiKey: () => 'sk-test' };
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
      apiKey: 'sk-test',
    };
    callOpenRouterMock.mockReset();
    writeStageFile(stagePath(dir, 'nova', 'questions'), {
      questions: [{ rowId: 'm1', q: 'what did Nova say?', a: 'hello', basis: 'assistant' }],
      droppedMalformed: 0,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers each question in all three arms using the answer model', async () => {
    callOpenRouterMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
    });
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    expect(callOpenRouterMock).toHaveBeenCalledTimes(3);
    for (const call of callOpenRouterMock.mock.calls) {
      const [request] = call as [{ model: string }];
      expect(request.model).toBe('answer-model');
    }
    const results = readStageFile<{ arm: string }[]>(stagePath(dir, 'nova', 'answers'));
    expect(results?.map(r => r.arm).sort()).toEqual(['F', 'S', 'V']);
  });

  // Canary (F4): flipping `result.finishReason === 'length'` at the write
  // site must redden this test.
  it('marks an answer truncated when finishReason is "length"', async () => {
    callOpenRouterMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      finishReason: 'length',
    });
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    const results = readStageFile<{ truncated: boolean }[]>(stagePath(dir, 'nova', 'answers'));
    expect(results?.every(r => r.truncated === true)).toBe(true);
  });

  it('marks an answer not truncated when finishReason is "stop"', async () => {
    callOpenRouterMock.mockResolvedValue({
      content: 'a reply',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      finishReason: 'stop',
    });
    await runAnswersStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    const results = readStageFile<{ truncated: boolean }[]>(stagePath(dir, 'nova', 'answers'));
    expect(results?.every(r => r.truncated === false)).toBe(true);
  });

  it('judges answers, summaries, and facts using the judge model', async () => {
    writeStageFile(stagePath(dir, 'nova', 'answers'), [
      {
        rowId: 'm1',
        question: 'q',
        referenceAnswer: 'a',
        basis: 'assistant',
        arm: 'V',
        reply: 'reply text',
        tailTokens: 5,
      },
    ]);
    writeStageFile(stagePath(dir, 'nova', 'summaries'), [
      {
        rowId: 'm1',
        summary: 'a summary',
        tokens: 10,
        state: 'within_soft',
        hasFirstPerson: false,
      },
    ]);
    callOpenRouterMock.mockResolvedValue({
      content:
        '{"correct": true, "faithful": true, "unsupported_claims": [], "missing_commitments": [], "dangling_reference": false}',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
    });
    await runJudgeStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    for (const call of callOpenRouterMock.mock.calls) {
      const [request] = call as [{ model: string }];
      expect(request.model).toBe('judge-model');
    }
    const result = readStageFile<{ answers: unknown[]; summaries: unknown[]; facts: unknown[] }>(
      stagePath(dir, 'nova', 'judge')
    );
    expect(result?.answers).toHaveLength(1);
    expect(result?.summaries).toHaveLength(1);
    expect(result?.facts).toHaveLength(1);
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
    writeStageFile(
      stagePath(dir, 'nova', 'answers'),
      corpus.rows.map(row => ({
        rowId: row.id,
        question: 'q',
        referenceAnswer: 'a',
        basis: 'assistant' as const,
        arm: 'V' as const,
        reply: 'reply text',
        tailTokens: 5,
      }))
    );
    writeStageFile(
      stagePath(dir, 'nova', 'summaries'),
      corpus.rows.map(row => ({
        rowId: row.id,
        summary: 'a summary',
        tokens: 10,
        state: 'within_soft',
        hasFirstPerson: false,
      }))
    );

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: (() => void)[] = [];
    callOpenRouterMock.mockImplementation(
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
            });
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
