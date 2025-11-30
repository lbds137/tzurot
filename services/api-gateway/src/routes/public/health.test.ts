/**
 * Health Route Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';

// Mock dependencies
vi.mock('../../queue.js', () => ({
  checkQueueHealth: vi.fn(),
}));

vi.mock('../../bootstrap/startup.js', () => ({
  checkAvatarStorage: vi.fn(),
}));

vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  HealthStatus: {
    Ok: 'ok',
    Error: 'error',
    Healthy: 'healthy',
    Degraded: 'degraded',
    Unhealthy: 'unhealthy',
  },
}));

import { checkQueueHealth } from '../../queue.js';
import { checkAvatarStorage } from '../../bootstrap/startup.js';
import { createHealthRouter } from './health.js';
import { HealthStatus } from '@tzurot/common-types';

describe('Health Route', () => {
  let app: express.Express;
  const startTime = Date.now();

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use('/health', createHealthRouter(startTime));
  });

  it('should return healthy status when all services are up', async () => {
    vi.mocked(checkQueueHealth).mockResolvedValue(true);
    vi.mocked(checkAvatarStorage).mockResolvedValue({ status: HealthStatus.Ok, count: 10 });

    const response = await request(app).get('/health');

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.body.status).toBe('healthy');
    expect(response.body.services.redis).toBe(true);
    expect(response.body.services.queue).toBe(true);
    expect(response.body.services.avatarStorage).toBe(true);
    expect(response.body.avatars.count).toBe(10);
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should return degraded status when queue is unhealthy', async () => {
    vi.mocked(checkQueueHealth).mockResolvedValue(false);
    vi.mocked(checkAvatarStorage).mockResolvedValue({ status: HealthStatus.Ok, count: 5 });

    const response = await request(app).get('/health');

    expect(response.status).toBe(StatusCodes.SERVICE_UNAVAILABLE);
    expect(response.body.status).toBe('degraded');
    expect(response.body.services.redis).toBe(false);
    expect(response.body.services.queue).toBe(false);
  });

  it('should return avatar storage error status', async () => {
    vi.mocked(checkQueueHealth).mockResolvedValue(true);
    vi.mocked(checkAvatarStorage).mockResolvedValue({
      status: HealthStatus.Error,
      error: 'Directory not accessible',
    });

    const response = await request(app).get('/health');

    expect(response.status).toBe(StatusCodes.OK);
    expect(response.body.services.avatarStorage).toBe(false);
    expect(response.body.avatars.error).toBe('Directory not accessible');
  });

  it('should return unhealthy status when health check throws', async () => {
    vi.mocked(checkQueueHealth).mockRejectedValue(new Error('Connection failed'));
    vi.mocked(checkAvatarStorage).mockResolvedValue({ status: HealthStatus.Ok, count: 0 });

    const response = await request(app).get('/health');

    expect(response.status).toBe(StatusCodes.SERVICE_UNAVAILABLE);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.services.redis).toBe(false);
    expect(response.body.services.queue).toBe(false);
  });
});
