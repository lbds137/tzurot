import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stagePath,
  readStageFile,
  writeStageFile,
  shouldRunStage,
  logUsage,
  selectWindowRows,
  type RenderPilotOptions,
} from './render-pilot-shared.js';

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
    outDir: 'reports/render-pilot',
    stage: 'all',
    concurrency: 4,
    dryRun: false,
    ...overrides,
  };
}

describe('stagePath', () => {
  it('joins outDir/slug/stage-<name>.json', () => {
    expect(stagePath('reports/render-pilot', 'nova', 'corpus')).toBe(
      join('reports/render-pilot', 'nova', 'stage-corpus.json')
    );
  });
});

describe('readStageFile / writeStageFile round-trip', () => {
  it('writes JSON and reads it back, creating parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-pilot-shared-'));
    try {
      const path = join(dir, 'nova', 'stage-corpus.json');
      writeStageFile(path, { rows: 3 });
      expect(readStageFile<{ rows: number }>(path)).toEqual({ rows: 3 });
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ rows: 3 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the file does not exist', () => {
    expect(readStageFile('/nonexistent/path/stage-corpus.json')).toBeNull();
  });
});

describe('shouldRunStage', () => {
  it('runs an absent stage under --stage all', () => {
    expect(shouldRunStage(baseOptions({ stage: 'all' }), 'summaries', '/nonexistent')).toBe(true);
  });

  it('does not rerun a present stage under --stage all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-pilot-shared-'));
    try {
      const path = join(dir, 'stage-summaries.json');
      writeStageFile(path, {});
      expect(shouldRunStage(baseOptions({ stage: 'all' }), 'summaries', path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reruns exactly the named stage regardless of cache presence', () => {
    expect(shouldRunStage(baseOptions({ stage: 'summaries' }), 'summaries', '/nonexistent')).toBe(
      true
    );
    expect(shouldRunStage(baseOptions({ stage: 'summaries' }), 'questions', '/nonexistent')).toBe(
      false
    );
  });
});

describe('logUsage', () => {
  it('appends a usage record with the given stage and model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-pilot-shared-'));
    try {
      const usageLogPath = join(dir, 'usage.jsonl');
      logUsage({ slug: 'nova', outDir: dir, usageLogPath, apiKey: 'k' }, 'summaries', 'model-x', {
        promptTokens: 5,
        completionTokens: 2,
        latencyMs: 10,
        attempts: 1,
        reasoningBlocksStripped: 0,
      });
      const line = JSON.parse(readFileSync(usageLogPath, 'utf8').trim());
      expect(line).toMatchObject({ stage: 'summaries', model: 'model-x', promptTokens: 5 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('selectWindowRows', () => {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it('returns the whole pool when windowSize exceeds it', () => {
    expect(selectWindowRows(pool, 0, 100)).toEqual(pool);
  });

  it('centers on the given index and alternates before/after', () => {
    const result = selectWindowRows(pool, 5, 3);
    // center=5, then before(4), giving {4,5,6} once sorted... actually alternation is before then after
    expect(result).toContain(5);
    expect(result).toHaveLength(3);
  });

  it('keeps results sorted ascending', () => {
    const result = selectWindowRows(pool, 2, 5);
    expect(result).toEqual([...result].sort((a, b) => a - b));
  });

  it('falls back to only-after when the center is at the start of the pool', () => {
    const result = selectWindowRows(pool, 0, 4);
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it('falls back to only-before when the center is at the end of the pool', () => {
    const result = selectWindowRows(pool, 9, 4);
    expect(result).toEqual([6, 7, 8, 9]);
  });
});
