/**
 * Coverage topology — code-derived registry of cross-service surfaces.
 *
 * Enumerates every cross-service "surface" from code — HTTP routes
 * (`ROUTE_MANIFEST`), payload-bearing BullMQ jobs (`JobType` + `*JobDataSchema`),
 * and the bot-client→worker context-assembly envelope — and records, per surface,
 * the test tiers it SHOULD carry (`requiredTiers`) vs. the tiers it actually HAS
 * (`actualTiers`), plus the coverage MECHANISM that provides it. A surface whose
 * mechanism's test is absent has empty `actualTiers`, so `surfaceGap` reports it.
 *
 * Coverage is **mechanism-based per surface class** (NOT a fuzzy global
 * schema-grep): each class has exactly one coverage mechanism, and a surface is
 * "covered" iff that mechanism's test EXERCISES the real producer/consumer —
 * proven statically by the test IMPORTING the real symbol (`REAL_IMPORTS`), not
 * merely by a file existing or a schema string appearing. A circular test (a
 * hand-written payload validated against its own schema, importing neither the
 * real producer nor consumer) fails this and is reported as a gap —
 *  - http-route       → the route-conformance harness (component tier)
 *  - bullmq-job       → the BullMQ producer/consumer contract tests (contract tier)
 *  - context-envelope → the golden-fixture contract (contract tier)
 *
 * The generated topology is committed (`packages/tooling/coverage-topology.json`)
 * and byte-compared in CI via `topology:check` — a new or newly-uncovered surface
 * shows up as a one-line diff a reviewer closes or exempts. The hard ratchet that
 * FAILS on a missing required tier is a separate, later tool (`test:tier-audit`).
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

import { ROUTE_MANIFEST } from '@tzurot/clients';
import { JobType } from '@tzurot/common-types/constants/queue';
import { findFiles, fileExists, readFile } from '../test/audit-utils.js';
import type { TestTier } from '../test/test-tiers.js';
import { fileImportsSymbol } from './importAssertions.js';

/** How a surface's contract coverage is provided. */
export type CoverageSurfaceMechanism =
  'route-conformance' | 'bullmq-contract' | 'golden-fixture' | 'voice-engine-contract';

export type CoverageSurfaceKind = 'http-route' | 'bullmq-job' | 'context-envelope' | 'voice-engine';

export interface CoverageSurface {
  /** Stable id, e.g. `api-gateway:ai-worker:llm-generation`. */
  id: string;
  kind: CoverageSurfaceKind;
  producer: string;
  consumer: string;
  /**
   * The shared schema/type that identifies the contract artifact — a `*Schema` name
   * (bullmq/envelope), a module label (voice-engine), or the `METHOD /path` signature
   * (http-route). NOT a unique key: several of the manifest's routes share a `METHOD
   * /path` where global/user variants sit behind different auth middleware. `id` is the
   * unique key; diff/dedupe on `id`, not `schemaRef`.
   */
  schemaRef: string;
  /** How this surface's contract coverage is provided (the per-surface marker). */
  mechanism: CoverageSurfaceMechanism;
  /** Tiers this surface SHOULD carry. */
  requiredTiers: TestTier[];
  /** Tiers it actually HAS (= its mechanism's tier iff that mechanism's test is present). */
  actualTiers: TestTier[];
}

export interface CoverageTopology {
  schema: 'coverage-topology/v1';
  surfaces: CoverageSurface[];
}

/** Repo-relative path of the committed topology artifact (byte-compared in CI). */
export const COVERAGE_TOPOLOGY_PATH = 'packages/tooling/coverage-topology.json';

/** The required tiers a surface is MISSING (empty = fully covered). */
export function surfaceGap(surface: CoverageSurface): TestTier[] {
  return surface.requiredTiers.filter(tier => !surface.actualTiers.includes(tier));
}

/**
 * The tier each mechanism provides — which IS the surface's required coverage. A
 * cross-service contract is verified by its mechanism, NOT necessarily by a
 * literal `*.contract.test.ts`: the route-conformance harness is a
 * **component**-tier test that checks each route's request↔response against its
 * declared schema, so a route requires `component`; the BullMQ and golden-fixture
 * mechanisms are **contract**-tier.
 */
