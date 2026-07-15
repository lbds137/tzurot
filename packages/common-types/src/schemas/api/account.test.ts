import { describe, it, expect } from 'vitest';
import {
  StartAccountExportInputSchema,
  StartAccountExportResponseSchema,
  AccountExportStatusResponseSchema,
  AccountExportJobSummarySchema,
  AccountExportJobStatusSchema,
} from './account.js';

describe('StartAccountExportInputSchema', () => {
  it('accepts an empty body and strips extras', () => {
    expect(StartAccountExportInputSchema.safeParse({}).success).toBe(true);
    const parsed = StartAccountExportInputSchema.parse({ stray: true });
    expect(parsed).toEqual({});
  });
});

describe('StartAccountExportResponseSchema', () => {
  it('accepts the accepted-job shape', () => {
    const result = StartAccountExportResponseSchema.safeParse({
      success: true,
      exportJobId: '123e4567-e89b-42d3-a456-426614174000',
      status: 'pending',
      downloadUrl: 'https://gateway.example/exports/123e4567-e89b-42d3-a456-426614174000',
      expiresAt: '2026-07-16T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects success:false (the route only emits the happy shape)', () => {
    expect(
      StartAccountExportResponseSchema.safeParse({
        success: false,
        exportJobId: 'x',
        status: 'pending',
        downloadUrl: 'u',
        expiresAt: 'e',
      }).success
    ).toBe(false);
  });
});

describe('AccountExportJobSummarySchema', () => {
  const BASE = {
    id: 'job-1',
    status: 'pending',
    fileName: null,
    fileSizeBytes: null,
    createdAt: '2026-07-15T00:00:00.000Z',
    completedAt: null,
    expiresAt: '2026-07-16T00:00:00.000Z',
    downloadUrl: null,
  };

  it('accepts a pending job with all nullable fields null', () => {
    expect(AccountExportJobSummarySchema.safeParse(BASE).success).toBe(true);
  });

  it('rejects a non-integer fileSizeBytes', () => {
    expect(AccountExportJobSummarySchema.safeParse({ ...BASE, fileSizeBytes: 1.5 }).success).toBe(
      false
    );
  });

  it('rejects a missing expiresAt (the download-lifetime field is required)', () => {
    const { expiresAt: _expiresAt, ...withoutExpiry } = BASE;
    expect(AccountExportJobSummarySchema.safeParse(withoutExpiry).success).toBe(false);
  });

  it('rejects statuses outside the lifecycle vocabulary', () => {
    expect(AccountExportJobSummarySchema.safeParse({ ...BASE, status: 'exploded' }).success).toBe(
      false
    );
  });
});

describe('AccountExportJobStatusSchema', () => {
  it('accepts exactly the four lifecycle states', () => {
    for (const status of ['pending', 'in_progress', 'completed', 'failed']) {
      expect(AccountExportJobStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(AccountExportJobStatusSchema.safeParse('done').success).toBe(false);
  });
});

describe('AccountExportStatusResponseSchema', () => {
  it('accepts a null job (never exported)', () => {
    expect(AccountExportStatusResponseSchema.safeParse({ job: null }).success).toBe(true);
  });

  it('normalizes Date fields to ISO strings (wire-safety across serialization)', () => {
    const parsed = AccountExportStatusResponseSchema.parse({
      job: {
        id: 'job-1',
        status: 'completed',
        fileName: 'tzurot-account-export-alice-2026-07-15.zip',
        fileSizeBytes: 1024,
        createdAt: new Date('2026-07-15T00:00:00Z'),
        completedAt: new Date('2026-07-15T00:01:00Z'),
        expiresAt: '2026-07-16T00:00:00.000Z',
        downloadUrl: 'https://gateway.example/exports/job-1',
      },
    });
    expect(parsed.job?.createdAt).toBe('2026-07-15T00:00:00.000Z');
    expect(parsed.job?.expiresAt).toBe('2026-07-16T00:00:00.000Z');
  });
});
