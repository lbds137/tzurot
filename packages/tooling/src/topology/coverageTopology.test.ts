import { describe, it, expect } from 'vitest';
import { ROUTE_MANIFEST } from '@tzurot/clients';
import { JobType } from '@tzurot/common-types';
import { generateCoverageTopology, surfaceGap } from './coverageTopology.js';

describe('generateCoverageTopology', () => {
  const topology = generateCoverageTopology();

  it('is the v1 schema with surfaces sorted by id', () => {
    expect(topology.schema).toBe('coverage-topology/v1');
    const ids = topology.surfaces.map(s => s.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('enumerates one surface per ROUTE_MANIFEST route (http-route / route-conformance)', () => {
    const routeSurfaces = topology.surfaces.filter(s => s.kind === 'http-route');
    expect(routeSurfaces.length).toBe(Object.keys(ROUTE_MANIFEST).length);
    expect(routeSurfaces.every(s => s.mechanism === 'route-conformance')).toBe(true);
    expect(routeSurfaces.every(s => s.consumer === 'api-gateway')).toBe(true);
  });

  it('enumerates the three payload-bearing BullMQ jobs (bullmq-contract)', () => {
    const jobSurfaces = topology.surfaces.filter(s => s.kind === 'bullmq-job');
    // Build expected ids from the enum so a JobType value rename is caught.
    const expected = [
      `api-gateway:ai-worker:${JobType.AudioTranscription}`,
      `api-gateway:ai-worker:${JobType.ImageDescription}`,
      `api-gateway:ai-worker:${JobType.LLMGeneration}`,
    ].sort();
    expect(jobSurfaces.map(s => s.id).sort()).toEqual(expected);
    expect(jobSurfaces.every(s => s.mechanism === 'bullmq-contract')).toBe(true);
  });

  it('includes the context-assembly envelope (golden-fixture)', () => {
    const envelope = topology.surfaces.find(s => s.kind === 'context-envelope');
    expect(envelope?.id).toBe('bot-client:ai-worker:context-assembly');
    expect(envelope?.mechanism).toBe('golden-fixture');
    expect(envelope?.schemaRef).toBe('rawAssemblyInputsSchema');
  });

  it('requires each surface the tier its mechanism provides (route→component, job/envelope→contract)', () => {
    for (const s of topology.surfaces) {
      const expected = s.mechanism === 'route-conformance' ? 'component' : 'contract';
      expect(s.requiredTiers).toEqual([expected]);
    }
  });

  it('reports no gaps in the optimistic 2a topology (mechanism assumed present)', () => {
    // 2a is optimistic — actualTiers === requiredTiers per mechanism. The real
    // gap signal (mechanism-test absent) arrives with 2b's presence verification.
    expect(topology.surfaces.filter(s => surfaceGap(s).length > 0)).toEqual([]);
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
        mechanism: 'bullmq-contract',
        requiredTiers: ['contract', 'component'],
        actualTiers: ['component'],
      })
    ).toEqual(['contract']);
  });
});