const MECHANISM_TIER: Record<CoverageSurfaceMechanism, TestTier> = {
  'route-conformance': 'component',
  'bullmq-contract': 'contract',
  'golden-fixture': 'contract',
  'voice-engine-contract': 'contract',
};

/**
 * Every JobType, classified: a CROSS-SERVICE payload-bearing job maps to its
 * `*JobDataSchema` name (the producer↔consumer contract); `null` means no
 * cross-service seam exists — either no discriminated payload schema (Shapes
 * import/export) or a worker-internal job whose producer and consumer are the
 * same service (fact-extraction). The
 * `Record<JobType, …>` is the exhaustiveness guard — a newly-added JobType will
 * not compile until it is classified here, so a future payload-bearing job can't
 * be silently omitted from the topology.
 */
const JOB_SCHEMA_BY_TYPE: Record<JobType, { schemaRef: string; consumer: string } | null> = {
  [JobType.AudioTranscription]: {
    schemaRef: 'audioTranscriptionJobDataSchema',
    consumer: 'ai-worker',
  },
  [JobType.ImageDescription]: {
    schemaRef: 'imageDescriptionJobDataSchema',
    consumer: 'ai-worker',
  },
  [JobType.LLMGeneration]: { schemaRef: 'llmGenerationJobDataSchema', consumer: 'ai-worker' },
  [JobType.ShapesImport]: null,
  [JobType.ShapesExport]: null,
  // Self-contained like the shapes jobs: status/results ride the export_jobs
  // row (the real cross-service contract), not the payload — the two-uuid
  // payload schema exists for enqueue-side validation only.
  [JobType.AccountExport]: null,
  // Worker-internal: ai-worker both enqueues (LongTermMemoryService tail call)
  // and consumes fact-extraction jobs — no cross-service producer↔consumer seam,
  // so no bullmq-contract surface despite having a payload schema.
  [JobType.FactExtraction]: null,
  // Cross-service: api-gateway produces broadcast batches, bot-client's DM
  // worker consumes them — the payload schema IS the producer↔consumer contract.
  [JobType.ReleaseBroadcastDm]: {
    schemaRef: 'releaseBroadcastDmJobDataSchema',
    consumer: 'bot-client',
  },
};

/** The payload-bearing subset (non-null entries) — one BullMQ-contract surface each. */
const JOB_PAYLOAD_SCHEMAS: readonly { jobType: JobType; schemaRef: string; consumer: string }[] =
  Object.entries(JOB_SCHEMA_BY_TYPE)
    .filter(
      (entry): entry is [JobType, { schemaRef: string; consumer: string }] => entry[1] !== null
    )
    .map(([jobType, { schemaRef, consumer }]) => ({ jobType, schemaRef, consumer }));

/**
 * Route ids exempt from the cross-service contract requirement (not real
 * contracts: static asset serving, liveness). Capped — NOT a growable knownGaps;
 * each future entry carries an inline reason. Exported as an array (the test reads
 * `.length`); `generateCoverageTopology` derives a local Set for O(1) per-route
 * lookup. Empty for now.
 */
export const EXEMPT_ROUTE_IDS: readonly string[] = [];

/** The contract test files whose REAL imports prove each mechanism is live (repo-relative). */
const CONFORMANCE_HARNESS =
  'services/api-gateway/src/routes/conformance/conformance.component.test.ts';
const GOLDEN_FIXTURE_PRODUCER =
  'services/bot-client/src/services/contextBuilder/RawEnvelopeContract.producer.test.ts';
const GOLDEN_FIXTURE_CONSUMER =
  'services/ai-worker/src/services/context/RawEnvelopeContract.consumer.contract.test.ts';
const BULLMQ_PRODUCER_TEST =
  'services/api-gateway/src/utils/BullMQJobChainContract.producer.test.ts';
const BROADCAST_PRODUCER_TEST =
  'services/api-gateway/src/services/ReleaseBroadcastContract.producer.test.ts';
const BULLMQ_CONTRACT_DIR = 'tests/e2e/contracts';
const VOICE_ENGINE_CONSUMER_TEST =
  'services/ai-worker/src/services/voice/VoiceEngineContract.consumer.contract.test.ts';

