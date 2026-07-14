/**
 * Contract test: release-broadcast DM batch (api-gateway producer → bot-client consumer).
 *
 * Reads the COMMITTED fixture written by the producer half
 * (`services/api-gateway/src/services/ReleaseBroadcastContract.producer.test.ts`,
 * which runs the REAL `enqueueBroadcast`) and validates the captured batch
 * against the DM worker's entry schema — the same `safeParse` gate
 * `createReleaseDmProcessor` applies before sending anything.
 *
 * Non-circular by construction: the payload is REAL producer output, so a
 * drift in `enqueueBroadcast` that breaks the consumer schema (renamed field,
 * missing key, oversized batch) fails HERE.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadContractFixture } from '@tzurot/test-utils';
import { JobType } from '@tzurot/common-types/constants/queue';
import { releaseBroadcastDmJobDataSchema } from '@tzurot/common-types/types/jobs';

interface CapturedBatch {
  name: string;
  data: unknown;
  opts?: { jobId?: string };
}

describe('Contract: release-broadcast DM batch (real producer fixture → consumer schema)', () => {
  let batch: CapturedBatch;

  beforeAll(() => {
    batch = loadContractFixture<CapturedBatch>('release-broadcast/batch.json');
  });

  it('is enqueued under the ReleaseBroadcastDm job type with a deterministic jobId', () => {
    expect(batch.name).toBe(JobType.ReleaseBroadcastDm);
    expect(batch.opts?.jobId).toMatch(/^release-broadcast:[0-9a-f-]{36}:0$/);
  });

  it("validates against the DM worker's entry schema (its safeParse gate)", () => {
    const parsed = releaseBroadcastDmJobDataSchema.safeParse(batch.data);
    expect(parsed.success).toBe(true);
  });

  it('carries the fields the worker reads: ledger ids, snowflakes, and the body', () => {
    const data = releaseBroadcastDmJobDataSchema.parse(batch.data);
    expect(data.releaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.body.length).toBeGreaterThan(0);
    expect(data.recipients.length).toBeGreaterThan(0);
    for (const recipient of data.recipients) {
      expect(recipient.deliveryLogId).toMatch(/^[0-9a-f-]{36}$/);
      expect(recipient.userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(recipient.discordUserId).toMatch(/^\d{17,19}$/);
    }
  });
});
