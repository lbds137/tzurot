/**
 * Database Sync Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createDbSyncRoute } from './dbSync.js';
import type { RouteDeps } from '../routeDeps.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

// Mock DatabaseSyncService
const mockSync = vi.fn();
vi.mock('../../services/DatabaseSyncService.js', () => ({
  DatabaseSyncService: class {
    sync = mockSync;
  },
}));

// Mock PrismaClient and getConfig
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      ...actual.getConfig(),
      DEV_DATABASE_URL: 'postgresql://dev-url',
      PROD_DATABASE_URL: 'postgresql://prod-url',
    }),
  };
});

vi.mock('@tzurot/common-types/services/prisma', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/services/prisma')>(
    '@tzurot/common-types/services/prisma'
  );
  return {
    ...actual,
    PrismaClient: class MockPrismaClient {
      $connect = vi.fn().mockResolvedValue(undefined);
      $disconnect = vi.fn().mockResolvedValue(undefined);
    },
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

    // Create Express app with db-sync router. dbSync doesn't actually
    // use deps.prisma at runtime (it constructs its own clients from
    // env-var URLs), so a minimal cast satisfies the type contract.
    const deps = { prisma: {} as PrismaClient, ...stubRouteResolvers() } satisfies RouteDeps;
    app = express();
    app.use(express.json());
    app.use('/admin/db-sync', createDbSyncRoute(deps));
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
    expect(mockSync).toHaveBeenCalledWith({ dryRun: false, allowSchemaSkew: false });
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
    expect(mockSync).toHaveBeenCalledWith({ dryRun: true, allowSchemaSkew: false });
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
    expect(mockSync).toHaveBeenCalledWith({ dryRun: false, allowSchemaSkew: false });
  });

  it('should handle sync errors gracefully', async () => {
    mockSync.mockRejectedValue(new Error('Connection refused'));

    const response = await request(app).post('/admin/db-sync').send({ dryRun: false });

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });
});
