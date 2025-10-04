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
import { createLogger } from '@tzurot/common-types';
import { createRequire } from 'module';
import { aiRouter } from './routes/ai.js';

// Import pino-http (CommonJS) via require
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http');
import { aiQueue, checkQueueHealth, closeQueue } from './queue.js';
import { startCleanup, stopCleanup, getCacheSize } from './utils/requestDeduplication.js';
import type { HealthResponse, ErrorResponse } from './types.js';

const logger = createLogger('api-gateway');

// Configuration from environment
const config = {
  port: parseInt(process.env.PORT ?? '3000'),
  env: process.env.NODE_ENV ?? 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? ['*']
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

/**
 * GET /health - Health check endpoint
 */
app.get('/health', async (_req, res) => {
  try {
    const queueHealthy = await checkQueueHealth();

    const health: HealthResponse = {
      status: queueHealthy ? 'healthy' : 'degraded',
      services: {
        redis: queueHealthy,
        queue: queueHealthy
      },
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

    const errorResponse: ErrorResponse = {
      error: 'METRICS_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    };

    res.status(500).json(errorResponse);
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  const errorResponse: ErrorResponse = {
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString()
  };

  res.status(404).json(errorResponse);
});

/**
 * Error handler
 */
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('[Server] Unhandled error:', err);

  const errorResponse: ErrorResponse = {
    error: 'INTERNAL_ERROR',
    message: config.env === 'production' ? 'Internal server error' : err.message,
    timestamp: new Date().toISOString()
  };

  res.status(500).json(errorResponse);
});

/**
 * Start the server
 */
async function main(): Promise<void> {
  logger.info('[Gateway] Starting API Gateway service...');
  logger.info('[Gateway] Configuration:', {
    port: config.port,
    env: config.env,
    corsOrigins: config.corsOrigins
  });

  // Start request deduplication cleanup
  startCleanup();
  logger.info('[Gateway] Request deduplication started');

  // Start HTTP server
  const server = app.listen(config.port, () => {
    logger.info(`[Gateway] Server listening on port ${config.port}`);
    logger.info(`[Gateway] Health check: http://localhost:${config.port}/health`);
    logger.info(`[Gateway] Metrics: http://localhost:${config.port}/metrics`);
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
    logger.fatal('[Gateway] Uncaught exception:', error);
    void shutdown();
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal('[Gateway] Unhandled rejection:', reason);
    void shutdown();
  });

  logger.info('[Gateway] API Gateway is fully operational! 🚀');
}

// Start the server
main().catch((error: unknown) => {
  logger.fatal('[Gateway] Fatal error during startup:', error);
  process.exit(1);
});
