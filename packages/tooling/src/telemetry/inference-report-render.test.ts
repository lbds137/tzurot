import { describe, it, expect } from 'vitest';
import { renderInferenceMarkdown, type InferenceReportData } from './inference-report-render.js';

function baseData(overrides: Partial<InferenceReportData> = {}): InferenceReportData {
  return {
    days: 30,
    env: 'local',
    generatedAt: new Date('2026-08-25T12:00:00.000Z'),
    perModel: [],
    freeTier: [],
    perPersonality: [],
    ...overrides,
  };
}

describe('renderInferenceMarkdown', () => {
  it('renders the header line and every section heading', () => {
    const output = renderInferenceMarkdown(baseData());
    expect(output).toContain('# Inference usage report');
    expect(output).toContain(
      'Window: trailing 30 days · env: local · generated at 2026-08-25T12:00:00.000Z'
    );
    expect(output).toContain('## Per provider/model');
    expect(output).toContain('## Free-tier spend proxy');
    expect(output).toContain('## Per-character attribution (top 15)');
    expect(output).toContain('## Limitations');
  });

  it('renders null latency values as an em dash, not 0', () => {
    const output = renderInferenceMarkdown(
      baseData({
        perModel: [
          {
            provider: 'openrouter',
            model: 'test-model',
            requests: 1,
            tokensIn: 10,
            tokensOut: 5,
            byokTrue: 0,
            byokFalse: 1,
            byokNull: 0,
            latencyMeasured: 0,
            latencyAvgMs: null,
            latencyP95Ms: null,
          },
        ],
      })
    );
    expect(output).toContain('| — | — |');
    expect(output).not.toMatch(/\| 0 \|\n?$/m);
  });

  it('includes the free-tier undercount caption', () => {
    const output = renderInferenceMarkdown(baseData());
    expect(output.toLowerCase()).toContain('lower bound');
    expect(output).toContain('byok IS NULL');
  });

  it('keeps same-named models from different providers as separate free-tier rows', () => {
    const output = renderInferenceMarkdown(
      baseData({
        freeTier: [
          { provider: 'openrouter', model: 'z-ai/glm-4.5', requests: 3, totalTokens: 300 },
          { provider: 'z-ai', model: 'z-ai/glm-4.5', requests: 2, totalTokens: 200 },
        ],
      })
    );
    expect(output).toContain('| openrouter | z-ai/glm-4.5 | 3 | 300 |');
    expect(output).toContain('| z-ai | z-ai/glm-4.5 | 2 | 200 |');
  });

  it('escapes user-controlled model strings in the per-model and free-tier tables', () => {
    const output = renderInferenceMarkdown(
      baseData({
        perModel: [
          {
            provider: 'openrouter',
            model: 'evil | 9 | 9\ninjected',
            requests: 1,
            tokensIn: 1,
            tokensOut: 1,
            byokTrue: 1,
            byokFalse: 0,
            byokNull: 0,
            latencyMeasured: 0,
            latencyAvgMs: null,
            latencyP95Ms: null,
          },
        ],
        freeTier: [
          { provider: 'openrouter', model: 'evil | 9 | 9\ninjected', requests: 1, totalTokens: 1 },
        ],
      })
    );
    expect(output).toContain('evil \\| 9 \\| 9 injected');
    expect(output).not.toContain('evil | 9 | 9');
  });

  it('escapes pipes and flattens newlines in user-controlled personality names', () => {
    const output = renderInferenceMarkdown(
      baseData({
        perPersonality: [
          { personalityName: 'Evil | Name\nSecond Line', requests: 2, totalTokens: 50 },
        ],
      })
    );
    expect(output).toContain('| Evil \\| Name Second Line | 2 | 50 |');
    expect(output).not.toContain('Evil | Name');
  });
});
