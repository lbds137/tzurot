/**
 * Consumer half of the api-gateway → ai-worker job-chain contract — the
 * PIPELINE tier (deterministic-test-quality theme, candidate 2).
 *
 * The schema-only consumer (`tests/e2e/contracts/BullMQJobChain.contract.test.ts`)
 * proves fixtures parse; this file proves they are PIPELINE-CONSUMABLE: the
 * committed producer output runs through the REAL ValidationStep →
 * NormalizationStep → ContextStep (real ContextAssembler over PGLite), and
 * DependencyStep re-associates preprocessing results by the same
 * `sourceReferenceNumber`s the producer stamped — the exact cross-service
 * seam where a thin-payload referenced attachment once went undescribed
 * under green per-service coverage.
 *
 * The legacy fixtures are asserted the OTHER way: schema-tolerated (old queued
 * jobs mid-deploy must still parse) but REJECTED by ContextStep's envelope
 * gate. That three-tier narrowing (HTTP-wide → schema-with-default →
 * envelope-only runtime) was previously an untested blind spot — the old
 * fixtures greenlit shapes the pipeline refuses and bot-client never sends.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import {
  llmGenerationJobDataSchema,
  type LLMGenerationJobData,
} from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { UserService, PersonaResolver } from '@tzurot/identity';
import { createTestPGlite, loadPGliteSchema, loadContractFixture } from '@tzurot/test-utils';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { ContextAssembler } from '../../../services/context/ContextAssembler.js';
import { PrismaContextDataSource } from '../../../services/context/PrismaContextDataSource.js';
import { ValidationStep } from './steps/ValidationStep.js';
import { NormalizationStep } from './steps/NormalizationStep.js';
import { ContextStep } from './steps/ContextStep.js';
import { DependencyStep } from './steps/DependencyStep.js';
import type { GenerationContext } from './types.js';

// DependencyStep dynamically imports the worker redis module for dependency
// results; back it with an in-memory map the test fills from fixture child
// specs (simulating what the preprocessing workers would have stored).
const jobResults = new Map<string, unknown>();
vi.mock('../../../redis.js', () => ({
  redisService: {
    getJobResult: (key: string) => Promise.resolve(jobResults.get(key) ?? null),
  },
}));

interface FixtureFlow {
  name: string;
  data: unknown;
  children?: {
    name: string;
    data: { sourceReferenceNumber?: number; attachment?: { url: string; name?: string } };
    opts?: { jobId?: string };
  }[];
}

const loadFlow = (name: string): FixtureFlow =>
  loadContractFixture<FixtureFlow>(`bullmq-job-chain/${name}.json`);

/** Parse fixture data through the REAL entry schema (what ValidationStep runs). */
const parseJobData = (flow: FixtureFlow): LLMGenerationJobData =>
  llmGenerationJobDataSchema.parse(flow.data) as LLMGenerationJobData;

const asJob = (data: LLMGenerationJobData): Job<LLMGenerationJobData> =>
  ({ id: 'contract-job', data }) as Job<LLMGenerationJobData>;

