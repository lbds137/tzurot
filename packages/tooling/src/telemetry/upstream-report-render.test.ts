import { describe, it, expect } from 'vitest';
import {
  renderUpstreamMarkdown,
  type UpstreamReportData,
  type UpstreamStats,
} from './upstream-report-render.js';

function row(overrides: Partial<UpstreamStats> = {}): UpstreamStats {
  return {
    model: 'anthropic/claude-haiku-5.5',
    upstream: 'Anthropic',
    requests: 10,
    failed: 0,
    finishStop: 9,
    finishLength: 1,
    finishContentFilter: 0,
    finishError: 0,
    finishOther: 0,
    emptyReplies: 0,
    avgCompletionTokens: 120.4,
    ...overrides,
  };
}

function baseData(overrides: Partial<UpstreamReportData> = {}): UpstreamReportData {
  return {
    days: 7,
    env: 'dev',
    generatedAt: new Date('2026-08-25T12:00:00.000Z'),
    rows: [row()],
    ...overrides,
  };
}

/** Pull a table row's cells, trimmed, by the first cell's text (the model id). */
function cellsOf(output: string, firstCell: string): string[] {
  const line = output.split('\n').find(l => l.startsWith(`| ${firstCell} |`));
  if (line === undefined) {
    throw new Error(`no table row starting with ${firstCell}`);
  }
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map(cell => cell.trim());
}

