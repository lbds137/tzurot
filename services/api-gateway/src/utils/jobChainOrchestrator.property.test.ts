/**
 * Property layer of the job-payload contract suite (deterministic-test-quality
 * theme, candidate 2). Complements the fixture-based contract pair: fixtures
 * pin representative shapes end-to-end; properties assert the invariants for
 * EVERY generated valid context — generalizing the incident class where only
 * the fat payload shape was tested and the thin shape shipped broken.
 *
 * Deterministic by pinned seed (FC_SEED env overrides for exploration);
 * failures print seed+path for exact reproduction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  envelopeContextArb,
  describableReferenceNumbers,
  hasDescribableDirectAttachment,
} from '@tzurot/test-utils';
import { JobType } from '@tzurot/common-types/constants/queue';
import {
  llmGenerationJobDataSchema,
  type JobContext,
  type ResponseDestination,
} from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import {
  generatePersonalityUuid,
  generateUserUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import type { LlmConfigResolver, VisionConfigResolver } from '@tzurot/config-resolver';

vi.mock('../queue.js', () => ({ flowProducer: { add: vi.fn() } }));
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => ({ QUEUE_NAME: 'test-queue' }) };
});

import { createJobChain } from './jobChainOrchestrator.js';
import { flowProducer } from '../queue.js';

fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 0x715a), numRuns: 100 });

const resolverStub: LlmConfigResolver = {
  resolveConfig: vi.fn().mockResolvedValue({
    source: 'user-personality',
    config: { model: 'resolved/model' },
  }),
} as unknown as LlmConfigResolver;

const visionResolverStub: VisionConfigResolver = {
  resolveConfig: vi.fn().mockResolvedValue({
    source: 'personality',
    config: { model: 'resolved/vision-model' },
  }),
  getGlobalDefaultConfig: vi.fn().mockResolvedValue(null),
  getFreeDefaultVisionConfig: vi.fn().mockResolvedValue(null),
} as unknown as VisionConfigResolver;

const PERSONALITY: LoadedPersonality = {
  id: generatePersonalityUuid('propbot'),
  name: 'PropBot',
  displayName: 'Prop Bot',
  slug: 'propbot',
  ownerId: generateUserUuid('owner-prop'),
  systemPrompt: 'Prop prompt',
  model: 'test-model',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 1000,
  contextWindowTokens: 4096,
  characterInfo: 'Prop character',
  personalityTraits: 'Prop traits',
  voiceEnabled: false,
};

const RESPONSE_DESTINATION: ResponseDestination = {
  type: 'discord',
  channelId: 'prop-channel',
};

interface CapturedFlow {
  name: string;
  data: unknown;
  children?: {
    name: string;
    data: { sourceReferenceNumber?: number };
    opts?: { jobId?: string };
  }[];
}

/** Run the real createJobChain for a generated context; return the captured flow. */
async function runProducer(context: JobContext): Promise<CapturedFlow> {
  vi.mocked(flowProducer.add).mockClear();
  vi.mocked(flowProducer.add).mockResolvedValue({
    job: { id: 'llm-job-prop' },
    children: [],
  } as unknown as Awaited<ReturnType<typeof flowProducer.add>>);

  await createJobChain({
    requestId: 'prop-req',
    personality: PERSONALITY,
    message: 'property message',
    context,
    responseDestination: RESPONSE_DESTINATION,
    llmConfigResolver: resolverStub,
    visionConfigResolver: visionResolverStub,
  });

  return vi.mocked(flowProducer.add).mock.calls[0][0] as unknown as CapturedFlow;
}

describe('jobChainOrchestrator — wire-shape properties', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.restoreAllMocks());

  it('no-drop: preprocessing children cover EXACTLY the describable references AND the trigger message own attachments', async () => {
    await fc.assert(
      fc.asyncProperty(envelopeContextArb(), async arbContext => {
        const context = arbContext as JobContext;
        const flow = await runProducer(context);
        const children = flow.children ?? [];

        // Reference-stamped children ↔ describable references. Set equality
        // deliberately: a reference may legitimately yield BOTH an audio and
        // an image child (same number); true duplicate-job detection is
        // delegated to the sibling 'unique job ids' property.
        const expected = describableReferenceNumbers(arbContext);
        const childRefNumbers = children
          .map(c => c.data.sourceReferenceNumber)
          .filter((n): n is number => n !== undefined);
        expect(new Set(childRefNumbers)).toEqual(new Set(expected));

        // Direct-attachment children (no sourceReferenceNumber) ↔ the trigger
        // message's own describable attachments — the MOST COMMON attachment
        // path, distinct from references and carried top-level under envelope.
        const directChildren = children.filter(c => c.data.sourceReferenceNumber === undefined);
        if (hasDescribableDirectAttachment(arbContext)) {
          expect(directChildren.length).toBeGreaterThan(0);
        } else {
          expect(directChildren).toHaveLength(0);
        }
      })
    );
  });

  it('schema round-trip: producer output always parses AND stays pipeline-eligible (envelope survives the build)', async () => {
    await fc.assert(
      fc.asyncProperty(envelopeContextArb(), async arbContext => {
        const flow = await runProducer(arbContext as JobContext);

        const parsed = llmGenerationJobDataSchema.safeParse(flow.data);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          // The three-tier trap: schema-valid is NOT enough — the worker's
          // ContextStep only accepts envelope. The producer must never
          // degrade an envelope context to something the pipeline rejects.
          expect(parsed.data.context.kind).toBe('envelope');
          expect(parsed.data.context.rawAssemblyInputs).toBeDefined();
        }
      })
    );
  });

  it('children are exclusively preprocessing job types with unique job ids', async () => {
    await fc.assert(
      fc.asyncProperty(envelopeContextArb(), async arbContext => {
        const flow = await runProducer(arbContext as JobContext);
        const children = flow.children ?? [];

        for (const child of children) {
          expect([JobType.AudioTranscription, JobType.ImageDescription]).toContain(child.name);
        }
        // BullMQ's dedup key is opts.jobId — a collision there means a
        // silently dropped job. Assert it exists (no fallback that could
        // mask a missing id as "unique") and is unique across children.
        const ids = children.map(c => {
          expect(c.opts?.jobId).toBeTruthy();
          return c.opts?.jobId;
        });
        expect(new Set(ids).size).toBe(ids.length);
      })
    );
  });
});
