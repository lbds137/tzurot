/**
 * Shapes API Contract Tests
 */

import { describe, it, expect } from 'vitest';
import {
  StoreShapesAuthInputSchema,
  StoreShapesAuthResponseSchema,
  DeleteShapesAuthResponseSchema,
  ShapesAuthStatusResponseSchema,
  ListShapesResponseSchema,
  ShapesListItemSchema,
  StartShapesImportInputSchema,
  StartShapesImportResponseSchema,
  ShapesImportJobSummarySchema,
  ListShapesImportJobsResponseSchema,
  StartShapesExportInputSchema,
  StartShapesExportResponseSchema,
  ShapesExportJobSummarySchema,
  ListShapesExportJobsResponseSchema,
} from './shapes.js';

describe('Shapes API Contract Tests', () => {
  describe('StoreShapesAuthInputSchema', () => {
    it('accepts non-empty sessionCookie', () => {
      expect(StoreShapesAuthInputSchema.safeParse({ sessionCookie: 'abc' }).success).toBe(true);
    });
    it('rejects empty sessionCookie', () => {
      expect(StoreShapesAuthInputSchema.safeParse({ sessionCookie: '' }).success).toBe(false);
    });
  });

  describe('StoreShapesAuthResponseSchema', () => {
    it('accepts success response', () => {
      const data = { success: true as const, timestamp: '2026-05-25T00:00:00.000Z' };
      expect(StoreShapesAuthResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('DeleteShapesAuthResponseSchema', () => {
    it('accepts delete-success response', () => {
      const data = {
        success: true as const,
        message: 'removed',
        timestamp: '2026-05-25T00:00:00.000Z',
      };
      expect(DeleteShapesAuthResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('ShapesAuthStatusResponseSchema', () => {
    it('accepts hasCredentials=false (minimal shape)', () => {
      const data = { hasCredentials: false as const, service: 'shapes_inc' };
      expect(ShapesAuthStatusResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts hasCredentials=true with timestamps', () => {
      const data = {
        hasCredentials: true as const,
        service: 'shapes_inc',
        storedAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-05-25T00:00:00.000Z',
        expiresAt: null,
      };
      expect(ShapesAuthStatusResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects hasCredentials=true without timestamps', () => {
      const data = { hasCredentials: true, service: 'shapes_inc' };
      expect(ShapesAuthStatusResponseSchema.safeParse(data).success).toBe(false);
    });
  });

  describe('ShapesListItemSchema', () => {
    it('accepts item with createdAt timestamp', () => {
      const data = {
        id: 's1',
        name: 'Alice',
        username: 'alice',
        avatar: 'http://x',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      expect(ShapesListItemSchema.safeParse(data).success).toBe(true);
    });

    it('accepts item with null createdAt', () => {
      const data = { id: 's1', name: 'Alice', username: 'alice', avatar: '', createdAt: null };
      expect(ShapesListItemSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('ListShapesResponseSchema', () => {
    it('accepts empty list', () => {
      expect(ListShapesResponseSchema.safeParse({ shapes: [], total: 0 }).success).toBe(true);
    });
  });

  describe('StartShapesImportInputSchema', () => {
    it('accepts sourceSlug only (importType optional)', () => {
      expect(StartShapesImportInputSchema.safeParse({ sourceSlug: 'alice' }).success).toBe(true);
    });

    it('accepts both known importType values', () => {
      expect(
        StartShapesImportInputSchema.safeParse({ sourceSlug: 'a', importType: 'full' }).success
      ).toBe(true);
      expect(
        StartShapesImportInputSchema.safeParse({ sourceSlug: 'a', importType: 'memory_only' })
          .success
      ).toBe(true);
    });

    it('rejects empty sourceSlug', () => {
      expect(StartShapesImportInputSchema.safeParse({ sourceSlug: '' }).success).toBe(false);
    });

    it('rejects unknown importType', () => {
      expect(
        StartShapesImportInputSchema.safeParse({ sourceSlug: 'a', importType: 'partial' }).success
      ).toBe(false);
    });
  });

  describe('StartShapesExportInputSchema', () => {
    it('accepts slug only (format optional)', () => {
      expect(StartShapesExportInputSchema.safeParse({ slug: 'alice' }).success).toBe(true);
    });

    it('accepts both known format values', () => {
      expect(StartShapesExportInputSchema.safeParse({ slug: 'a', format: 'json' }).success).toBe(
        true
      );
      expect(
        StartShapesExportInputSchema.safeParse({ slug: 'a', format: 'markdown' }).success
      ).toBe(true);
    });

    it('rejects empty slug', () => {
      expect(StartShapesExportInputSchema.safeParse({ slug: '' }).success).toBe(false);
    });

    it('rejects unknown format', () => {
      expect(StartShapesExportInputSchema.safeParse({ slug: 'a', format: 'csv' }).success).toBe(
        false
      );
    });
  });

  describe('StartShapesImportResponseSchema', () => {
    it('accepts import-start response', () => {
      const data = {
        success: true as const,
        importJobId: 'job-1',
        sourceSlug: 'alice',
        importType: 'memories',
        status: 'pending',
      };
      expect(StartShapesImportResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('ShapesImportJobSummarySchema', () => {
    it('accepts a completed-job summary with numeric counts', () => {
      const data = {
        id: 'job-1',
        sourceSlug: 'alice',
        status: 'completed',
        importType: 'memories',
        memoriesImported: 42,
        memoriesFailed: 0,
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: '2026-05-25T00:01:00.000Z',
        errorMessage: null,
        importMetadata: { hint: 'wip' },
      };
      expect(ShapesImportJobSummarySchema.safeParse(data).success).toBe(true);
    });

    it('accepts an in-flight job with null counts (Prisma Int? columns)', () => {
      const data = {
        id: 'job-2',
        sourceSlug: 'alice',
        status: 'pending',
        importType: 'memories',
        memoriesImported: null,
        memoriesFailed: null,
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: null,
        errorMessage: null,
        importMetadata: null,
      };
      expect(ShapesImportJobSummarySchema.safeParse(data).success).toBe(true);
    });
  });

  describe('ListShapesImportJobsResponseSchema', () => {
    it('accepts empty jobs list', () => {
      expect(ListShapesImportJobsResponseSchema.safeParse({ jobs: [] }).success).toBe(true);
    });
  });

  describe('StartShapesExportResponseSchema', () => {
    it('accepts export-start response', () => {
      const data = {
        success: true as const,
        exportJobId: 'job-2',
        sourceSlug: 'alice',
        format: 'json',
        status: 'pending',
        downloadUrl: 'https://example.com/exports/job-2',
      };
      expect(StartShapesExportResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('ShapesExportJobSummarySchema', () => {
    it('accepts a job summary with null downloadUrl (still pending)', () => {
      const data = {
        id: 'job-2',
        sourceSlug: 'alice',
        status: 'pending',
        format: 'json',
        fileName: null,
        fileSizeBytes: null,
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: null,
        expiresAt: '2026-05-26T00:00:00.000Z',
        errorMessage: null,
        exportMetadata: null,
        downloadUrl: null,
      };
      expect(ShapesExportJobSummarySchema.safeParse(data).success).toBe(true);
    });

    it('rejects null expiresAt (handler always populates it; Prisma DateTime not nullable)', () => {
      const data = {
        id: 'job-2',
        sourceSlug: 'alice',
        status: 'pending',
        format: 'json',
        fileName: null,
        fileSizeBytes: null,
        createdAt: '2026-05-25T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
        errorMessage: null,
        exportMetadata: null,
        downloadUrl: null,
      };
      expect(ShapesExportJobSummarySchema.safeParse(data).success).toBe(false);
    });
  });

  describe('ListShapesExportJobsResponseSchema', () => {
    it('accepts empty jobs list', () => {
      expect(ListShapesExportJobsResponseSchema.safeParse({ jobs: [] }).success).toBe(true);
    });
  });
});
