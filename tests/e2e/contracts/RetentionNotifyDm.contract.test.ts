/**
 * Contract test: retention-notify DM batch (api-gateway producer → bot-client consumer).
 *
 * Reads the COMMITTED fixture written by the producer half
 * (`services/api-gateway/src/services/retention/RetentionNotifyContract.producer.test.ts`,
 * which runs the REAL `enqueueNotifyRun`) and validates the captured batch
 * against the notify worker's entry schema — the same `safeParse` gate
 * `createRetentionNotifyProcessor` applies before sending anything.
 *
 * Non-circular by construction: the payload is REAL producer output, so a
 * drift in `enqueueNotifyRun` that breaks the consumer schema (renamed field,
 * missing key, oversized batch) fails HERE.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadContractFixture } from '@tzurot/test-utils';
import { JobType } from '@tzurot/common-types/constants/queue';
import { retentionNotifyDmJobDataSchema } from '@tzurot/common-types/types/jobs';
import { DiscordSnowflakeSchema } from '@tzurot/common-types/schemas/api/internal';

interface CapturedBatch {
  name: string;
  data: unknown;
  opts?: { jobId?: string };
}

describe('Contract: retention-notify DM batch (real producer fixture → consumer schema)', () => {
  let batch: CapturedBatch;

  beforeAll(() => {
    batch = loadContractFixture<CapturedBatch>('retention-notify/batch.json');
  });

  it('is enqueued under the RetentionNotifyDm job type with a runId-scoped jobId', () => {
    expect(batch.name).toBe(JobType.RetentionNotifyDm);
    expect(batch.opts?.jobId).toMatch(/^retention-notify:.+:0$/);
  });

  it("validates against the notify worker's entry schema (its safeParse gate)", () => {
    const parsed = retentionNotifyDmJobDataSchema.safeParse(batch.data);
    expect(parsed.success).toBe(true);
  });

  it('carries the fields the worker reads: internal ids and snowflakes', () => {
    const data = retentionNotifyDmJobDataSchema.parse(batch.data);
    expect(data.runId.length).toBeGreaterThan(0);
    expect(data.recipients.length).toBeGreaterThan(0);
    for (const recipient of data.recipients) {
      expect(recipient.userId).toMatch(/^[0-9a-f-]{36}$/);
      // The canonical schema, not a re-typed regex — it cannot drift.
      expect(DiscordSnowflakeSchema.safeParse(recipient.discordUserId).success).toBe(true);
    }
  });
});
