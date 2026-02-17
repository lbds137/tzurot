/**
 * Tests for Public Export Download Route
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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
import type { PrismaClient } from '@tzurot/common-types';

const VALID_UUID = '12345678-1234-1234-1234-123456789012';
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

  it('should return 400 for invalid UUID format', async () => {
    const app = createApp();
    const res = await request(app).get('/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid export job ID');
  });

  it('should return 404 when export not found', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue(null);
    const app = createApp();
    const res = await request(app).get(`/${VALID_UUID}`);

    expect(res.status).toBe(404);
  });

  it('should return 404 when export is pending', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'pending',
      fileContent: null,
      fileName: null,
      fileSizeBytes: null,
      format: 'json',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_UUID}`);

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('pending');
  });

  it('should return 410 when export has expired', async () => {
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'completed',
      fileContent: '{"data": true}',
      fileName: 'test-export.json',
      fileSizeBytes: 14,
      format: 'json',
      expiresAt: PAST_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_UUID}`);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Export has expired');
  });

  it('should serve JSON export with correct headers', async () => {
    const content = JSON.stringify({ test: true });
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'completed',
      fileContent: content,
      fileName: 'test-export.json',
      fileSizeBytes: Buffer.byteLength(content),
      format: 'json',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBe('attachment; filename="test-export.json"');
    expect(res.text).toBe(content);
  });

  it('should serve markdown export with correct content type', async () => {
    const content = '# Export\n\nHello';
    mockPrisma.exportJob.findUnique.mockResolvedValue({
      status: 'completed',
      fileContent: content,
      fileName: 'test-export.md',
      fileSizeBytes: Buffer.byteLength(content),
      format: 'markdown',
      expiresAt: FUTURE_DATE,
    });

    const app = createApp();
    const res = await request(app).get(`/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toBe(content);
  });
});
