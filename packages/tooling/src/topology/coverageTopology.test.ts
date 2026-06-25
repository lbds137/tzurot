import { describe, it, expect } from 'vitest';
import { buildCoverageTopology, surfaceGap } from './coverageTopology.js';

describe('buildCoverageTopology (skeleton)', () => {
  it('seeds the context-assembly surface with the contract tier covered', () => {
    const topology = buildCoverageTopology();
    expect(topology.schema).toBe('coverage-topology/v0-skeleton');

    const surface = topology.surfaces.find(s => s.id === 'bot-client:ai-worker:context-assembly');
    expect(surface).toBeDefined();
    expect(surface?.kind).toBe('context-envelope');
    expect(surface?.producer).toBe('bot-client');
    expect(surface?.consumer).toBe('ai-worker');
    expect(surface?.requiredTiers).toContain('contract');
    // The golden-fixture contract covers the required tier → no gap.
    expect(surfaceGap(surface!)).toEqual([]);
  });
});

describe('surfaceGap', () => {
  it('lists required tiers not present in actual', () => {
    expect(
      surfaceGap({
        id: 'x',
        kind: 'bullmq-job',
        producer: 'a',
        consumer: 'b',
        schemaRef: 's',
        requiredTiers: ['contract', 'component'],
        actualTiers: ['component'],
      })
    ).toEqual(['contract']);
  });
});
