import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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

import { runVoiceStage, runReportStage } from './render-pilot-stage-voice.js';
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
    triggers: ['hi there', 'how are you'],
    markers: ['darling'],
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

describe('runVoiceStage', () => {
  let dir: string;
  let ctx: SlugContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-pilot-voice-'));
    ctx = {
      slug: 'nova',
      outDir: dir,
      usageLogPath: join(dir, 'nova', 'usage.jsonl'),
      apiKeys: { openrouter: 'sk-test', 'zai-coding': 'sk-test' },
    };
    callChatCompletionMock.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs n = triggers x 3 arms calls using the answer model, recording n in the output', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply, darling!',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runVoiceStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    expect(callChatCompletionMock).toHaveBeenCalledTimes(6);
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ model: string }];
      expect(request.model).toBe('answer-model');
    }
    const result = readStageFile<{ n: number; replies: { markerHits: number }[] }>(
      stagePath(dir, 'nova', 'voice')
    );
    expect(result?.n).toBe(6);
    expect(result?.replies[0].markerHits).toBe(1);
  });

  // Wiring pin: the voice stage must forward options.glmProvider to the
  // call's `provider` field, not a hardcoded value. Asserting only the
  // default ('zai-coding') would also pass against a hardcoded
  // `provider: 'zai-coding'` — vary the option and check both values track
  // it. The voice stage never sends a `thinking` setting at all, so that
  // stays undefined regardless of glmProvider.
  it('forwards glmProvider to the voice call when set to zai-coding, with no thinking setting', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply, darling!',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'zai-coding',
    } satisfies CompletionResult);
    await runVoiceStage(ctx, baseOptions({ outDir: dir, glmProvider: 'zai-coding' }), makeCorpus());
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ provider: string; thinking?: string }];
      expect(request.provider).toBe('zai-coding');
      expect(request.thinking).toBeUndefined();
    }
  });

  it('forwards glmProvider to the voice call when set to openrouter, with no thinking setting', async () => {
    callChatCompletionMock.mockResolvedValue({
      content: 'a reply, darling!',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
      reasoningBlocksStripped: 0,
      finishReason: null,
      provider: 'openrouter',
    } satisfies CompletionResult);
    await runVoiceStage(ctx, baseOptions({ outDir: dir, glmProvider: 'openrouter' }), makeCorpus());
    for (const call of callChatCompletionMock.mock.calls) {
      const [request] = call as [{ provider: string; thinking?: string }];
      expect(request.provider).toBe('openrouter');
      expect(request.thinking).toBeUndefined();
    }
  });
});

describe('runReportStage', () => {
  let dir: string;
  let ctx: SlugContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-pilot-report-'));
    ctx = {
      slug: 'nova',
      outDir: dir,
      usageLogPath: join(dir, 'nova', 'usage.jsonl'),
      apiKeys: { openrouter: 'sk-test', 'zai-coding': 'sk-test' },
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a per-slug report.json (may carry text) and a LOCAL-ONLY spot-check.md', () => {
    const SENTINEL = 'SENTINEL-report-leak-check';
    const corpus = makeCorpus();
    corpus.rows[0].split.user = SENTINEL;
    writeStageFile(stagePath(dir, 'nova', 'judge'), {
      answers: [
        {
          arm: 'V',
          basis: 'assistant',
          judged: true,
          correct: true,
          faithful: true,
          unsupportedClaims: [],
          tailTokens: 5,
          reply: SENTINEL,
        },
      ],
      summaries: [],
      facts: [],
      failures: [],
    });

    return runReportStage(ctx, corpus).then(() => {
      // report.json is a per-slug LOCAL cache file — it is EXPECTED to carry
      // text; the no-leak contract applies to the pooled summary.json/summary.md
      // built in render-pilot.ts from this file, not to this file itself.
      const reportJson = readFileSync(join(dir, 'nova', 'stage-report.json'), 'utf8');
      expect(reportJson).toContain(SENTINEL);

      const spotCheck = readFileSync(join(dir, 'nova', 'spot-check.md'), 'utf8');
      expect(spotCheck).toContain('LOCAL-ONLY');
      expect(spotCheck).toContain(SENTINEL);
      // Canary (B1): a JSON-encoded spot-check file would show `\\n`, never a
      // real newline, for its multi-line body.
      expect(spotCheck.startsWith('# Spot check')).toBe(true);
      expect(spotCheck).not.toContain('\\n');
    });
  });

  // Canary (F5f): reverting the spot-check `renderS` value back to
  // `renderNoteS` with an empty summary must redden this test.
  it('renders the no-summary placeholder in the spot-check file for a row with no cached summary', async () => {
    const corpus = makeCorpus();
    writeStageFile(stagePath(dir, 'nova', 'judge'), {
      answers: [],
      summaries: [],
      facts: [],
      failures: [],
    });
    // No stage-summaries.json written at all — summaryByRowId is empty for every row.
    await runReportStage(ctx, corpus);
    const spotCheck = readFileSync(join(dir, 'nova', 'spot-check.md'), 'utf8');
    expect(spotCheck).toContain('(no summary — arm S rendered as F)');
  });
});
