/**
 * Database Sync Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createDbSyncRoute } from './dbSync.js';

// Mock DatabaseSyncService
const mockSync = vi.fn();
vi.mock('../../services/DatabaseSyncService.js', () => ({
  DatabaseSyncService: class {
    sync = mockSync;
  },
}));

// Mock PrismaClient
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
  },
}));

// Mock getConfig to return database URLs
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getConfig: () => ({
      ...(actual as any).getConfig(),
      DEV_DATABASE_URL: 'postgresql://dev-url',
      PROD_DATABASE_URL: 'postgresql://prod-url',
    }),
  };
});

// Mock AuthMiddleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (_req: unknown, _res: unknown, next: () => void) => {
    next(); // Bypass auth for testing
  },
}));

describe('POST /admin/db-sync', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create Express app with db-sync router
    app = express();
    app.use(express.json());
    app.use('/admin/db-sync', createDbSyncRoute());
  });

  it('should perform database sync successfully', async () => {
    mockSync.mockResolvedValue({
      totalTables: 3,
      tablesProcessed: 3,
      totalRowsSynced: 150,
      changes: [
        { table: 'personalities', inserted: 5, updated: 10, deleted: 0 },
        { table: 'llm_configs', inserted: 2, updated: 1, deleted: 0 },
      ],
    });

    const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.totalTables).toBe(3);
    expect(response.body.totalRowsSynced).toBe(150);
    expect(mockSync).toHaveBeenCalledWith({ dryRun: false });
  });

  it('should perform dry run when requested', async () => {
    mockSync.mockResolvedValue({
      totalTables: 3,
      tablesProcessed: 3,
      totalRowsSynced: 0,
      changes: [],
      dryRun: true,
    });

    const response = await request(app).post('/admin/db-sync').send({ dryRun: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.dryRun).toBe(true);
    expect(mockSync).toHaveBeenCalledWith({ dryRun: true });
  });

  it('should default to dryRun false when not specified', async () => {
    mockSync.mockResolvedValue({
      totalTables: 0,
      tablesProcessed: 0,
      totalRowsSynced: 0,
      changes: [],
    });

    const response = await request(app).post('/admin/db-sync').send({});

    expect(response.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith({ dryRun: false });
  });

  it('should handle sync errors gracefully', async () => {
    mockSync.mockRejectedValue(new Error('Connection refused'));

    const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });
});
