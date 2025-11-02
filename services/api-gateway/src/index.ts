/**
 * API Gateway - Main Entry Point
 *
 * Express server that receives HTTP requests and creates BullMQ jobs
 * for the AI worker service to process.
 *
 * Architecture:
 * 1. Receives POST /ai/generate requests from bot-client
 * 2. Validates request and checks for duplicates
 * 3. Creates BullMQ job in Redis queue
 * 4. Returns job ID to caller
 * 5. AI worker service processes job asynchronously
 */

import express from 'express';
import { createLogger, getConfig } from '@tzurot/common-types';
import { createRequire } from 'module';
import { aiRouter } from './routes/ai.js';
import { adminRouter } from './routes/admin.js';
import { access, readdir, mkdir } from 'fs/promises';

// Import pino-http (CommonJS) via require
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http');
import { aiQueue, checkQueueHealth, closeQueue } from './queue.js';
import { startCleanup, stopCleanup, getCacheSize } from './utils/requestDeduplication.js';
import { syncAvatars } from './migrations/sync-avatars.js';
import type { HealthResponse } from './types.js';
import { ErrorResponses } from './utils/errorResponses.js';

const logger = createLogger('api-gateway');
const envConfig = getConfig();

// Configuration from environment
const config = {
  port: envConfig.API_GATEWAY_PORT,
  env: envConfig.NODE_ENV,
  corsOrigins: envConfig.CORS_ORIGINS
};

// Track startup time for uptime calculation
const startTime = Date.now();

// Create Express app
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' })); // Support large message payloads

// HTTP request logging with pino-http
app.use(pinoHttp({ logger }));

// CORS headers (simple implementation for now)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin !== undefined && config.corsOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (origin !== undefined && config.corsOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Routes
app.use('/ai', aiRouter);
app.use('/admin', adminRouter);

// Serve personality avatars with DB fallback
// Avatars are primarily served from filesystem (/data/avatars)
// If not found on filesystem, fall back to database and cache to filesystem
app.get('/avatars/:slug.png', async (req, res) => {
  const slug = req.params.slug;
  const avatarPath = `/data/avatars/${slug}.png`;

  try {
    // Try to serve from filesystem first
    await access(avatarPath);
    res.sendFile(avatarPath, {
      maxAge: '7d', // Cache for 7 days
      etag: true,
      lastModified: true
    });
  } catch {
    // File not found on filesystem, check database
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const personality = await prisma.personality.findUnique({
        where: { slug },
        select: { avatarData: true }
      });

      await prisma.$disconnect();

      if (!personality || !personality.avatarData) {
        // Not in DB either, return 404
        const errorResponse = ErrorResponses.notFound(`Avatar for personality '${slug}'`);
        res.status(404).json(errorResponse);
        return;
      }

      // avatarData is already raw bytes (Buffer)
      const buffer = Buffer.from(personality.avatarData);

      // Cache to filesystem for future requests
      const { writeFile } = await import('fs/promises');
      await writeFile(avatarPath, buffer);
      logger.info(`[Gateway] Cached avatar from DB to filesystem: ${slug}`);

      // Serve the image
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'max-age=604800'); // 7 days
      res.send(buffer);

    } catch (error) {
      logger.error({ err: error, slug }, '[Gateway] Error serving avatar');
      const errorResponse = ErrorResponses.internalError('Failed to retrieve avatar');
      res.status(500).json(errorResponse);
    }
  }
});

// Serve temporary attachments from Railway volume
// Attachments are downloaded when requests are received and cleaned up after processing
app.use('/temp-attachments', express.static('/data/temp-attachments', {
  maxAge: 0, // Don't cache (temporary files)
  etag: false,
  lastModified: false,
  fallthrough: false, // Return 404 if file not found
}));

/**
 * Ensure avatar storage directory exists
 */
async function ensureAvatarDirectory(): Promise<void> {
  try {
    await access('/data/avatars');
    logger.info('[Gateway] Avatar storage directory exists');
  } catch (error) {
    // Directory doesn't exist, create it
    try {
      await mkdir('/data/avatars', { recursive: true });
      logger.info('[Gateway] Created avatar storage directory at /data/avatars');
    } catch (createError) {
      logger.error({ err: createError }, '[Gateway] Failed to create avatar storage directory');
      throw createError;
    }
  }
}

/**
 * Ensure temp attachment storage directory exists
 */
