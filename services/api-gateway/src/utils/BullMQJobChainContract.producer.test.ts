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
import {
  generatePersonalityUuid,
  generateUserUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
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
  // Real (deterministic) UUID: the consumer contract test runs these fixtures
  // through the REAL pipeline, whose history queries hit uuid columns.
  id: generatePersonalityUuid('fixturebot'),
  name: 'FixtureBot',
  displayName: 'Fixture Bot',
  slug: 'fixturebot',
  ownerId: generateUserUuid('owner-fixture'),
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

  it('envelope-minimal: the thin shape bot-client actually ships (no attachments)', async () => {
    // Post-cutover, kind:'envelope' is the ONLY shape bot-client sends. The
    // legacy fixtures above remain deliberately: the consumer half asserts
    // they are schema-tolerated but REJECTED by ContextStep's envelope gate.
    const context: JobContext = {
      userId: 'fixture-user',
      channelId: 'fixture-channel',
      kind: 'envelope',
      rawAssemblyInputs: {
        rawMessageContent: 'hello from the thin envelope',
      },
    };

    await createJobChain({
      requestId: 'fixture-req-envelope',
      personality: PERSONALITY,
      message: 'hello from the thin envelope',
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
      contractFixtureFile('bullmq-job-chain/envelope-minimal.json')
    );
  });

  it('envelope-referenced-attachments: thin envelope with image+audio on referenced messages (the regression shape)', async () => {
    // The regression class this suite exists for: under thin envelope the bot
    // drops context.referencedMessages, so preprocessing children MUST derive
    // from rawAssemblyInputs.rawReferencedMessages, keyed by referenceNumber.
    const context: JobContext = {
      userId: 'fixture-user',
      channelId: 'fixture-channel',
      kind: 'envelope',
      rawAssemblyInputs: {
        rawMessageContent: 'what are these?',
        rawReferencedMessages: [
          {
            referenceNumber: 1,
            discordMessageId: '100000000000000001',
            discordUserId: '200000000000000001',
            authorUsername: 'ref-author',
            authorDisplayName: 'Ref Author',
            content: 'look at this picture',
            embeds: '',
            timestamp: '2026-01-01T00:00:00.000Z',
            locationContext: 'Server > #channel',
            attachments: [
              {
                url: 'https://cdn.example/ref-photo.png',
                name: 'ref-photo.png',
                contentType: CONTENT_TYPES.IMAGE_PNG,
                size: 2048,
              },
            ],
          },
          {
            referenceNumber: 2,
            discordMessageId: '100000000000000002',
            discordUserId: '200000000000000002',
            authorUsername: 'ref-author-2',
            authorDisplayName: 'Ref Author 2',
            content: 'and this voice note',
            embeds: '',
            timestamp: '2026-01-01T00:01:00.000Z',
            locationContext: 'Server > #channel',
            attachments: [
              {
                url: 'https://cdn.example/ref-voice.ogg',
                name: 'ref-voice.ogg',
                contentType: CONTENT_TYPES.AUDIO_OGG,
                size: 1024,
              },
            ],
          },
        ],
      },
    };

    await createJobChain({
      requestId: 'fixture-req-envelope-refs',
      personality: PERSONALITY,
      message: 'what are these?',
      context,
      responseDestination: RESPONSE_DESTINATION,
      llmConfigResolver: resolverStub,
      visionConfigResolver: visionResolverStub,
    });

    const flowCall = vi.mocked(flowProducer.add).mock.calls[0][0] as unknown as {
      name: string;
      data: unknown;
      children?: { name: string; data: { sourceReferenceNumber?: number } }[];
    };

    expect(llmGenerationJobDataSchema.safeParse(flowCall.data).success).toBe(true);
    const children = flowCall.children ?? [];
    // One image child (ref 1) + one audio child (ref 2), each stamped with
    // its source reference number — the key DependencyStep re-associates by.
    expect(
      children.map(c => c.data.sourceReferenceNumber).sort((a, b) => (a ?? 0) - (b ?? 0))
    ).toEqual([1, 2]);
    expect(
      imageDescriptionJobDataSchema.safeParse(
        children.find(c => c.name === JobType.ImageDescription)?.data
      ).success
    ).toBe(true);
    expect(
      audioTranscriptionJobDataSchema.safeParse(
        children.find(c => c.name === JobType.AudioTranscription)?.data
      ).success
    ).toBe(true);

    await expect(stableFixtureJson(flowCall)).toMatchFileSnapshot(
      contractFixtureFile('bullmq-job-chain/envelope-referenced-attachments.json')
    );
  });

  it('envelope-direct-attachments: thin envelope with the trigger message OWN image+audio (the most common attachment path)', async () => {
    const context: JobContext = {
      userId: 'fixture-user',
      channelId: 'fixture-channel',
      kind: 'envelope',
      attachments: [
        {
          url: 'https://cdn.example/direct-voice.ogg',
          name: 'direct-voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          size: 1024,
        },
        {
          url: 'https://cdn.example/direct-photo.png',
          name: 'direct-photo.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          size: 2048,
        },
      ],
      rawAssemblyInputs: {
        rawMessageContent: 'what do you make of these?',
      },
    };

    await createJobChain({
      requestId: 'fixture-req-envelope-direct',
      personality: PERSONALITY,
      message: 'what do you make of these?',
      context,
      responseDestination: RESPONSE_DESTINATION,
      llmConfigResolver: resolverStub,
      visionConfigResolver: visionResolverStub,
    });

    const flowCall = vi.mocked(flowProducer.add).mock.calls[0][0] as unknown as {
      name: string;
      data: unknown;
      children?: { name: string; data: { sourceReferenceNumber?: number } }[];
    };

    expect(llmGenerationJobDataSchema.safeParse(flowCall.data).success).toBe(true);
    const children = flowCall.children ?? [];
    expect(children).toHaveLength(2);
    // Direct attachments carry NO reference stamp — that's what routes them
    // to the consumer's direct bucket rather than a reference bucket.
    for (const child of children) {
      expect(child.data.sourceReferenceNumber).toBeUndefined();
    }

    await expect(stableFixtureJson(flowCall)).toMatchFileSnapshot(
      contractFixtureFile('bullmq-job-chain/envelope-direct-attachments.json')
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
