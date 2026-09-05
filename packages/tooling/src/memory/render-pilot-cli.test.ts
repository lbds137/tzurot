import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '../utils/errors.js';
import { buildRenderPilotOptions, type RawRenderPilotOptions } from './render-pilot-cli.js';

function rawOptions(overrides: Partial<RawRenderPilotOptions> = {}): RawRenderPilotOptions {
  return {
    personality: 'nova',
    answerModel: 'answer-model',
    judgeModel: 'judge-model',
    summaryModel: 'summary-model',
    ...overrides,
  };
}

describe('buildRenderPilotOptions', () => {
  it('requires --personality', () => {
    expect(() => buildRenderPilotOptions(rawOptions({ personality: undefined }))).toThrow(
      UsageError
    );
  });

  it('requires each of the three model flags', () => {
    expect(() => buildRenderPilotOptions(rawOptions({ answerModel: undefined }))).toThrow(
      /--answer-model/
    );
    expect(() => buildRenderPilotOptions(rawOptions({ judgeModel: undefined }))).toThrow(
      /--judge-model/
    );
    expect(() => buildRenderPilotOptions(rawOptions({ summaryModel: undefined }))).toThrow(
      /--summary-model/
    );
  });

  it('parses comma-separated slugs, trimming whitespace', () => {
    const options = buildRenderPilotOptions(rawOptions({ personality: ' nova , luna ' }));
    expect(options.slugs).toEqual(['nova', 'luna']);
  });

  it('applies documented defaults', () => {
    const options = buildRenderPilotOptions(rawOptions());
    expect(options).toMatchObject({
      env: 'dev',
      largest: 20,
      latest: 20,
      questionsPerRow: 2,
      window: 10,
      voiceWindow: 20,
      outDir: 'reports/render-pilot',
      stage: 'all',
      concurrency: 4,
      dryRun: false,
    });
    expect(options.triggers.length).toBeGreaterThan(0);
    expect(options.markers).toEqual([]);
  });

  it('rejects a non-integer numeric flag', () => {
    expect(() => buildRenderPilotOptions(rawOptions({ largest: 'abc' }))).toThrow(UsageError);
  });

  it('rejects an unrecognized --stage value', () => {
    expect(() => buildRenderPilotOptions(rawOptions({ stage: 'bogus' }))).toThrow(/--stage/);
  });

  it('loads triggers and markers from JSON files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-pilot-cli-'));
    try {
      const triggersFile = join(dir, 'triggers.json');
      const markersFile = join(dir, 'markers.json');
      writeFileSync(triggersFile, JSON.stringify({ triggers: ['hi there'] }));
      writeFileSync(markersFile, JSON.stringify({ markers: ['darling'] }));
      const options = buildRenderPilotOptions(rawOptions({ triggersFile, markersFile }));
      expect(options.triggers).toEqual(['hi there']);
      expect(options.markers).toEqual(['darling']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a triggers file with the wrong shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-pilot-cli-'));
    try {
      const triggersFile = join(dir, 'triggers.json');
      writeFileSync(triggersFile, JSON.stringify({ triggers: [1, 2] }));
      expect(() => buildRenderPilotOptions(rawOptions({ triggersFile }))).toThrow(UsageError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