async function ensureTempAttachmentDirectory(): Promise<void> {
  try {
    await access('/data/temp-attachments');
    logger.info('[Gateway] Temp attachment storage directory exists');
  } catch (error) {
    // Directory doesn't exist, create it
    try {
      await mkdir('/data/temp-attachments', { recursive: true });
      logger.info('[Gateway] Created temp attachment storage directory');
    } catch (createError) {
      logger.error({ err: createError }, '[Gateway] Failed to create temp attachment directory');
      throw createError;
    }
  }
}

/**
 * Check avatar storage health
 */
async function checkAvatarStorage(): Promise<{ status: string; count?: number; error?: string }> {
  try {
    await access('/data/avatars');
    const files = await readdir('/data/avatars');
    return { status: 'ok', count: files.length };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Avatar storage not accessible'
    };
  }
}

/**
 * GET /health - Health check endpoint
 */
app.get('/health', async (_req, res) => {
  try {
    const queueHealthy = await checkQueueHealth();
    const avatarStorage = await checkAvatarStorage();

    const health: HealthResponse = {
      status: queueHealthy ? 'healthy' : 'degraded',
      services: {
        redis: queueHealthy,
        queue: queueHealthy,
        avatarStorage: avatarStorage.status === 'ok'
      },
      avatars: avatarStorage,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - startTime
    };

    const statusCode = queueHealthy ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    logger.error({ err: error }, '[Health] Health check failed');

    const health: HealthResponse = {
      status: 'unhealthy',
      services: {
        redis: false,
        queue: false
      },
      timestamp: new Date().toISOString(),
      uptime: Date.now() - startTime
    };

    res.status(503).json(health);
  }
});

/**
 * GET /metrics - Simple metrics endpoint
 */
app.get('/metrics', async (_req, res) => {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      aiQueue.getWaitingCount(),
      aiQueue.getActiveCount(),
      aiQueue.getCompletedCount(),
      aiQueue.getFailedCount()
    ]);

    res.json({
      queue: {
        waiting,
        active,
        completed,
        failed,
        total: waiting + active
      },
      cache: {
        size: getCacheSize()
      },
      uptime: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error({ err: error }, '[Metrics] Failed to get metrics');

    const errorResponse = ErrorResponses.metricsError(
      error instanceof Error ? error.message : 'Unknown error'
    );

    res.status(500).json(errorResponse);
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  const errorResponse = ErrorResponses.notFound(`Route ${req.method} ${req.path}`);
  res.status(404).json(errorResponse);
});

/**
 * Error handler
 */
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, '[Server] Unhandled error:');

  const errorResponse = ErrorResponses.internalError(
    config.env === 'production' ? 'Internal server error' : err.message
  );

  res.status(500).json(errorResponse);
});

/**
 * Start the server
 */
async function main(): Promise<void> {
  logger.info('[Gateway] Starting API Gateway service...');
  logger.info({
    port: config.port,
    env: config.env,
    corsOrigins: config.corsOrigins
  }, '[Gateway] Configuration:');

  // Ensure avatar storage directory exists
  await ensureAvatarDirectory();

  // Ensure temp attachment storage directory exists
  await ensureTempAttachmentDirectory();

  // Sync avatars from database to filesystem cache
  await syncAvatars();

  // Start request deduplication cleanup
  startCleanup();
  logger.info('[Gateway] Request deduplication started');

  // Start HTTP server
  const server = app.listen(config.port, (err?: Error) => {
    if (err) {
      logger.error({ err }, '[Gateway] Failed to start server');
      process.exit(1);
    }
    logger.info(`[Gateway] Server listening on port ${config.port}`);
    logger.info(`[Gateway] Health check: http://localhost:${config.port}/health`);
    logger.info(`[Gateway] Metrics: http://localhost:${config.port}/metrics`);
  });

  // Handle server errors
  server.on('error', (err: Error) => {
    logger.error({ err }, '[Gateway] Server error');
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[Gateway] Shutting down gracefully...');

    // Stop accepting new connections
    server.close(() => {
      logger.info('[Gateway] HTTP server closed');
    });

    // Stop cleanup interval
    stopCleanup();

    // Close queue connections
    await closeQueue();

    logger.info('[Gateway] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });

  process.on('SIGINT', () => {
    void shutdown();
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, '[Gateway] Uncaught exception:');
    void shutdown();
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, '[Gateway] Unhandled rejection:');
    void shutdown();
  });

  logger.info('[Gateway] API Gateway is fully operational! 🚀');
}

// Start the server
main().catch((error: unknown) => {
  logger.fatal({ err: error }, '[Gateway] Fatal error during startup:');
  process.exit(1);
});
