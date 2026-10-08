/**
 * Contract test: catalog-drift alert batch (api-gateway producer → bot-client
 * consumer).
 *
 * Reads the COMMITTED fixture written by the producer half
 * (`services/api-gateway/src/services/CatalogDriftContract.producer.test.ts`,
 * which runs the REAL `CatalogDriftChecker.check()`) and validates the
 * captured batch against the alert worker's entry schema — the same
 * `safeParse` gate `createCatalogDriftAlertProcessor` applies before posting
 * anything.
 *
 * Non-circular by construction: the payload is REAL producer output, so a
 * drift in the checker that breaks the consumer schema (renamed field,
 * missing key, oversized batch) fails HERE.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadContractFixture } from '@tzurot/test-utils';
import { JobType } from '@tzurot/common-types/constants/queue';
import { catalogDriftAlertJobDataSchema } from '@tzurot/common-types/types/jobs';

interface CapturedBatch {
  name: string;
  data: unknown;
  opts?: { jobId?: string };
}

describe('Contract: catalog-drift alert batch (real producer fixture → consumer schema)', () => {
  let batch: CapturedBatch;

  beforeAll(() => {
    batch = loadContractFixture<CapturedBatch>('catalog-drift-alert/batch.json');
  });

  it('is enqueued under the CatalogDriftAlert job type with a cycle-scoped jobId', () => {
    expect(batch.name).toBe(JobType.CatalogDriftAlert);
    expect(batch.opts?.jobId).toMatch(/^catalog-drift-/);
    expect(batch.opts?.jobId).not.toContain(':');
  });

  it("validates against the alert worker's entry schema (its safeParse gate)", () => {
    const parsed = catalogDriftAlertJobDataSchema.safeParse(batch.data);
    expect(parsed.success).toBe(true);
  });

  it('carries the fields the worker renders: config names, model ids, and role kinds', () => {
    const data = catalogDriftAlertJobDataSchema.parse(batch.data);
    expect(data.drifts.length).toBeGreaterThan(0);
    for (const drift of data.drifts) {
      expect(drift.configId).toMatch(/^[0-9a-f-]{36}$/);
      expect(drift.configName.length).toBeGreaterThan(0);
      expect(drift.modelId.length).toBeGreaterThan(0);
      expect(['default', 'free-default', 'global']).toContain(drift.kind);
    }
  });
});