describe('BullMQ job-chain contract — consumer pipeline over PGLite', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let contextStep: ContextStep;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    // Exactly the production wiring (LLMGenerationHandler.buildContextStep):
    // real data source + assembler; the assembler creates users/personas
    // on first contact, so the fixture's ids need no pre-seeding.
    contextStep = new ContextStep(
      new ContextAssembler({
        dataSource: new PrismaContextDataSource(prisma),
        userService: new UserService(prisma),
        personaResolver: new PersonaResolver(prisma),
      })
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  /**
   * Run the real front-of-pipeline steps in PRODUCTION order
   * (LLMGenerationHandler pipeline): Validation → Normalization → [Config
   * contract, minimally] → DependencyStep → ContextStep. DependencyStep runs
   * BEFORE ContextStep exactly as the real handler wires it.
   */
  async function runFrontPipeline(data: LLMGenerationJobData): Promise<GenerationContext> {
    let ctx: GenerationContext = { job: asJob(data), startTime: 0 };
    ctx = await new ValidationStep().process(ctx);
    ctx = await new NormalizationStep().process(ctx);
    ctx = {
      ...ctx,
      config: {
        effectivePersonality: data.personality as LoadedPersonality,
        configSource: 'personality',
      },
    };
    ctx = await new DependencyStep().process(ctx);
    return contextStep.process(ctx);
  }

  /** Fill the simulated result store from a fixture's own child specs. */
  function seedJobResults(flow: FixtureFlow, data: LLMGenerationJobData): void {
    jobResults.clear();
    for (const dep of data.dependencies ?? []) {
      const child = (flow.children ?? []).find(c => c.opts?.jobId === dep.jobId);
      expect(child).toBeDefined();
      const sourceReferenceNumber = child?.data.sourceReferenceNumber;
      // The consumer looks results up by the resultKey MINUS the store's
      // namespace prefix (redisService re-adds it) — mirror via the shared
      // constant so a prefix rename shows up here as a compile-time reference.
      const storeKey = (dep.resultKey ?? '').substring(REDIS_KEY_PREFIXES.JOB_RESULT.length);
      if (dep.type === 'image-description') {
        jobResults.set(storeKey, {
          success: true,
          descriptions: [{ url: 'https://cdn.example/some-photo.png', description: 'a photo' }],
          sourceReferenceNumber,
        });
      } else {
        jobResults.set(storeKey, {
          success: true,
          content: 'a transcript',
          attachmentUrl: 'https://cdn.example/some-voice.ogg',
          attachmentName: 'some-voice.ogg',
          sourceReferenceNumber,
        });
      }
    }
  }

  it('envelope-minimal: the shape bot-client ships survives the full front pipeline', async () => {
    const data = parseJobData(loadFlow('envelope-minimal'));
    jobResults.clear();

    const ctx = await runFrontPipeline(data);

    expect(ctx.preparedContext).toBeDefined();
    // The assembler derived the current turn from the raw envelope.
    expect(ctx.preparedContext?.participants.length).toBeGreaterThan(0);
  });

  it('envelope-referenced-attachments: references are assembled AND preprocessing results re-associate by the producer-stamped keys', async () => {
    const flow = loadFlow('envelope-referenced-attachments');
    const data = parseJobData(flow);
    seedJobResults(flow, data);

    const ctx = await runFrontPipeline(data);

    // ContextStep re-derived the referenced messages from the raw envelope
    // with their crawl-order reference numbers intact.
    const assembledRefs = ctx.job.data.context.referencedMessages ?? [];
    expect(assembledRefs.map(r => r.referenceNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2,
    ]);

    // The cross-seam re-association invariant: every producer-stamped reference
    // number surfaces as a re-associated attachment bucket on the consumer.
    const buckets = ctx.preprocessing?.referenceAttachments ?? {};
    expect(
      Object.keys(buckets)
        .map(Number)
        .sort((a, b) => (a ?? 0) - (b ?? 0))
    ).toEqual([1, 2]);
    expect(buckets[1]?.[0]?.description).toBe('a photo');
    expect(buckets[2]?.[0]?.description).toBe('a transcript');
    // Nothing leaked into the direct-attachment bucket.
    expect(ctx.preprocessing?.processedAttachments).toHaveLength(0);
  });

  it('envelope-direct-attachments: the trigger message own attachments land in the DIRECT bucket (no reference stamp)', async () => {
    const flow = loadFlow('envelope-direct-attachments');
    const data = parseJobData(flow);
    seedJobResults(flow, data);

    const ctx = await runFrontPipeline(data);

    // Direct results (no sourceReferenceNumber) route to processedAttachments
    // + transcriptions — never to a reference bucket. The most common
    // attachment path, distinct from the referenced-message path above.
    expect(ctx.preprocessing?.processedAttachments).toHaveLength(2);
    expect(ctx.preprocessing?.referenceAttachments).toEqual({});
    expect(ctx.preprocessing?.transcriptions).toEqual(['a transcript']);
    expect(ctx.preparedContext).toBeDefined();
  });

  it.each(['text-only', 'audio-and-image'])(
    'legacy fixture %s: schema-tolerated but REJECTED by the envelope gate (the three-tier narrowing, pinned)',
    async name => {
      const data = parseJobData(loadFlow(name));

      // Tier 2: the BullMQ schema tolerates legacy (old queued jobs mid-deploy).
      expect(data).toBeDefined();

      // Tier 3: the runtime pipeline refuses it — loudly, not silently.
      await expect(runFrontPipeline(data)).rejects.toThrow(/envelope/i);
    }
  );
});
