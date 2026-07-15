/**
 * Component test: feedback intake gates over the REAL mounted gateway
 * surface (conformance harness: generated mounts, real auth middleware,
 * PGLite, mock Redis). Proves the dedupe query + its new composite index
 * end-to-end, plus the cooldown and the attempt-counting daily cap.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { SubmitFeedbackResponseSchema } from '@tzurot/common-types/schemas/api/feedback';
import {
  buildConformanceHarness,
  authHeaders,
  ACTOR_DISCORD_ID,
  type ConformanceHarness,
} from '../conformance/fixtures/harness.js';

describe('feedback intake (component, real mounts over PGLite)', () => {
  let harness: ConformanceHarness;

  beforeAll(async () => {
    harness = await buildConformanceHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  async function submit(content: string) {
    return request(harness.app).post('/api/user/feedback').set(authHeaders()).send({ content });
  }

  async function clearCooldown(): Promise<void> {
    await harness.deps.redis?.del(`${REDIS_KEY_PREFIXES.FEEDBACK_COOLDOWN}${ACTOR_DISCORD_ID}`);
  }

  it('accepts, then cooldown-blocks, then dedupe-blocks a normalized variant', async () => {
    const first = await submit('The bot is great');
    expect(first.status).toBe(201);
    const parsed = SubmitFeedbackResponseSchema.parse(first.body);
    expect(parsed.feedbackId).toMatch(/^[0-9a-f-]{36}$/);

    // Immediate resubmission hits the cooldown (armed by the success above).
    const tooSoon = await submit('completely different content');
    expect(tooSoon.status).toBe(400);
    expect(String(tooSoon.body.message)).toContain('too quickly');

    // Past the cooldown, a whitespace/case VARIANT of the stored content is
    // caught by the DB dedupe (the normalized-hash lookup this PR indexes).
    await clearCooldown();
    const variant = await submit('  the   BOT is\ngreat ');
    expect(variant.status).toBe(400);
    expect(String(variant.body.message)).toContain('already submitted');

    // Genuinely different content is accepted.
    await clearCooldown();
    const different = await submit('the voice replies cut off sometimes');
    expect(different.status).toBe(201);
  });

  it('daily cap counts attempts and rejects past the limit', async () => {
    // Burn the remaining budget (2 accepted + 1 dedupe-rejected attempt so
    // far = 3 counted; the cap is 5).
    await clearCooldown();
    expect((await submit('feedback number three')).status).toBe(201);
    await clearCooldown();
    expect((await submit('feedback number four')).status).toBe(201);

    await clearCooldown();
    const overCap = await submit('feedback number five never lands');
    expect(overCap.status).toBe(400);
    expect(String(overCap.body.message)).toContain('per day');
  });
});