describe('renderUpstreamMarkdown', () => {
  it('renders the title, window line, scope note and table heading', () => {
    const output = renderUpstreamMarkdown(baseData());
    expect(output).toContain('# OpenRouter upstream host report');
    expect(output).toContain(
      'Window: trailing 7 days · env: dev · generated at 2026-08-25T12:00:00.000Z'
    );
    expect(output).toContain('Intended scope: conversation path only');
    expect(output).toContain('telemetry:inference');
    expect(output).toContain('## Serving host per model');
    expect(output).toContain(
      '| Model | Upstream host | Requests | Failed | Share of model | stop | length | content_filter | error | other | Empty (incl. failed) | Avg out tokens |'
    );
  });

  it('says that Share of model counts (none) in its denominator', () => {
    const output = renderUpstreamMarkdown(baseData());
    expect(output).toContain(
      "Share of model counts (none) in its denominator, so named hosts' shares understate their share of served traffic."
    );
  });

  it('states the retention window from the shared constant, not a hardcoded 7', () => {
    const output = renderUpstreamMarkdown(baseData());
    expect(output).toContain('`llm_diagnostic_logs` keeps 7 days');
  });

  it('states the router-alias grouping and that the BYOK split lives elsewhere', () => {
    const output = renderUpstreamMarkdown(baseData());
    expect(output).toContain(
      'Model is the requested model id, so a router alias groups every host it routed to.'
    );
    expect(output).toContain('The diagnostic payload type has no BYOK field');
  });

  it('says that empty counts blank replies, including empty-after-retries failures', () => {
    const output = renderUpstreamMarkdown(baseData());
    expect(output).toContain('Empty counts blank replies, including empty-after-retries failures.');
  });

  it('says that thrown failures record no host and are counted under (none)', () => {
    const output = renderUpstreamMarkdown(baseData());
    expect(output).toContain(
      "Requests that failed with a thrown error record no upstream host and are counted under (none); a host's Failed column only counts failures that happened after a response arrived."
    );
  });

  it('says that a retried request is credited to its last recorded attempt', () => {
    const output = renderUpstreamMarkdown(baseData());
    expect(output).toContain(
      "A retried request is credited to the host of the last attempt that recorded a response; earlier attempts' hosts are not recorded."
    );
  });

  it('caps the window line at retention when the requested window is wider than 7 days', () => {
    const output = renderUpstreamMarkdown(baseData({ days: 30 }));
    expect(output).toContain(
      'Window: trailing 30 days requested (diagnostic retention caps the data at 7) · env: dev · generated at 2026-08-25T12:00:00.000Z'
    );
  });

  it('keeps the plain window line when the requested window is within retention', () => {
    const output = renderUpstreamMarkdown(baseData({ days: 3 }));
    expect(output).toContain(
      'Window: trailing 3 days · env: dev · generated at 2026-08-25T12:00:00.000Z'
    );
    expect(output).not.toContain('requested (diagnostic retention');
  });

  it('computes share of model from that model total, rounded to one decimal place', () => {
    const output = renderUpstreamMarkdown(
      baseData({
        rows: [
          row({ upstream: 'Anthropic', requests: 1 }),
          row({ upstream: 'Parasail', requests: 2 }),
        ],
      })
    );
    // 1 of 3 requests is 33.3%; 2 of 3 is 66.7%. Both rows share one model total.
    expect(cellsOf(output, 'anthropic/claude-haiku-5.5')[4]).toBe('33.3%');
    expect(output).toContain('| anthropic/claude-haiku-5.5 | Parasail | 2 | 0 | 66.7% |');
  });

  it('counts failed requests in the share denominator and their own column', () => {
    const output = renderUpstreamMarkdown(
      baseData({
        rows: [
          row({ upstream: 'Anthropic', requests: 6, failed: 2 }),
          row({ upstream: 'Parasail', requests: 4, failed: 0 }),
        ],
      })
    );
    const anthropic = cellsOf(output, 'anthropic/claude-haiku-5.5');
    expect(anthropic[2]).toBe('6');
    expect(anthropic[3]).toBe('2');
    expect(anthropic[4]).toBe('60.0%');
  });

  it('computes each model share independently, not over the whole window', () => {
    const output = renderUpstreamMarkdown(
      baseData({
        rows: [
          row({ model: 'model-a', upstream: 'Anthropic', requests: 4 }),
          row({ model: 'model-b', upstream: 'Parasail', requests: 1 }),
        ],
      })
    );
    expect(cellsOf(output, 'model-a')[4]).toBe('100.0%');
    expect(cellsOf(output, 'model-b')[4]).toBe('100.0%');
  });

  it('renders the (none) host label as-is for rows with no upstream recorded', () => {
    const output = renderUpstreamMarkdown(baseData({ rows: [row({ upstream: '(none)' })] }));
    expect(cellsOf(output, 'anthropic/claude-haiku-5.5')[1]).toBe('(none)');
  });

  it('renders a null average as an em dash, never 0', () => {
    const output = renderUpstreamMarkdown(baseData({ rows: [row({ avgCompletionTokens: null })] }));
    expect(cellsOf(output, 'anthropic/claude-haiku-5.5')[11]).toBe('—');
  });

  it('rounds a present average to a whole number of tokens', () => {
    const output = renderUpstreamMarkdown(
      baseData({ rows: [row({ avgCompletionTokens: 120.4 })] })
    );
    expect(cellsOf(output, 'anthropic/claude-haiku-5.5')[11]).toBe('120');
  });

  it('renders the finish-reason, error, and empty-reply counts in their columns', () => {
    const output = renderUpstreamMarkdown(
      baseData({
        rows: [
          row({
            requests: 10,
            finishStop: 6,
            finishLength: 2,
            finishContentFilter: 1,
            finishError: 1,
            finishOther: 1,
            emptyReplies: 3,
          }),
        ],
      })
    );
    expect(cellsOf(output, 'anthropic/claude-haiku-5.5').slice(5)).toEqual([
      '6',
      '2',
      '1',
      '1',
      '1',
      '3',
      '120',
    ]);
  });

  it('escapes a pipe in an upstream host name so it cannot break the row', () => {
    const output = renderUpstreamMarkdown(baseData({ rows: [row({ upstream: 'Evil|Host' })] }));
    expect(output).toContain('| anthropic/claude-haiku-5.5 | Evil\\|Host |');
    // The row keeps its full cell count: a raw pipe would add cells.
    expect(cellsOf(output, 'anthropic/claude-haiku-5.5')).toHaveLength(12);
  });

  it('flattens a newline in a model id so it cannot fabricate a row', () => {
    const output = renderUpstreamMarkdown(baseData({ rows: [row({ model: 'bad\nmodel' })] }));
    expect(output).toContain('| bad model |');
    expect(output).not.toMatch(/^model \|/m);
  });

  it('states the empty result in one line and renders no table when there are no rows', () => {
    const output = renderUpstreamMarkdown(baseData({ rows: [] }));
    expect(output).toContain('No OpenRouter diagnostic rows in this window.');
    expect(output).not.toContain('| Model | Upstream host |');
    expect(output).not.toContain('Distinct models');
  });

  it('counts distinct models and distinct hosts across rows', () => {
    const output = renderUpstreamMarkdown(
      baseData({
        rows: [
          row({ model: 'model-a', upstream: 'Anthropic' }),
          row({ model: 'model-a', upstream: 'Parasail' }),
          row({ model: 'model-b', upstream: 'Parasail' }),
        ],
      })
    );
    expect(output).toContain('Distinct models: 2 · distinct hosts: 2');
  });
});
