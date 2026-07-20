/**
 * Tests for Shapes Status Formatters
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatImportJobStatus,
  formatExportJobStatus,
  formatCompactImportStatus,
  formatCompactExportStatus,
  formatFileSize,
  STATUS_EMOJI,
  adaptImportJob,
  adaptExportJob,
  type ImportJob,
  type ExportJob,
} from './statusFormatters.js';

describe('STATUS_EMOJI', () => {
  it('should have emojis for all known statuses', () => {
    expect(STATUS_EMOJI['pending']).toBeDefined();
    expect(STATUS_EMOJI['in_progress']).toBeDefined();
    expect(STATUS_EMOJI['completed']).toBeDefined();
    expect(STATUS_EMOJI['failed']).toBeDefined();
  });
});

describe('formatFileSize', () => {
  it('should format bytes', () => {
    expect(formatFileSize(512)).toBe('512B');
  });

  it('should format kilobytes', () => {
    expect(formatFileSize(2048)).toBe('2.0KB');
  });

  it('should format megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0MB');
  });
});

describe('adaptImportJob', () => {
  const baseImportJob = {
    id: 'job-1',
    sourceSlug: 'test-shape',
    status: 'completed',
    importType: 'full',
    memoriesImported: 5,
    memoriesFailed: 0,
    errorMessage: null,
    importMetadata: null,
  };

  it('passes through string createdAt unchanged', () => {
    const job = { ...baseImportJob, createdAt: '2026-01-01T00:00:00.000Z', completedAt: null };
    expect(adaptImportJob(job).createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('normalizes Date createdAt to ISO string', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    const job = { ...baseImportJob, createdAt: d, completedAt: null };
    expect(adaptImportJob(job).createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves null completedAt', () => {
    const job = { ...baseImportJob, createdAt: '2026-01-01T00:00:00.000Z', completedAt: null };
    expect(adaptImportJob(job).completedAt).toBeNull();
  });

  it('normalizes Date completedAt to ISO string', () => {
    const d = new Date('2026-01-15T00:01:00.000Z');
    const job = {
      ...baseImportJob,
      createdAt: '2026-01-15T00:00:00.000Z',
      completedAt: d,
    };
    expect(adaptImportJob(job).completedAt).toBe('2026-01-15T00:01:00.000Z');
  });

  it('preserves non-date fields verbatim', () => {
    const job = { ...baseImportJob, createdAt: '2026-01-01T00:00:00.000Z', completedAt: null };
    const result = adaptImportJob(job);
    expect(result.id).toBe('job-1');
    expect(result.sourceSlug).toBe('test-shape');
    expect(result.memoriesImported).toBe(5);
  });
});

describe('adaptExportJob', () => {
  const baseExportJob = {
    id: 'exp-1',
    sourceSlug: 'test-shape',
    status: 'completed',
    format: 'json',
    fileName: 'test.json',
    fileSizeBytes: 1024,
    errorMessage: null,
    downloadUrl: 'https://example.com/exp-1',
  };

  it('normalizes string fields verbatim and Date expiresAt to ISO string', () => {
    const expires = new Date('2026-02-17T00:00:00.000Z');
    const job = {
      ...baseExportJob,
      createdAt: '2026-02-16T00:00:00.000Z',
      completedAt: '2026-02-16T00:05:00.000Z',
      expiresAt: expires,
    };
    const result = adaptExportJob(job);
    expect(result.createdAt).toBe('2026-02-16T00:00:00.000Z');
    expect(result.completedAt).toBe('2026-02-16T00:05:00.000Z');
    expect(result.expiresAt).toBe('2026-02-17T00:00:00.000Z');
  });

  it('preserves null completedAt while still normalizing expiresAt', () => {
    const job = {
      ...baseExportJob,
      createdAt: new Date('2026-02-16T00:00:00.000Z'),
      completedAt: null,
      expiresAt: '2026-02-17T00:00:00.000Z',
    };
    const result = adaptExportJob(job);
    expect(result.completedAt).toBeNull();
    expect(result.expiresAt).toBe('2026-02-17T00:00:00.000Z');
    expect(result.createdAt).toBe('2026-02-16T00:00:00.000Z');
  });
});

describe('formatImportJobStatus', () => {
  function makeImportJob(overrides: Partial<ImportJob> = {}): ImportJob {
    return {
      id: 'job-1',
      sourceSlug: 'test-shape',
      status: 'completed',
      importType: 'full',
      memoriesImported: 42,
      memoriesFailed: 0,
      createdAt: '2026-01-15T00:00:00.000Z',
      completedAt: '2026-01-15T00:01:00.000Z',
      errorMessage: null,
      importMetadata: null,
      ...overrides,
    };
  }

  it('should format completed import with memory count', () => {
    const result = formatImportJobStatus(makeImportJob());
    expect(result).toContain('test-shape');
    expect(result).toContain('42 imported');
    expect(result).toContain(STATUS_EMOJI['completed']);
  });

  it('should show progress for in_progress import', () => {
    const result = formatImportJobStatus(
      makeImportJob({
        status: 'in_progress',
        memoriesImported: null,
        completedAt: null,
        importMetadata: { progress: { imported: 10, failed: 0, total: 50 } },
      })
    );
    expect(result).toContain('10/50');
    expect(result).toContain('20%');
  });

  it('should show error message for failed imports', () => {
    const result = formatImportJobStatus(
      makeImportJob({
        status: 'failed',
        memoriesImported: null,
        completedAt: null,
        errorMessage: 'Connection refused',
      })
    );
    expect(result).toContain('Connection refused');
    expect(result).toContain(STATUS_EMOJI['failed']);
  });

  it('should truncate long error messages', () => {
    const longError = 'A'.repeat(100);
    const result = formatImportJobStatus(
      makeImportJob({
        status: 'failed',
        memoriesImported: null,
        completedAt: null,
        errorMessage: longError,
      })
    );
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(200);
  });

  it('should show failed memory count when present', () => {
    const result = formatImportJobStatus(makeImportJob({ memoriesFailed: 3 }));
    expect(result).toContain('3 failed');
  });
});

describe('formatExportJobStatus', () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-16T12:00:00Z').getTime());
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  function makeExportJob(overrides: Partial<ExportJob> = {}): ExportJob {
    return {
      id: 'export-1',
      sourceSlug: 'test-shape',
      status: 'completed',
      format: 'json',
      fileName: 'test-shape.json',
      fileSizeBytes: 1048576,
      createdAt: '2026-02-16T00:00:00.000Z',
      completedAt: '2026-02-16T00:05:00.000Z',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      errorMessage: null,
      downloadUrl: 'https://example.com/download/export-1',
      ...overrides,
    };
  }

  it('should format completed export with download link', () => {
    const result = formatExportJobStatus(makeExportJob());
    expect(result).toContain('Download');
    expect(result).toContain('1.0MB');
    expect(result).toContain('expires <t:'); // <t:R> self-updating relative timestamp
  });

  it('should format failed export with error', () => {
    const result = formatExportJobStatus(
      makeExportJob({
        status: 'failed',
        downloadUrl: null,
        errorMessage: 'Timeout',
      })
    );
    expect(result).toContain('Timeout');
    expect(result).toContain(STATUS_EMOJI['failed']);
  });
});

describe('formatCompactImportStatus', () => {
  function makeImportJob(overrides: Partial<ImportJob> = {}): ImportJob {
    return {
      id: 'job-1',
      sourceSlug: 'test-shape',
      status: 'completed',
      importType: 'full',
      memoriesImported: 42,
      memoriesFailed: 0,
      createdAt: '2026-01-15T00:00:00.000Z',
      completedAt: '2026-01-15T00:01:00.000Z',
      errorMessage: null,
      importMetadata: null,
      ...overrides,
    };
  }

  it('should format completed import compactly', () => {
    const result = formatCompactImportStatus(makeImportJob());
    expect(result).toContain('42 memories imported');
    expect(result).not.toContain('test-shape'); // compact = no slug
  });

  it('should show import type', () => {
    const result = formatCompactImportStatus(makeImportJob({ importType: 'memory_only' }));
    expect(result).toContain('memory_only');
  });

  it('should show progress for in_progress', () => {
    const result = formatCompactImportStatus(
      makeImportJob({
        status: 'in_progress',
        memoriesImported: null,
        completedAt: null,
        importMetadata: { progress: { imported: 5, failed: 0, total: 20 } },
      })
    );
    expect(result).toContain('5/20');
    expect(result).toContain('25%');
  });
});

describe('formatCompactExportStatus', () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-16T12:00:00Z').getTime());
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  function makeExportJob(overrides: Partial<ExportJob> = {}): ExportJob {
    return {
      id: 'export-1',
      sourceSlug: 'test-shape',
      status: 'completed',
      format: 'json',
      fileName: 'test-shape.json',
      fileSizeBytes: 2048,
      createdAt: '2026-02-16T00:00:00.000Z',
      completedAt: '2026-02-16T00:05:00.000Z',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      errorMessage: null,
      downloadUrl: 'https://example.com/download/export-1',
      ...overrides,
    };
  }

  it('should format completed export compactly', () => {
    const result = formatCompactExportStatus(makeExportJob());
    expect(result).toContain('Download');
    expect(result).toContain('2.0KB');
    expect(result).not.toContain('test-shape'); // compact = no slug
  });

  it('should show format type', () => {
    const result = formatCompactExportStatus(makeExportJob({ format: 'markdown' }));
    expect(result).toContain('markdown');
  });
});
