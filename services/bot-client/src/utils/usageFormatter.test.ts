/**
 * Focused coverage for the z.ai plan section of the admin usage embed —
 * the rest of the formatter long predates its test file (structure-excluded
 * as a Formatter helper); this suite covers the new surface directly.
 */

import { describe, it, expect } from 'vitest';
import type { AdminUsageStats } from '@tzurot/common-types/schemas/api/usage';
import { buildAdminUsageEmbed } from './usageFormatter.js';

function baseStats(zaiPlan?: AdminUsageStats['zaiPlan']): AdminUsageStats {
  return {
    timeframe: '7d',
    periodStart: null,
    periodEnd: '2026-07-11T00:00:00.000Z',
    totalRequests: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalTokens: 0,
    uniqueUsers: 0,
    byProvider: {},
    byModel: {},
    byRequestType: {},
    topUsers: [],
    ...(zaiPlan !== undefined ? { zaiPlan } : {}),
  };
}

function fieldNames(stats: AdminUsageStats): string[] {
  return (buildAdminUsageEmbed(stats).data.fields ?? []).map(f => f.name);
}

describe('buildAdminUsageEmbed — z.ai plan section', () => {
  it('omits the section entirely when no snapshot is present', () => {
    expect(fieldNames(baseStats())).not.toContain('🧮 z.ai Coding Plan');
  });

  it('renders consumed percentage, reset countdown, and read time', () => {
    const embed = buildAdminUsageEmbed(
      baseStats({
        tighterWindowConsumedPct: 29,
        resetAt: '2026-07-11T13:00:00.000Z',
        fetchedAt: '2026-07-11T12:00:00.000Z',
      })
    );

    const field = (embed.data.fields ?? []).find(f => f.name === '🧮 z.ai Coding Plan');
    expect(field?.value).toContain('**29%** consumed');
    // Discord relative timestamps for both the reset and the reading age.
    expect(field?.value).toContain(
      `<t:${Math.floor(Date.parse('2026-07-11T13:00:00.000Z') / 1000)}:R>`
    );
    expect(field?.value).toContain(
      `<t:${Math.floor(Date.parse('2026-07-11T12:00:00.000Z') / 1000)}:R>`
    );
  });

  it('drops the reset line when the window carried no reset time', () => {
    const embed = buildAdminUsageEmbed(
      baseStats({
        tighterWindowConsumedPct: 2,
        resetAt: null,
        fetchedAt: '2026-07-11T12:00:00.000Z',
      })
    );

    const field = (embed.data.fields ?? []).find(f => f.name === '🧮 z.ai Coding Plan');
    expect(field?.value).toContain('**2%** consumed');
    expect(field?.value).not.toContain('Resets');
  });
});

describe('buildAdminUsageEmbed — top models rendering', () => {
  it('sanitizes a byModel key before it renders in bold', () => {
    const embed = buildAdminUsageEmbed({
      ...baseStats(),
      totalRequests: 1,
      byModel: { 'vendor/a[b]c': { requests: 1, tokensIn: 0, tokensOut: 0 } },
    });

    const field = (embed.data.fields ?? []).find(f => f.name === 'Top Models');
    expect(field?.value).toContain('**abc**');
    expect(field?.value).not.toContain('[');
  });
});

describe('buildAdminUsageEmbed — provider breakdown rendering', () => {
  function providerField(byProvider: AdminUsageStats['byProvider']): string | undefined {
    const embed = buildAdminUsageEmbed({ ...baseStats(), totalRequests: 1, byProvider });
    return (embed.data.fields ?? []).find(f => f.name === 'By Provider')?.value;
  }

  it('sanitizes a byProvider key before it renders in bold', () => {
    const value = providerField({
      '[x](http://evil.example)': { requests: 1, tokensIn: 0, tokensOut: 0 },
    });

    expect(value).toContain('**xhttp:evil.example**');
    expect(value).not.toContain('://');
    expect(value).not.toContain('[');
  });

  it('renders a real provider name unchanged', () => {
    const value = providerField({ 'zai-coding': { requests: 1, tokensIn: 0, tokensOut: 0 } });

    expect(value).toContain('**zai-coding**');
  });
});
