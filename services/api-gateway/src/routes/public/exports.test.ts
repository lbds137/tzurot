/**
 * Tests for Public Export Download Route
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { createExportsRouter } from './exports.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const VALID_TOKEN = 'a'.repeat(64); // 64-char lowercase hex — a well-formed download token
/** A deterministic export-job UUID: the shape that must NOT work as a download handle. */
const DETERMINISTIC_JOB_UUID = '12345678-1234-1234-1234-123456789012';
/** Fixed time for deterministic tests */
const NOW = new Date('2026-02-17T00:00:00.000Z').getTime();
const FUTURE_DATE = new Date(NOW + 86400000);
const PAST_DATE = new Date(NOW - 86400000);

const mockPrisma = {
  exportJob: {
    findUnique: vi.fn(),
  },
};

function createApp() {
  const app = express();
  app.use('/', createExportsRouter(mockPrisma as unknown as PrismaClient));
  return app;
}

describe('Public Export Download Route', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 400 for a malformed download token', async () => {
    const app = createApp();
    const res = await request(app).get('/not-a-token');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid export download token');
    expect(mockPrisma.exportJob.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a deterministic export-job UUID as a download handle (the vuln fix)', async () => {
    // The job id is computable offline from a Discord id; it must never be a
    // valid download URL. It fails the token-shape guard before any DB lookup.
    const app = createApp();
    const res = await request(app).get(`/${DETERMINISTIC_JOB_UUID}`);

    expect(res.status).toBe(400);
    expect(mockPrisma.exportJob.findUnique).not.toHaveBeenCalled();
  });

  it('looks the job up by downloadToken, never by id', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue(null);
    const app = createApp();
    await request(app).get(`/${VALID_TOKEN}`);

    expect(mockPrisma.exportJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { downloadToken: VALID_TOKEN } })
    );
  });

  it('should return 404 when export not found', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue(null);
    const app = createApp();
    const res = await request(app).get(`/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
  });

  it('should return 404 when export is pending', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'pending',
      fileContent: null,
      fileData: null,
      fileName: null,
      fileSizeBytes: null,
      format: 'json',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('pending');
  });

  it('should return 404 with error message when export failed', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'failed',
      fileContent: null,
      fileData: null,
      fileName: null,
      fileSizeBytes: null,
      format: 'json',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Export failed');
    expect(res.body.status).toBe('failed');
  });

  it('should return 410 when expired regardless of status', async () => {
    // Even a failed job should return 410 if expired (expiry checked first)
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'failed',
      fileContent: null,
      fileData: null,
      fileName: null,
      fileSizeBytes: null,
      format: 'json',
      expiresAt: PAST_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_TOKEN}`);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Export has expired');
  });

  it('should return 410 when completed export has expired', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'completed',
      fileContent: '{"data": true}',
      fileData: null,
      fileName: 'test-export.json',
      fileSizeBytes: 14,
      format: 'json',
      expiresAt: PAST_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_TOKEN}`);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Export has expired');
  });

  it('should serve JSON export with correct headers', async () => {
    const content = JSON.stringify({ test: true });
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'completed',
      fileContent: content,
      fileData: null,
      fileName: 'test-export.json',
      fileSizeBytes: Buffer.byteLength(content),
      format: 'json',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="test-export.json"; filename*=UTF-8\'\'test-export.json'
    );
    expect(res.text).toBe(content);
  });

  it('should serve markdown export with correct content type', async () => {
    const content = '# Export\n\nHello';
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'completed',
      fileContent: content,
      fileData: null,
      fileName: 'test-export.md',
      fileSizeBytes: Buffer.byteLength(content),
      format: 'markdown',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toBe(content);
  });

  it('should serve ZIP exports from fileData with application/zip', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'completed',
      fileContent: null,
      fileData: bytes,
      fileName: 'tzurot-account-export-alice-2026-07-15.zip',
      fileSizeBytes: bytes.length,
      format: 'zip',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app)
      .get(`/${VALID_TOKEN}`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk as Buffer));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-length']).toBe(String(bytes.length));
    expect(Buffer.from(res.body as Buffer).equals(Buffer.from(bytes))).toBe(true);
  });
});
