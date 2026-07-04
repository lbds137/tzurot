/**
 * Contract test: BullMQ job chain (api-gateway producer → ai-worker consumer).
 *
 * Reads the COMMITTED fixture written by the producer half
 * (`services/api-gateway/src/utils/BullMQJobChainContract.producer.test.ts`, which
 * runs the REAL `createJobChain`) and validates each captured payload against the
 * ai-worker handlers' entry schemas — the same gates `ValidationStep` and the
 * audio/image handlers `safeParse` with on entry.
 *
 * This is what makes it NON-circular, unlike the hand-written tests it replaces:
 * the payload is REAL producer output, so a drift in `createJobChain` that breaks
 * a consumer schema (a renamed field, a missing required key) fails HERE. A test
 * that authors its own payload to satisfy the schema can never catch that.
 *
 * The committed fixture IS the contract artifact — the two services share data,
 * not code, so neither imports the other (depcruise boundary intact).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadContractFixture } from '@tzurot/test-utils';
import { JobType } from '@tzurot/common-types/constants/queue';
import {
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
} from '@tzurot/common-types/types/jobs';

/** The captured `flowProducer.add` payload shape (parent + preprocessing children). */
interface CapturedChain {
  name: string;
  data: unknown;
  children?: { name: string; data: unknown }[];
}

describe('Contract: BullMQ job chain (real producer fixture → consumer schemas)', () => {
  let chain: CapturedChain;
  let audioChild: { name: string; data: unknown } | undefined;
  let imageChild: { name: string; data: unknown } | undefined;

  beforeAll(() => {
    chain = loadContractFixture<CapturedChain>('bullmq-job-chain/audio-and-image.json');
    audioChild = (chain.children ?? []).find(c => c.name === JobType.AudioTranscription);
    imageChild = (chain.children ?? []).find(c => c.name === JobType.ImageDescription);
  });

  it('the captured chain has the expected parent + child shape', () => {
    expect(chain.name).toBe(JobType.LLMGeneration);
    expect(audioChild).toBeDefined();
    expect(imageChild).toBeDefined();
  });

  describe('LLM generation (parent job)', () => {
    it("validates against the consumer's entry schema (the ValidationStep gate)", () => {
      const parsed = llmGenerationJobDataSchema.safeParse(chain.data);
      expect(parsed.success).toBe(true);
    });

    it('carries the fields the LLM handler reads', () => {
      const data = llmGenerationJobDataSchema.parse(chain.data);
      expect(data.jobType).toBe(JobType.LLMGeneration);
      expect(data.personality.id).toBeTruthy();
      expect(data.message).toBeTruthy();
      // One dependency per preprocessing child — the handler waits on both.
      expect(data.dependencies).toHaveLength(2);
    });
  });

  describe('audio transcription (preprocessing child)', () => {
    it("validates against the consumer's entry schema", () => {
      expect(audioTranscriptionJobDataSchema.safeParse(audioChild?.data).success).toBe(true);
    });

    it('carries the audio fields the handler reads', () => {
      expect(audioChild).toBeDefined(); // guard: .parse(undefined) would throw an opaque ZodError
      const data = audioTranscriptionJobDataSchema.parse(audioChild?.data);
      expect(data.attachment.contentType.startsWith('audio/')).toBe(true);
      expect(data.attachment.url).toBeTruthy();
      expect(data.context.userId).toBeTruthy();
    });
  });

  describe('image description (preprocessing child)', () => {
    it("validates against the consumer's entry schema", () => {
      expect(imageDescriptionJobDataSchema.safeParse(imageChild?.data).success).toBe(true);
    });

    it('carries the image fields the handler reads', () => {
      expect(imageChild).toBeDefined(); // guard: .parse(undefined) would throw an opaque ZodError
      const data = imageDescriptionJobDataSchema.parse(imageChild?.data);
      expect(data.attachments.length).toBeGreaterThan(0);
      expect(data.attachments[0].contentType.startsWith('image/')).toBe(true);
      expect(data.personality.id).toBeTruthy();
    });
  });

  describe('text-only chain (no attachments — the dominant path)', () => {
    it('validates as an LLM-only flow with no children and no dependencies', () => {
      const textChain = loadContractFixture<CapturedChain>('bullmq-job-chain/text-only.json');
      expect(textChain.name).toBe(JobType.LLMGeneration);
      expect(textChain.children).toBeUndefined();
      const data = llmGenerationJobDataSchema.parse(textChain.data);
      // No preprocessing children → the LLM job waits on nothing.
      expect(data.dependencies).toBeUndefined();
    });
  });
});