/**
 * The REAL producer/consumer symbol each mechanism's test must import — the
 * execution-check that tells a real contract test apart from a CIRCULAR one
 * (which imports its own schema but neither the real producer nor consumer).
 * Each entry is (file, exported symbol, module-specifier fragment). `noUnusedLocals`
 * (root tsconfig) guarantees a present import is USED, so importing the symbol is
 * sufficient proof the test exercises it — no call-site analysis needed.
 *
 * Maintenance: renaming a source module (or moving a test file) requires updating
 * the matching `from`/`file` here. The check fails CLOSED — the surface shows as
 * uncovered and `topology:check` fires — so a stale entry is loud, never silent.
 */
const REAL_IMPORTS = {
  /** The harness drives the real route replay from the manifest + the per-route registry. */
  conformanceRegistry: {
    file: CONFORMANCE_HARNESS,
    symbol: 'CONFORMANCE_REGISTRY',
    // Anchored both sides: leading `/` excludes a name-prefix sibling
    // (`mock-fixtures/registry`); the trailing `.` (the extension dot) excludes a
    // name-suffix sibling (`registry-v2.js`). Defense-in-depth — scoped to one file.
    from: '/fixtures/registry.',
  },
  conformanceManifest: {
    file: CONFORMANCE_HARNESS,
    symbol: 'ROUTE_MANIFEST',
    from: '@tzurot/clients',
  },
  /** The envelope golden-fixture: producer runs the real builder, consumer runs the real assembler. */
  envelopeProducer: {
    file: GOLDEN_FIXTURE_PRODUCER,
    symbol: 'buildRawAssemblyInputs',
    from: '/RawEnvelopeBuilder.',
  },
  envelopeConsumer: {
    file: GOLDEN_FIXTURE_CONSUMER,
    symbol: 'ContextAssembler',
    // Anchored both sides: leading `/` excludes `./PrismaContextAssembler.js`, the
    // trailing `.` excludes `./ContextAssemblerV2.js`.
    from: '/ContextAssembler.',
  },
  /**
   * The BullMQ golden-fixture producer runs the real job-chain orchestrator. ONE
   * check covers all three job surfaces: the producer test exercises all three job
   * types (its audio+image and text-only scenarios emit audio/image/llm payloads),
   * and per-job discrimination is the consumer-side `bullmqSchemas` scan — so a
   * future payload-bearing job added without a contract test still gaps via that
   * gate, even though this coarse producer-import boolean stays true.
   */
  bullmqProducer: {
    file: BULLMQ_PRODUCER_TEST,
    symbol: 'createJobChain',
    from: '/jobChainOrchestrator.',
  },
  /**
   * The release-broadcast batch has its OWN producer (enqueueBroadcast, not the
   * job-chain orchestrator), so its surface keys off its own producer-fixture
   * test rather than riding the job-chain boolean — a coarse shared boolean
   * would mark this surface covered by a producer that never emits it.
   */
  broadcastProducer: {
    file: BROADCAST_PRODUCER_TEST,
    symbol: 'enqueueBroadcast',
    from: '/releaseBroadcast.',
  },
  /**
   * The voice-engine JSON contract is cross-LANGUAGE: the PRODUCER is the Python
   * service, enforced by the `voice-engine-tests` CI job (a pytest asserts each real
   * endpoint's output equals the committed fixture) — NOT topology-visible (this
   * tool is TS-only). The topology tracks the TS CONSUMER half: the contract test
   * imports the real response Zod schemas it validates the shared fixtures against.
   */
  voiceEngineConsumer: {
    file: VOICE_ENGINE_CONSUMER_TEST,
    symbol: 'transcribeResponseSchema',
    from: '/voiceEngineSchemas.',
  },
} as const;

interface MechanismPresence {
  /** The conformance harness imports the real route manifest + per-route registry (drives the replay). */
  routeImportsReal: boolean;
  /** Producer imports the real envelope builder AND consumer imports the real assembler. */
  envelopeImportsReal: boolean;
  /** The BullMQ producer test imports the real `createJobChain` (so the fixture is real output). */
  bullmqProducerImportsReal: boolean;
  /** The broadcast producer test imports the real `enqueueBroadcast` (its own producer seam). */
  broadcastProducerImportsReal: boolean;
  /** The voice-engine consumer test imports the real response Zod schemas (TS half; Python half is CI-enforced). */
  voiceEngineImportsReal: boolean;
  /** Job schema names referenced by a `.safeParse(`/`.parse(` call in a BullMQ contract test. */
  bullmqSchemas: Set<string>;
}

