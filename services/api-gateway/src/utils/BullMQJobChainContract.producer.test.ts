/**
 * Producer half of the api-gateway → ai-worker BullMQ job-chain contract.
 *
 * Runs the REAL `createJobChain()` and snapshots the captured `flowProducer.add`
 * payload (LLM parent + audio/image preprocessing children) to a committed JSON
 * fixture under `@tzurot/test-utils` (`fixtures/contracts/bullmq-job-chain/`).
 * `--update` regenerates the fixture; CI COMPARES (strict). Drift in
 * `createJobChain`'s output → CI fails → regenerate-on-purpose and commit the diff.
 *
 * The consumer half (`tests/e2e/contracts/BullMQJobChain.contract.test.ts`) reads
 * the SAME fixture and validates each payload against the ai-worker handlers'
 * entry schemas. The committed fixture IS the contract artifact — the two services
 * share data, not code, so neither imports the other (depcruise boundary intact).
 * This is what makes the test non-circular: the payload is REAL producer output,
 * not a hand-written shape that trivially satisfies its own schema.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contractFixtureFile, stableFixtureJson } from '@tzurot/test-utils';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { JobType } from '@tzurot/common-types/constants/queue';
import {
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
  type JobContext,
  type ResponseDestination,
} from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { LlmConfigResolver, VisionConfigResolver } from '@tzurot/config-resolver';

// Mock the queue (capture the FlowProducer.add payload without a real queue)
vi.mock('../queue.js', () => ({ flowProducer: { add: vi.fn() } }));

// Mock getConfig so QUEUE_NAME is deterministic in the captured payload
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({ QUEUE_NAME: 'test-queue' }),
  };
});

import { createJobChain } from './jobChainOrchestrator.js';
import { flowProducer } from '../queue.js';

// Stub BOTH config resolvers to take the PRODUCTION path: real callers
// (generate.ts) always pass `deps.llmConfigResolver` AND `deps.visionConfigResolver`,
// so `stampResolvedConfig` resolves a user-tier TEXT config (→ personality.model)
// and an INDEPENDENT vision config (→ personality.visionModel carrier). Omitting
// them would capture the no-resolver fallback (configSource: 'personality', raw
// seed, no vision) — an unrepresentative shape.
const resolverStub: LlmConfigResolver = {
  resolveConfig: vi.fn().mockResolvedValue({
    source: 'user-personality',
    config: { model: 'resolved/model' },
  }),
} as unknown as LlmConfigResolver;

// The vision cascade is its own axis: config.model IS the vision model carrier.
const visionResolverStub: VisionConfigResolver = {
  resolveConfig: vi.fn().mockResolvedValue({
    source: 'personality',
    config: { model: 'resolved/vision-model' },
  }),
  // stampResolvedConfig also reads the two default pointers for the
  // visionFallbackModels chain. Return null (no admin fallbacks) so the snapshot
  // carries only the resolved visionModel, not a fallback chain.
  getGlobalDefaultConfig: vi.fn().mockResolvedValue(null),
  getFreeDefaultVisionConfig: vi.fn().mockResolvedValue(null),
} as unknown as VisionConfigResolver;

const PERSONALITY: LoadedPersonality = {
  id: 'pers-fixture',
  name: 'FixtureBot',
  displayName: 'Fixture Bot',
  slug: 'fixturebot',
  ownerId: 'owner-fixture',
  systemPrompt: 'Fixture prompt',
  model: 'test-model',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 1000,
  contextWindowTokens: 4096,
  characterInfo: 'Fixture character',
  personalityTraits: 'Fixture traits',
  voiceEnabled: false,
};

const RESPONSE_DESTINATION: ResponseDestination = {
  type: 'discord',
  channelId: 'fixture-channel',
  webhookUrl: 'https://discord.com/api/webhooks/fixture',
};

describe('BullMQ job-chain contract — producer fixture generation', () => {
  beforeEach(() => {
    // createJobChain's payload carries no timers/Date.now, so fake timers are a
    // no-op here — present for 02-code-standards "Fake Timers (ALWAYS Use)"
    // consistency (mirrors RawEnvelopeContract.producer.test.ts).
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Minimal partial of the real JobNode return — createJobChain only reads
    // `flow.job.id`, so a full Job mock would be noise.
    vi.mocked(flowProducer.add).mockResolvedValue({
      job: { id: 'llm-job-fixture' },
      children: [],
    } as unknown as Awaited<ReturnType<typeof flowProducer.add>>);
  });
  afterEach(() => vi.restoreAllMocks());

  it('audio-and-image: a chain with one audio + one image attachment', async () => {
    const context: JobContext = {
      userId: 'fixture-user',
      channelId: 'fixture-channel',
      attachments: [
        {
          url: 'https://cdn.example/voice.ogg',
          name: 'voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        },
        {
          url: 'https://cdn.example/photo.png',
          name: 'photo.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 2048,
        },
      ],
    };

    await createJobChain({
      requestId: 'fixture-req',
      personality: PERSONALITY,
      message: 'What is in this audio and image?',
      context,
      responseDestination: RESPONSE_DESTINATION,
      llmConfigResolver: resolverStub,
      visionConfigResolver: visionResolverStub,
    });

    const flowCall = vi.mocked(flowProducer.add).mock.calls[0][0] as unknown as {
      name: string;
      data: unknown;
      children?: { name: string; data: unknown }[];
    };

    // The REAL producer output must validate against the consumer's entry schemas.
    // A drift in createJobChain (wrong field, missing required key) fails HERE,
    // which the old hand-written circular test could never catch.
    expect(llmGenerationJobDataSchema.safeParse(flowCall.data).success).toBe(true);
    const children = flowCall.children ?? [];
    const audioChild = children.find(c => c.name === JobType.AudioTranscription);
    const imageChild = children.find(c => c.name === JobType.ImageDescription);
    expect(audioTranscriptionJobDataSchema.safeParse(audioChild?.data).success).toBe(true);
    expect(imageDescriptionJobDataSchema.safeParse(imageChild?.data).success).toBe(true);

    // Snapshot the captured chain — the committed contract artifact the consumer reads.
    await expect(stableFixtureJson(flowCall)).toMatchFileSnapshot(
      contractFixtureFile('bullmq-job-chain/audio-and-image.json')
    );
  });

  it('text-only: a plain message with no attachments (no children, no dependencies)', async () => {
    // The dominant path: no attachments → createJobChain emits an LLM-only flow
    // with no children and `dependencies: undefined`. A regression here would slip
    // past the audio-and-image fixture entirely.
    const context: JobContext = { userId: 'fixture-user', channelId: 'fixture-channel' };

    await createJobChain({
      requestId: 'fixture-req-text',
      personality: PERSONALITY,
      message: 'just a plain text message',
      context,
      responseDestination: RESPONSE_DESTINATION,
      llmConfigResolver: resolverStub,
      visionConfigResolver: visionResolverStub,
    });

    const flowCall = vi.mocked(flowProducer.add).mock.calls[0][0] as unknown as {
      name: string;
      data: unknown;
      children?: unknown[];
    };

    expect(llmGenerationJobDataSchema.safeParse(flowCall.data).success).toBe(true);
    expect(flowCall.children).toBeUndefined();

    await expect(stableFixtureJson(flowCall)).toMatchFileSnapshot(
      contractFixtureFile('bullmq-job-chain/text-only.json')
    );
  });
});
