/**
 * Prisma Client Service
 * Provides a singleton Prisma client for database access across services
 *
 * Prisma 7.0 uses driver adapters for database connections.
 * The PrismaClient is generated to packages/common-types/src/generated/prisma/
 */

import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../config/config.js';

const logger = createLogger('PrismaService');
const config = getConfig();

let prismaClient: PrismaClient | null = null;

/**
 * Get or create the Prisma client singleton
 * Uses the Prisma 7.0 driver adapter pattern with @prisma/adapter-pg
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    // Debug: Check DATABASE_URL at runtime
    const dbUrl = process.env.DATABASE_URL;
    logger.info(
      `DATABASE_URL check: ${dbUrl !== null && dbUrl !== undefined && dbUrl.length > 0 ? `set (starts with: ${dbUrl.substring(0, 15)}...)` : 'NOT SET'}`
    );

    // Prisma 7.0: Use driver adapter for PostgreSQL
    const adapter = new PrismaPg({ connectionString: dbUrl });

    prismaClient = new PrismaClient({
      adapter,
      log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    logger.info('Prisma client initialized with PrismaPg adapter');
  }

  return prismaClient;
}

/**
 * Disconnect the Prisma client (for graceful shutdown)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
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
