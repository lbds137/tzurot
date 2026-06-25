/**
 * Coverage topology — code-derived registry of cross-service surfaces (Phase 2).
 *
 * Enumerates every cross-service "surface" from code — HTTP routes (`ROUTE_MANIFEST`),
 * BullMQ job payloads (`JobType` + `*JobDataSchema`), and the context-assembly
 * envelope — and records, per surface, the test tiers it SHOULD carry
 * (`requiredTiers`) vs. what it HAS (`actualTiers`), plus the coverage MECHANISM
 * that provides it. This is the discovery artifact the eventual `test:tier-audit`
 * ratchet (Phase 4) gates on; committed + lockfile-diffed in CI (Phase 2b).
 *
 * Coverage is **mechanism-based per surface class** (NOT a fuzzy global
 * schema-grep): each class has one known coverage mechanism —
 *  - http-route      → the route-conformance harness (component tier)
 *  - bullmq-job      → the BullMQ producer/consumer contract tests (contract tier)
 *  - context-envelope → the golden-fixture contract (contract tier)
 *
 * Phase 2a (this) enumerates surfaces + assigns each its mechanism + an OPTIMISTIC
 * mechanism-implied `actualTiers` (assumes the mechanism's test is present).
 * Phase 2b VERIFIES presence (downgrades `actualTiers` when a mechanism's test is
 * missing) and adds the lockfile-diff CI gate.
 */

import { ROUTE_MANIFEST } from '@tzurot/clients';
import { JobType } from '@tzurot/common-types';
import type { TestTier } from '../test/test-tiers.js';

/** How a surface's contract coverage is provided. */
export type CoverageSurfaceMechanism = 'route-conformance' | 'bullmq-contract' | 'golden-fixture';

export type CoverageSurfaceKind = 'http-route' | 'bullmq-job' | 'context-envelope';

export interface CoverageSurface {
  /** Stable id, e.g. `api-gateway:ai-worker:llm-generation`. */
  id: string;
  kind: CoverageSurfaceKind;
  producer: string;
  consumer: string;
  /** The shared schema/type (or route id) that identifies the contract artifact. */
  schemaRef: string;
  /** How this surface's contract coverage is provided (the per-surface marker). */
  mechanism: CoverageSurfaceMechanism;
  /** Tiers this surface SHOULD carry. */
  requiredTiers: TestTier[];
  /** Tiers it currently HAS (Phase 2a: optimistic from mechanism; 2b verifies). */
  actualTiers: TestTier[];
}

export interface CoverageTopology {
  schema: 'coverage-topology/v1';
  surfaces: CoverageSurface[];
}

/** The required tiers a surface is MISSING (empty = fully covered). */
export function surfaceGap(surface: CoverageSurface): TestTier[] {
  return surface.requiredTiers.filter(tier => !surface.actualTiers.includes(tier));
}

/**
 * The tier each mechanism provides — and which therefore IS the surface's
 * required coverage. A cross-service surface's contract is verified by its
 * mechanism, NOT necessarily by a literal `*.contract.test.ts`:
 *  - the route-conformance harness is a **component**-tier test that verifies
 *    each route's request↔response against its declared schema (contract-level
 *    verification, component-tier file) — so a route requires `component`, not a
 *    separate contract-tier file;
 *  - the BullMQ + golden-fixture mechanisms are **contract**-tier.
 *
 * `requiredTiers` = `actualTiers` = [this tier] in Phase 2a (optimistic: the
 * mechanism's test is assumed present). Phase 2b verifies presence and empties
 * `actualTiers` when the mechanism's test is missing, surfacing a real gap.
 */
const MECHANISM_TIER: Record<CoverageSurfaceMechanism, TestTier> = {
  'route-conformance': 'component',
  'bullmq-contract': 'contract',
  'golden-fixture': 'contract',
};

/**
 * BullMQ job types that carry a cross-service payload schema (the producer↔consumer
 * contract). Shapes import/export have no `*JobDataSchema` (no discriminated payload
 * contract), so they are not BullMQ-contract surfaces.
 */
const JOB_PAYLOAD_SCHEMAS: Record<
  JobType.AudioTranscription | JobType.ImageDescription | JobType.LLMGeneration,
  string
> = {
  [JobType.AudioTranscription]: 'audioTranscriptionJobDataSchema',
  [JobType.ImageDescription]: 'imageDescriptionJobDataSchema',
  [JobType.LLMGeneration]: 'llmGenerationJobDataSchema',
};

/**
 * Route ids exempt from the cross-service contract requirement (not real
 * contracts: static asset serving, liveness). Capped — NOT a growable knownGaps;
 * each future entry carries an inline-comment reason. Empty for now.
 */
const EXEMPT_ROUTE_IDS = new Set<string>();

/**
 * Build the code-derived coverage topology by walking `ROUTE_MANIFEST` + the
 * BullMQ payload schemas + the context-assembly envelope. Surfaces are sorted by
 * id for a stable, diff-clean committed artifact.
 */
export function generateCoverageTopology(): CoverageTopology {
  const surfaces: CoverageSurface[] = [];

  // HTTP routes — each manifest entry is a cross-service surface (typed client →
  // api-gateway handler), covered by the route-conformance harness.
  for (const [id, route] of Object.entries(ROUTE_MANIFEST)) {
    if (EXEMPT_ROUTE_IDS.has(id)) continue;
    surfaces.push({
      id: `client:api-gateway:${id}`,
      kind: 'http-route',
      // 'client' = the typed-client layer, not a single service: routes are
      // called via the generated typed client by whichever service holds it
      // (internal routes are service-to-service; user/admin are bot-client), so
      // there's no single producer. The mechanism (route-conformance), not the
      // producer, drives coverage.
      producer: 'client',
      consumer: 'api-gateway',
      // The route's input/output Zod schemas are named consts in the manifest;
      // the route id is the stable surface identifier (the conformance harness,
      // not a schema-grep, is the coverage mechanism).
      schemaRef: `${route.method.toUpperCase()} ${route.path}`,
      mechanism: 'route-conformance',
      requiredTiers: [MECHANISM_TIER['route-conformance']],
      actualTiers: [MECHANISM_TIER['route-conformance']],
    });
  }

  // BullMQ jobs — api-gateway produces, ai-worker consumes; the payload schema is
  // the contract, covered by the BullMQ producer/consumer contract tests.
  for (const [jobType, schemaRef] of Object.entries(JOB_PAYLOAD_SCHEMAS)) {
    surfaces.push({
      id: `api-gateway:ai-worker:${jobType}`,
      kind: 'bullmq-job',
      producer: 'api-gateway',
      consumer: 'ai-worker',
      schemaRef,
      mechanism: 'bullmq-contract',
      requiredTiers: [MECHANISM_TIER['bullmq-contract']],
      actualTiers: [MECHANISM_TIER['bullmq-contract']],
    });
  }

  // The bot-client→ai-worker context-assembly envelope (locked by the
  // golden-fixture contract).
  surfaces.push({
    id: 'bot-client:ai-worker:context-assembly',
    kind: 'context-envelope',
    producer: 'bot-client',
    consumer: 'ai-worker',
    schemaRef: 'rawAssemblyInputsSchema',
    mechanism: 'golden-fixture',
    requiredTiers: [MECHANISM_TIER['golden-fixture']],
    actualTiers: [MECHANISM_TIER['golden-fixture']],
  });

  surfaces.sort((a, b) => a.id.localeCompare(b.id));
  return { schema: 'coverage-topology/v1', surfaces };
}
