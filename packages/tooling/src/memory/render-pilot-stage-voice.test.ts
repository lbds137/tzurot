import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
      apiKey: 'sk-test',
    };
    callOpenRouterMock.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs n = triggers x 3 arms calls using the answer model, recording n in the output', async () => {
    callOpenRouterMock.mockResolvedValue({
      content: 'a reply, darling!',
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 10,
      attempts: 1,
    });
    await runVoiceStage(ctx, baseOptions({ outDir: dir }), makeCorpus());
    expect(callOpenRouterMock).toHaveBeenCalledTimes(6);
    for (const call of callOpenRouterMock.mock.calls) {
      const [request] = call as [{ model: string }];
      expect(request.model).toBe('answer-model');
    }
    const result = readStageFile<{ n: number; replies: { markerHits: number }[] }>(
      stagePath(dir, 'nova', 'voice')
    );
    expect(result?.n).toBe(6);
    expect(result?.replies[0].markerHits).toBe(1);
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
      apiKey: 'sk-test',
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
});
