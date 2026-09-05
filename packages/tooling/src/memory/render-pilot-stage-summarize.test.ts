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

import {
  runSummariesStage,
  runQuestionsStage,
  loadSummaryByRowId,
} from './render-pilot-stage-summarize.js';
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
    outDir: '',
    stage: 'all',
    concurrency: 4,
    dryRun: false,
    ...overrides,
  };
}

describe('render-pilot summarize/questions stages', () => {
  let dir: string;
  let ctx: SlugContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-pilot-summarize-'));
    ctx = {
      slug: 'nova',
      outDir: dir,
      usageLogPath: join(dir, 'nova', 'usage.jsonl'),
      apiKey: 'sk-test',
    };
    callOpenRouterMock.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runSummariesStage writes one summary record per row, asserting the seam it crosses', async () => {
    callOpenRouterMock.mockResolvedValue({
      content: '{"summary": "Alice greeted Nova."}',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
    });
    const options = baseOptions({ outDir: dir });
    await runSummariesStage(ctx, options, makeCorpus());

    expect(callOpenRouterMock).toHaveBeenCalledTimes(1);
    const [request] = callOpenRouterMock.mock.calls[0] as [
      { model: string; messages: { content: string }[] },
    ];
    expect(request.model).toBe('s');
    expect(request.messages[1].content).toContain('Alice: hi');

    const result = readStageFile<{ summaries: { rowId: string; summary: string }[] }>(
      stagePath(dir, 'nova', 'summaries')
    );
    expect(result?.summaries).toEqual([
      expect.objectContaining({ rowId: 'm1', summary: 'Alice greeted Nova.' }),
    ]);
  });

  it('retries once when the summary exceeds the soft cap, keeping the shorter candidate', async () => {
    callOpenRouterMock
      .mockResolvedValueOnce({
        content: `{"summary": "${'word '.repeat(80)}"}`,
        promptTokens: 10,
        completionTokens: 80,
        latencyMs: 10,
        attempts: 1,
      })
      .mockResolvedValueOnce({
        content: '{"summary": "short one"}',
        promptTokens: 10,
        completionTokens: 5,
        latencyMs: 10,
        attempts: 1,
      });
    await runSummariesStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    expect(callOpenRouterMock).toHaveBeenCalledTimes(2);
    const result = readStageFile<{ summaries: { summary: string; state: string }[] }>(
      stagePath(dir, 'nova', 'summaries')
    );
    expect(result?.summaries[0].summary).toBe('short one');
    expect(result?.summaries[0].state).toBe('regenerated');

    // Canary (F3): the tighten retry must show the model its own over-length
    // draft — dropping the interpolation in buildTightenMessage reddens this.
    const retryCall = callOpenRouterMock.mock.calls[1] as [
      { messages: { content: string }[] },
      string,
    ];
    const retryRequest = retryCall[0];
    const tightenMessage = retryRequest.messages[retryRequest.messages.length - 1].content;
    expect(tightenMessage).toContain('word word word');
  });

  it('records a failed summarizer call without sinking the other rows, and writes it to the stage file', async () => {
    const corpus = makeCorpus();
    corpus.rows.push({ ...corpus.rows[0], id: 'm2', subjectName: 'Bob' });
    callOpenRouterMock.mockImplementation((request: { messages: { content: string }[] }) => {
      if (request.messages[1].content.includes('Bob')) {
        return Promise.reject(new Error('exhausted the token budget'));
      }
      return Promise.resolve({
        content: '{"summary": "Alice greeted Nova."}',
        promptTokens: 10,
        completionTokens: 5,
        latencyMs: 10,
        attempts: 1,
      });
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runSummariesStage(ctx, baseOptions({ outDir: dir }), corpus);

    const result = readStageFile<{
      summaries: { rowId: string }[];
      failures: { index: number; rowId?: string; error: string }[];
    }>(stagePath(dir, 'nova', 'summaries'));
    expect(result?.summaries).toEqual([expect.objectContaining({ rowId: 'm1' })]);
    expect(result?.failures).toEqual([
      { index: 1, rowId: 'm2', error: 'exhausted the token budget' },
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('stage summaries: 1 call(s) failed')
    );
    logSpy.mockRestore();
  });

  it('skips a cached stage under --stage all', async () => {
    writeStageFile(stagePath(dir, 'nova', 'summaries'), { summaries: [], failures: [] });
    await runSummariesStage(ctx, baseOptions({ outDir: dir, stage: 'all' }), makeCorpus());
    expect(callOpenRouterMock).not.toHaveBeenCalled();
  });

  it('runQuestionsStage generates questions with the judge model, dropping malformed entries', async () => {
    callOpenRouterMock.mockResolvedValue({
      content:
        '{"questions": [{"q": "what did Nova say?", "a": "hello", "basis": "assistant"}, {"q": "bad"}]}',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
    });
    await runQuestionsStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    const [request] = callOpenRouterMock.mock.calls[0] as [{ model: string }];
    expect(request.model).toBe('j');
    const result = readStageFile<{ questions: { q: string }[]; droppedMalformed: number }>(
      stagePath(dir, 'nova', 'questions')
    );
    expect(result?.questions).toEqual([
      expect.objectContaining({ q: 'what did Nova say?', basis: 'assistant' }),
    ]);
    expect(result?.droppedMalformed).toBe(1);
  });
});

describe('loadSummaryByRowId', () => {
  it('returns an empty map when no summaries stage file exists', () => {
    expect(loadSummaryByRowId('/nonexistent', 'nova').size).toBe(0);
  });
});
