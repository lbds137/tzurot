import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROUTE_MANIFEST } from '@tzurot/clients';
import { JobType } from '@tzurot/common-types/constants/queue';
import {
  generateCoverageTopology,
  surfaceGap,
  checkCoverageTopology,
  writeCoverageTopology,
  COVERAGE_TOPOLOGY_PATH,
  EXEMPT_ROUTE_IDS,
} from './coverageTopology.js';
import { clearFileImportCache } from './importAssertions.js';

describe('generateCoverageTopology', () => {
  // Default root resolves to the repo root, so presence checks run against the
  // real mechanism files (all shipped) — see the gap tests below.
  const topology = generateCoverageTopology();

  it('is the v1 schema with surfaces sorted by id', () => {
    expect(topology.schema).toBe('coverage-topology/v1');
    const ids = topology.surfaces.map(s => s.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('enumerates one surface per non-exempt ROUTE_MANIFEST route (route-conformance)', () => {
    const routeSurfaces = topology.surfaces.filter(s => s.kind === 'http-route');
    expect(routeSurfaces.length).toBe(Object.keys(ROUTE_MANIFEST).length - EXEMPT_ROUTE_IDS.length);
    expect(routeSurfaces.every(s => s.mechanism === 'route-conformance')).toBe(true);
    expect(routeSurfaces.every(s => s.producer === 'client')).toBe(true);
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
    expect(jobSurfaces.every(s => s.producer === 'api-gateway' && s.consumer === 'ai-worker')).toBe(
      true
    );
  });

  it('includes the context-assembly envelope (golden-fixture, bot-client→ai-worker)', () => {
    const envelope = topology.surfaces.find(s => s.kind === 'context-envelope');
    expect(envelope?.id).toBe('bot-client:ai-worker:context-assembly');
    expect(envelope?.mechanism).toBe('golden-fixture');
    expect(envelope?.schemaRef).toBe('rawAssemblyInputsSchema');
    expect(envelope?.producer).toBe('bot-client');
    expect(envelope?.consumer).toBe('ai-worker');
  });

  it('requires each surface the tier its mechanism provides (route→component, job/envelope→contract)', () => {
    for (const s of topology.surfaces) {
      const expected = s.mechanism === 'route-conformance' ? 'component' : 'contract';
      expect(s.requiredTiers).toEqual([expected]);
    }
  });

  it('verifies mechanism presence: every surface is covered in this repo', () => {
    // The conformance harness, BullMQ contract tests, and golden-fixture all
    // exist, so actualTiers === requiredTiers and no surface shows a gap.
    expect(topology.surfaces.every(s => s.actualTiers.length === 1)).toBe(true);
    expect(topology.surfaces.filter(s => surfaceGap(s).length > 0)).toEqual([]);
  });

  it('downgrades actualTiers to empty (a real gap) when a mechanism test is absent', () => {
    // A root with none of the mechanism files → every surface gaps. Proves the
    // presence verification (not an optimistic assumption) drives actualTiers.
    const empty = generateCoverageTopology('/tmp/__no_such_tzurot_root__');
    expect(empty.surfaces.length).toBe(topology.surfaces.length);
    expect(empty.surfaces.every(s => s.actualTiers.length === 0)).toBe(true);
    expect(empty.surfaces.every(s => surfaceGap(s).length === 1)).toBe(true);
  });

  it('flags a CIRCULAR bullmq test (schemas referenced, but producer never imports createJobChain) as a gap', () => {
    // The execution-check's whole point: the OLD presence check ("a schema
    // safeParse appears") marks the jobs covered even for a circular test that
    // hand-rolls its payload. The producer-import requirement closes that — schema
    // present AND producer imports the REAL createJobChain.
    const tmpRoot = mkdtempSync(join(tmpdir(), 'topo-circular-'));
    const bullmqJobs = (root: string) =>
      generateCoverageTopology(root).surfaces.filter(s => s.kind === 'bullmq-job');
    const producerPath = join(
      tmpRoot,
      'services/api-gateway/src/utils/BullMQJobChainContract.producer.test.ts'
    );
    // Clear before the try (not in finally) for a known-empty starting state. No
    // finally-clear needed: tmpRoot paths are distinct from real project paths, so
    // the entries left here don't interfere with checkCoverageTopology's real-path
    // reads (those cache-miss and re-read fresh).
    clearFileImportCache();
    try {
      // A consumer-side contract test referencing all three job schemas — enough
      // for the old presence check to consider the jobs covered.
      const contractDir = join(tmpRoot, 'tests/e2e/contracts');
      mkdirSync(contractDir, { recursive: true });
      writeFileSync(
        join(contractDir, 'jobs.contract.test.ts'),
        'audioTranscriptionJobDataSchema.safeParse(x);\n' +
          'imageDescriptionJobDataSchema.safeParse(x);\n' +
          'llmGenerationJobDataSchema.parse(x);\n'
      );
      mkdirSync(dirname(producerPath), { recursive: true });

      // Circular: the producer hand-rolls a payload, importing the SCHEMA but never
      // the real createJobChain. All three job surfaces must still gap.
      writeFileSync(
        producerPath,
        "import { llmGenerationJobDataSchema } from '@tzurot/common-types';\n"
      );
      expect(bullmqJobs(tmpRoot).every(s => surfaceGap(s).length === 1)).toBe(true);

      // Contrast: import the real producer → the jobs are now covered. (Clear the
      // per-path import cache between the two reads of the same file.)
      clearFileImportCache();
      writeFileSync(
        producerPath,
        "import { createJobChain } from './jobChainOrchestrator.js';\ncreateJobChain();\n"
      );
      expect(bullmqJobs(tmpRoot).every(s => s.actualTiers.length === 1)).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('checkCoverageTopology', () => {
  it('reports up-to-date for the committed artifact (the real CI-gate happy path)', () => {
    // Default root = repo root → compares the committed coverage-topology.json
    // against a fresh generation. This is the exact assertion the CI gate makes,
    // so a drifted committed artifact fails here as well as in CI.
    expect(checkCoverageTopology()).toMatchObject({ upToDate: true, missing: false });
  });

  it('reports missing when the committed artifact is absent', () => {
    expect(checkCoverageTopology('/tmp/__no_such_tzurot_root__')).toMatchObject({
      upToDate: false,
      missing: true,
    });
  });

  it('round-trips writeCoverageTopology → check, and flags a tampered (stale) artifact', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'topo-'));
    try {
      mkdirSync(join(tmpRoot, dirname(COVERAGE_TOPOLOGY_PATH)), { recursive: true });
      const written = writeCoverageTopology(tmpRoot);
      // A fresh write byte-matches a re-generation against the same root.
      expect(checkCoverageTopology(tmpRoot)).toMatchObject({ upToDate: true, missing: false });
      // Tampering makes it stale: present, but no longer matching.
      writeFileSync(written, 'tampered\n');
      expect(checkCoverageTopology(tmpRoot)).toMatchObject({ upToDate: false, missing: false });
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
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
