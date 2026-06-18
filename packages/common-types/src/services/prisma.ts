/**
 * Prisma Client Service
 * Provides a singleton Prisma client for database access across services
 *
 * Prisma 7.0 uses driver adapters for database connections.
 * The PrismaClient is generated to packages/common-types/src/generated/prisma/
 */

import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../config/config.js';
import {
  resolvePoolMax,
  resolveConnectionTimeoutMs,
  resolvePoolStatsIntervalMs,
  startPoolStatsGauge,
} from './poolConfig.js';

const logger = createLogger('PrismaService');
const config = getConfig();

let prismaClient: PrismaClient | null = null;
let stopPoolStatsGauge: (() => void) | null = null;

/**
 * Get or create the Prisma client singleton
 * Uses the Prisma 7.0 driver adapter pattern with @prisma/adapter-pg
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    // Debug: Check DATABASE_URL at runtime
    const dbUrl = process.env.DATABASE_URL;
    logger.info(
      {
        set: dbUrl !== null && dbUrl !== undefined && dbUrl.length > 0,
        prefix:
          dbUrl !== null && dbUrl !== undefined && dbUrl.length > 0 ? dbUrl.substring(0, 15) : null,
      },
      'DATABASE_URL check'
    );

    // Prisma 7.0 driver adapter over an EXPLICIT pg.Pool. The adapter ignores
    // `?connection_limit=` on DATABASE_URL, so the pool MUST be sized here —
    // otherwise it silently uses pg's defaults (max=10, wait-forever acquisition)
    // and starves under load. See poolConfig.ts for the full rationale.
    const max = resolvePoolMax();
    const connectionTimeoutMillis = resolveConnectionTimeoutMs();
    const pool = new Pool({ connectionString: dbUrl, max, connectionTimeoutMillis });
    pool.on('error', err => {
      logger.error({ err }, 'pg.Pool idle-client error');
    });
    stopPoolStatsGauge = startPoolStatsGauge(pool, logger, resolvePoolStatsIntervalMs(), max);

    // disposeExternalPool: true so prismaClient.$disconnect() closes the pool we
    // created (external pools are otherwise left open on disconnect).
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });

    prismaClient = new PrismaClient({
      adapter,
      log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    logger.info(
      { max, connectionTimeoutMillis },
      'Prisma client initialized with configured pg.Pool'
    );
  }

  return prismaClient;
}

/**
 * Disconnect the Prisma client (for graceful shutdown)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    // Stop the gauge before disconnecting so a reconnect doesn't leave a stale
    // interval polling the now-closed pool alongside the new one.
    stopPoolStatsGauge?.();
    stopPoolStatsGauge = null;
    await prismaClient.$disconnect();
    prismaClient = null;
    logger.info('Prisma client disconnected');
  }
}

// Re-export PrismaClient class and Prisma namespace for use by other services
// The PrismaClient is exported as both a value (class) and type
export { PrismaClient, Prisma } from '../generated/prisma/client.js';

// Explicitly re-export Null types from runtime library to fix TypeScript type inference
// issues with pnpm workspaces (TS2742 errors about non-portable type references)
