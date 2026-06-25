/**
 * Coverage topology — SKELETON (test-pyramid epic, Phase-3 seed).
 *
 * The cross-service "surfaces" a tier-coverage audit should track — HTTP
 * route-manifest entries + BullMQ job payloads + the context-assembly envelope —
 * each with the test tiers it SHOULD carry vs. what it currently HAS. This is
 * the data shape the eventual `test:tier-audit` ratchet (Phase 4) gates on and
 * the lockfile the discovery generator (Phase 2) regenerates from code.
 *
 * This skeleton is REPORT-ONLY and hand-seeded with one proven surface
 * (the bot-client→ai-worker context-assembly envelope) to prove the shape. The
 * full enumeration — walking `ROUTE_MANIFEST` (@tzurot/clients) + every `JobType`
 * (@tzurot/common-types) and deriving `actualTiers` from the test files — is
 * Phase 2's discovery generator, not built here.
 */

import type { TestTier } from '../test/test-tiers.js';

export type CoverageSurfaceKind = 'http-route' | 'bullmq-job' | 'context-envelope';

export interface CoverageSurface {
  /** Stable id, e.g. `bot-client:ai-worker:context-assembly`. */
  id: string;
  kind: CoverageSurfaceKind;
  producer: string;
  consumer: string;
  /** The shared schema/type that IS the contract artifact. */
  schemaRef: string;
  /** Tiers this surface SHOULD carry. */
  requiredTiers: TestTier[];
  /** Tiers it currently HAS (Phase 2's generator will derive this from tests). */
  actualTiers: TestTier[];
}

export interface CoverageTopology {
  schema: 'coverage-topology/v0-skeleton';
  surfaces: CoverageSurface[];
}

/** The required tiers a surface is MISSING (empty = fully covered). */
export function surfaceGap(surface: CoverageSurface): TestTier[] {
  return surface.requiredTiers.filter(tier => !surface.actualTiers.includes(tier));
}

/**
 * Build the skeleton topology — seeded with one proven cross-service surface
 * (the context-assembly envelope). NOTE: `actualTiers` is hand-coded for the
 * skeleton; Phase 2 replaces this builder with code-derivation (deriving the
 * tiers each surface HAS from the test files), so the seeded values are a
 * placeholder to be regenerated, not a maintained source of truth.
 */
export function buildCoverageTopology(): CoverageTopology {
  return {
    schema: 'coverage-topology/v0-skeleton',
    surfaces: [
      {
        id: 'bot-client:ai-worker:context-assembly',
        kind: 'context-envelope',
        producer: 'bot-client',
        consumer: 'ai-worker',
        schemaRef: 'rawAssemblyInputsSchema',
        requiredTiers: ['contract'],
        // The `contract` tier here is provided by the GOLDEN-FIXTURE mechanism —
        // a producer guard (RawEnvelopeContract.producer.test.ts, a unit-suffix
        // file) + consumer derivation over the committed fixture
        // (RawEnvelopeContract.consumer.component.test.ts, a component-suffix
        // file) — NOT a `*.contract.test.ts` file. So Phase 2's suffix-based
        // classifyTestFile would naively derive ['unit', 'component'] and report
        // a FALSE `contract` gap on this surface. Phase 2 must recognize
        // golden-fixture contracts (e.g. a per-surface mechanism marker) instead
        // of relying on the file suffix alone — see the builder doc above.
        actualTiers: ['contract', 'component', 'unit'],
      },
    ],
  };
}
