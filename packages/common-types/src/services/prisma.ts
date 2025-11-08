/**
 * Prisma Client Service
 * Provides a singleton Prisma client for database access across services
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../config/config.js';

const logger = createLogger('PrismaService');
const config = getConfig();

let prismaClient: PrismaClient | null = null;

/**
 * Get or create the Prisma client singleton
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    // Debug: Check DATABASE_URL at runtime
    const dbUrl = process.env.DATABASE_URL;
    logger.info(
      `DATABASE_URL check: ${dbUrl ? `set (starts with: ${dbUrl.substring(0, 15)}...)` : 'NOT SET'}`
    );

    prismaClient = new PrismaClient({
      log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    logger.info('Prisma client initialized');
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
