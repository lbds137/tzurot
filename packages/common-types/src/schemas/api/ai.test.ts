import { describe, it, expect } from 'vitest';
import {
  AiJobAckResponseSchema,
  AiGenerateResponseSchema,
  AiTranscribeResponseSchema,
  AiJobStatusResponseSchema,
  AiConfirmDeliveryResponseSchema,
} from './ai.js';
import { JobStatus } from '../../constants/queue.js';

describe('AiJobAckResponseSchema', () => {
  it('accepts the minimal queued-ack shape', () => {
    const queued = {
      jobId: 'job-uuid',
      requestId: 'req-uuid',
      status: JobStatus.Queued,
    };
    expect(AiJobAckResponseSchema.safeParse(queued).success).toBe(true);
  });

  it('accepts the full completed-with-result shape', () => {
    const completed = {
      jobId: 'job-uuid',
      requestId: 'req-uuid',
      status: JobStatus.Completed,
      result: { content: 'arbitrary trusted payload' },
      timestamp: '2026-05-23T12:00:00Z',
    };
    expect(AiJobAckResponseSchema.safeParse(completed).success).toBe(true);
  });

  it('rejects status not in JobStatus enum', () => {
    expect(
      AiJobAckResponseSchema.safeParse({
        jobId: 'job',
        requestId: 'req',
        status: 'TOTALLY_MADE_UP_STATUS',
      }).success
    ).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(
      AiJobAckResponseSchema.safeParse({ jobId: 'job', status: JobStatus.Queued }).success
    ).toBe(false);
  });
});

describe('AiGenerateResponseSchema and AiTranscribeResponseSchema', () => {
  it('share the ack envelope shape (distinct schema values built from aiJobAckShape)', () => {
    const sample = { jobId: 'j', requestId: 'r', status: JobStatus.Queued };
    expect(AiGenerateResponseSchema.safeParse(sample).success).toBe(true);
    expect(AiTranscribeResponseSchema.safeParse(sample).success).toBe(true);
  });
});

describe('AiJobStatusResponseSchema', () => {
  it('accepts a BullMQ-style status response', () => {
    const status = {
      jobId: 'job-uuid',
      status: 'completed',
      progress: 100,
      result: { content: 'job output' },
      timestamp: '2026-05-23T12:00:00Z',
    };
    expect(AiJobStatusResponseSchema.safeParse(status).success).toBe(true);
  });

  it('accepts status without progress/result (early job lifecycle)', () => {
    const waiting = {
      jobId: 'job-uuid',
      status: 'waiting',
      timestamp: '2026-05-23T12:00:00Z',
    };
    expect(AiJobStatusResponseSchema.safeParse(waiting).success).toBe(true);
  });

  it('accepts arbitrary status strings (BullMQ owns the canonical type)', () => {
    const unknown = { jobId: 'j', status: 'totally-new-state', timestamp: '2026-05-23T12:00:00Z' };
    expect(AiJobStatusResponseSchema.safeParse(unknown).success).toBe(true);
  });
});

describe('AiConfirmDeliveryResponseSchema', () => {
  it('accepts a fresh delivery confirmation', () => {
    expect(
      AiConfirmDeliveryResponseSchema.safeParse({
        jobId: 'job',
        status: 'DELIVERED',
        message: 'Delivery confirmed',
      }).success
    ).toBe(true);
  });

  it('accepts an idempotent (already-confirmed) confirmation', () => {
    expect(
      AiConfirmDeliveryResponseSchema.safeParse({
        jobId: 'job',
        status: 'COMPLETED',
        message: 'Already confirmed',
      }).success
    ).toBe(true);
  });
});
