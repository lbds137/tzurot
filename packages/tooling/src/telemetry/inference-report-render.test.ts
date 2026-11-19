import { describe, it, expect } from 'vitest';
import { renderInferenceMarkdown, type InferenceReportData } from './inference-report-render.js';

function baseData(overrides: Partial<InferenceReportData> = {}): InferenceReportData {
  return {
    days: 30,
    env: 'local',
    generatedAt: new Date('2026-08-25T12:00:00.000Z'),
    perModel: [],
    cacheHitRate: [],
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

  it('renders the cache hit-rate table with percentages when cache data is reported', () => {
    const output = renderInferenceMarkdown(
      baseData({
        cacheHitRate: [
          {
            provider: 'z-ai',
            model: 'glm-4.6',
            requests: 10,
            tokensIn: 1000,
            cacheReportedCalls: 10,
            cacheReportedTokensIn: 1000,
            cacheHitCalls: 4,
            cacheReadTokens: 250,
            cacheWriteTokens: 600,
            hitCallShare: 0.4,
            readShare: 0.25,
          },
        ],
      })
    );
    expect(output).toContain('## Cache hit rate');
    expect(output).not.toContain('No cache token data reported in this window');
    expect(output).toContain(
      '| Provider | Model | Requests | Reported | Hit calls | Hit call share | Tokens in | Cache read | Cache write | Read share |'
    );
    expect(output).toContain('| z-ai | glm-4.6 | 10 | 10 | 4 | 40.0% | 1000 | 250 | 600 | 25.0% |');
  });

  it('renders the Reported call count column separately from total Requests on a mixed row', () => {
    const output = renderInferenceMarkdown(
      baseData({
        cacheHitRate: [
          {
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-4',
            requests: 10,
            tokensIn: 2000,
            cacheReportedCalls: 4,
            cacheReportedTokensIn: 500,
            cacheHitCalls: 2,
            cacheReadTokens: 250,
            cacheWriteTokens: 100,
            hitCallShare: 0.5,
            readShare: 0.5,
          },
        ],
      })
    );
    expect(output).toContain(
      '| openrouter | anthropic/claude-sonnet-4 | 10 | 4 | 2 | 50.0% | 2000 | 250 | 100 | 50.0% |'
    );
  });

  it('states honestly when all cache rows are null and renders em dashes instead of 0%', () => {
    const output = renderInferenceMarkdown(
      baseData({
        cacheHitRate: [
          {
            provider: 'openrouter',
            model: 'glm-4.6',
            requests: 8,
            tokensIn: 800,
            cacheReportedCalls: 0,
            cacheReportedTokensIn: null,
            cacheHitCalls: 0,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            hitCallShare: null,
            readShare: null,
          },
        ],
      })
    );
    expect(output).toContain('## Cache hit rate');
    expect(output).toContain('No cache token data reported in this window');
    expect(output).not.toContain('No cache rows in this window.');
    expect(output).toContain('| openrouter | glm-4.6 | 8 | 0 | 0 | — | 800 | — | — | — |');
  });

  it('renders the zero-rows caption instead of the all-NULL caption when cacheHitRate is empty', () => {
    const output = renderInferenceMarkdown(baseData({ cacheHitRate: [] }));
    expect(output).toContain('## Cache hit rate');
    expect(output).toContain('No cache rows in this window.');
    expect(output).not.toContain('No cache token data reported in this window');
    expect(output).toContain(
      'Cache tokens share the same limit — only chat `llm_generation` rows populate them; other writers and pre-migration rows are NULL and are excluded from the hit-rate denominators.'
    );
  });

  it('renders the unavailable caption when cacheHitRate is null (pre-migration schema)', () => {
    const output = renderInferenceMarkdown(baseData({ cacheHitRate: null }));
    expect(output).toContain('## Cache hit rate');
    expect(output).toContain(
      'Cache hit rate unavailable: this database predates the cache-token columns (run the migration).'
    );
    expect(output).not.toContain('No cache rows in this window.');
    expect(output).not.toContain('No cache token data reported in this window');
    expect(output).toContain(
      'Cache write totals come from the same read-reporting rows (`cache_read_tokens IS NOT NULL`); a row reporting only writes is excluded from the section.'
    );
  });

  it('documents that omitted zero cache counts on a miss shrink Reported relative to Requests', () => {
    const output = renderInferenceMarkdown(baseData());
    expect(output).toContain(
      'Providers that omit zero cache counts on a miss are indistinguishable from unreported rows — compare the `Reported` column to `Requests` when reading the hit-call share; a large gap means omitted zeros, not a writer bug.'
    );
  });
});