/**
 * Probe the filesystem ONCE for each mechanism. The EXECUTION check is whether the
 * mechanism's test IMPORTS the real producer/consumer symbol (`REAL_IMPORTS`) — a
 * circular test (hand-written payload vs. its own schema, importing neither side)
 * fails it. The import probe returns false for an absent file, so it also subsumes
 * the old file-existence check. BullMQ additionally keeps the per-job schema scan
 * (the real consumer-validation gate), matched with the same
 * `(\w+Schema)\.(safeParse|parse)` primitive the unified test-audit uses.
 */
function buildMechanismPresence(projectRoot: string): MechanismPresence {
  const bullmqSchemas = new Set<string>();
  const contractFiles = findFiles(join(projectRoot, BULLMQ_CONTRACT_DIR), /\.contract\.test\.ts$/);
  for (const file of contractFiles) {
    // eslint-disable-next-line regexp/no-super-linear-move -- Input is developer-authored TS source (trusted, bounded by file size); ReDoS not a real attack surface
    for (const match of readFile(file).matchAll(/(\w+Schema)\.(?:safeParse|parse)\(/g)) {
      bullmqSchemas.add(match[1]);
    }
  }
  const imports = (spec: { file: string; symbol: string; from: string }): boolean =>
    fileImportsSymbol(join(projectRoot, spec.file), spec.symbol, spec.from);
  return {
    routeImportsReal:
      imports(REAL_IMPORTS.conformanceRegistry) && imports(REAL_IMPORTS.conformanceManifest),
    envelopeImportsReal:
      imports(REAL_IMPORTS.envelopeProducer) && imports(REAL_IMPORTS.envelopeConsumer),
    bullmqProducerImportsReal: imports(REAL_IMPORTS.bullmqProducer),
    broadcastProducerImportsReal: imports(REAL_IMPORTS.broadcastProducer),
    voiceEngineImportsReal: imports(REAL_IMPORTS.voiceEngineConsumer),
    bullmqSchemas,
  };
}

type SurfaceSeed = Omit<CoverageSurface, 'requiredTiers' | 'actualTiers'>;

/**
 * Whether each mechanism's coverage is present for a given surface. Keyed by
 * mechanism (a `Record`, like `MECHANISM_TIER`) so a newly-added
 * `CoverageSurfaceMechanism` is a compile error here rather than a silent
 * fall-through to the wrong branch.
 */
const MECHANISM_PRESENT: Record<
  CoverageSurfaceMechanism,
  (seed: SurfaceSeed, presence: MechanismPresence) => boolean
> = {
  'route-conformance': (_seed, presence) => presence.routeImportsReal,
  'golden-fixture': (_seed, presence) => presence.envelopeImportsReal,
  'bullmq-contract': (seed, presence) =>
    presence.bullmqSchemas.has(seed.schemaRef) &&
    (seed.schemaRef === 'releaseBroadcastDmJobDataSchema'
      ? presence.broadcastProducerImportsReal
      : presence.bullmqProducerImportsReal),
  'voice-engine-contract': (_seed, presence) => presence.voiceEngineImportsReal,
};

/** Resolve a seed to a full surface: requiredTiers from its mechanism, actualTiers iff present. */
function buildSurface(seed: SurfaceSeed, presence: MechanismPresence): CoverageSurface {
  const tier = MECHANISM_TIER[seed.mechanism];
  const present = MECHANISM_PRESENT[seed.mechanism](seed, presence);
  return { ...seed, requiredTiers: [tier], actualTiers: present ? [tier] : [] };
}

/**
 * Build the code-derived coverage topology by walking `ROUTE_MANIFEST` + the
 * payload-bearing BullMQ jobs + the context-assembly envelope, verifying each
 * surface's coverage mechanism against `projectRoot`. Surfaces are sorted by id
 * for a stable, diff-clean committed artifact.
 */
export function generateCoverageTopology(projectRoot: string = defaultRootDir()): CoverageTopology {
  const presence = buildMechanismPresence(projectRoot);
  const exempt = new Set(EXEMPT_ROUTE_IDS);
  const surfaces: CoverageSurface[] = [];

  // HTTP routes — each manifest entry is a cross-service surface (typed client →
  // api-gateway handler), covered by the route-conformance harness.
  for (const [id, route] of Object.entries(ROUTE_MANIFEST)) {
    if (exempt.has(id)) continue;
    surfaces.push(
      buildSurface(
        {
          id: `client:api-gateway:${id}`,
          kind: 'http-route',
          // 'client' = the typed-client layer (no single producer service; internal
          // routes are service-to-service, user/admin are bot-client). The
          // mechanism, not the producer, drives coverage.
          producer: 'client',
          consumer: 'api-gateway',
          schemaRef: `${route.method.toUpperCase()} ${route.path}`,
          mechanism: 'route-conformance',
        },
        presence
      )
    );
  }

  // BullMQ jobs — api-gateway produces, ai-worker consumes; the payload schema is
  // the contract, covered by the BullMQ producer/consumer contract tests.
  for (const { jobType, schemaRef, consumer } of JOB_PAYLOAD_SCHEMAS) {
    surfaces.push(
      buildSurface(
        {
          id: `api-gateway:${consumer}:${jobType}`,
          kind: 'bullmq-job',
          producer: 'api-gateway',
          consumer,
          schemaRef,
          mechanism: 'bullmq-contract',
        },
        presence
      )
    );
  }

  // The bot-client→ai-worker context-assembly envelope (golden-fixture contract).
  surfaces.push(
    buildSurface(
      {
        id: 'bot-client:ai-worker:context-assembly',
        kind: 'context-envelope',
        producer: 'bot-client',
        consumer: 'ai-worker',
        schemaRef: 'rawAssemblyInputsSchema',
        mechanism: 'golden-fixture',
      },
      presence
    )
  );

  // The voice-engine JSON-response contract (cross-language: Python producer →
  // ai-worker consumer). One aggregate surface for the JSON shapes; the Python
  // producer is CI-enforced (voice-engine-tests), the TS consumer is topology-tracked.
  surfaces.push(
    buildSurface(
      {
        id: 'voice-engine:ai-worker:json-responses',
        kind: 'voice-engine',
        producer: 'voice-engine',
        consumer: 'ai-worker',
        // The module that exports the response schemas (this mechanism checks the
        // consumer's import, not schemaRef — so this is a label, not a key).
        schemaRef: 'voiceEngineSchemas',
        mechanism: 'voice-engine-contract',
      },
      presence
    )
  );

  surfaces.sort((a, b) => a.id.localeCompare(b.id));
  return { schema: 'coverage-topology/v1', surfaces };
}

/**
 * Serialize for the committed artifact: `JSON.stringify(…, 2)` + trailing
 * newline. The file is byte-compared by `topology:check`, so it MUST be
 * `.prettierignore`d (prettier collapses short arrays and breaks the compare) —
 * same contract as `command-manifest.json` and the contract fixtures.
 */
function serializeCoverageTopology(topology: CoverageTopology): string {
  return `${JSON.stringify(topology, null, 2)}\n`;
}

/** Generate + write the committed topology artifact. Returns the absolute path. */
export function writeCoverageTopology(projectRoot: string = defaultRootDir()): string {
  const path = join(projectRoot, COVERAGE_TOPOLOGY_PATH);
  writeFileSync(path, serializeCoverageTopology(generateCoverageTopology(projectRoot)));
  return path;
}

interface TopologyCheckResult {
  /** True when the committed file matches freshly-generated output byte-for-byte. */
  upToDate: boolean;
  /** Absolute path of the committed artifact. */
  path: string;
  /** True when the committed file is absent entirely (never generated/committed). */
  missing: boolean;
}

/** Regenerate the topology and byte-compare it against the committed artifact (CI drift gate). */
export function checkCoverageTopology(projectRoot: string = defaultRootDir()): TopologyCheckResult {
  const path = join(projectRoot, COVERAGE_TOPOLOGY_PATH);
  if (!fileExists(path)) return { upToDate: false, path, missing: true };
  const expected = serializeCoverageTopology(generateCoverageTopology(projectRoot));
  return { upToDate: readFile(path) === expected, path, missing: false };
}

/**
 * The monorepo root, resolved from this module's location. The layout mirrors
 * between src/ (dev, tsx) and dist/ (built), so the same step count reaches root
 * in either context:  topology/ → {src|dist}/ → tooling/ → packages/ → root.
 */
function defaultRootDir(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
}
