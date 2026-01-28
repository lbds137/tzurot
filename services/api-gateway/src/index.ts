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

import express, { type Express } from 'express';
import { Redis } from 'ioredis';
import { createRequire } from 'module';
import {
  createLogger,
  getConfig,
  getPrismaClient,
  PersonalityService,
  CacheInvalidationService,
  ApiKeyCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  ConversationRetentionService,
  type PrismaClient,
} from '@tzurot/common-types';

// Routes
import { createAIRouter } from './routes/ai/index.js';
import { createAdminRouter } from './routes/admin/index.js';
import { createWalletRouter } from './routes/wallet/index.js';
import { createUserRouter } from './routes/user/index.js';
import { createModelsRouter } from './routes/models/index.js';
import {
  createHealthRouter,
  createMetricsRouter,
  createAvatarRouter,
} from './routes/public/index.js';

// Middleware
import { createCorsMiddleware, notFoundHandler, globalErrorHandler } from './middleware/index.js';

// Services
import { DatabaseNotificationListener } from './services/DatabaseNotificationListener.js';
import { OpenRouterModelCache } from './services/OpenRouterModelCache.js';
import { requireServiceAuth } from './services/AuthMiddleware.js';
import { AttachmentStorageService } from './services/AttachmentStorageService.js';
import {
  initializeEmbeddingService,
  shutdownEmbeddingService,
} from './services/EmbeddingService.js';

// Bootstrap
import {
  validateByokConfiguration,
  ensureAvatarDirectory,
  ensureTempAttachmentDirectory,
  validateRequiredEnvVars,
  validateServiceAuthConfig,
} from './bootstrap/index.js';

// Queue
import { aiQueue, queueEvents, closeQueue } from './queue.js';
import {
  initializeDeduplicationCache,
  disposeDeduplicationCache,
} from './utils/deduplicationCache.js';
import { syncAvatars } from './migrations/sync-avatars.js';

// Import pino-http (CommonJS) via require
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- pino-http is CommonJS-only and lacks ESM type definitions. require() returns 'any' type unavoidably.
const pinoHttp = require('pino-http');

const logger = createLogger('api-gateway');
const envConfig = getConfig();

// Track startup time for uptime calculation
const startTime = Date.now();

// ============================================================================
// TYPES
// ============================================================================

/** Result of services initialization */
interface ServicesContext {
  cacheRedis: Redis;
  personalityService: PersonalityService;
  retentionService: ConversationRetentionService;
  cacheInvalidationService: CacheInvalidationService;
  apiKeyCacheInvalidation: ApiKeyCacheInvalidationService;
  llmConfigCacheInvalidation: LlmConfigCacheInvalidationService;
  attachmentStorage: AttachmentStorageService;
  modelCache: OpenRouterModelCache;
  dbNotificationListener: DatabaseNotificationListener;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initialize all services required by the gateway
 */
async function initializeServices(prisma: PrismaClient): Promise<ServicesContext> {
  // REDIS_URL is validated in startup.ts, but TypeScript doesn't know that
  if (envConfig.REDIS_URL === undefined) {
    throw new Error('REDIS_URL is required but was not provided');
  }
  const cacheRedis = new Redis(envConfig.REDIS_URL);
  cacheRedis.on('error', err => {
    logger.error({ err }, '[Gateway] Cache Redis connection error');
  });
  logger.info('[Gateway] Redis client initialized for cache invalidation');

  // Initialize deduplication cache with Redis (enables horizontal scaling)
  initializeDeduplicationCache(cacheRedis);
  logger.info('[Gateway] Request deduplication cache initialized with Redis');

  const personalityService = new PersonalityService(prisma);
  const retentionService = new ConversationRetentionService(prisma);
  const cacheInvalidationService = new CacheInvalidationService(cacheRedis, personalityService);
  await cacheInvalidationService.subscribe();
  logger.info('[Gateway] Subscribed to personality cache invalidation events');

  const apiKeyCacheInvalidation = new ApiKeyCacheInvalidationService(cacheRedis);
  logger.info('[Gateway] API key cache invalidation service initialized');

  const llmConfigCacheInvalidation = new LlmConfigCacheInvalidationService(cacheRedis);
  logger.info('[Gateway] LLM config cache invalidation service initialized');

  const attachmentStorage = new AttachmentStorageService({
    gatewayUrl: envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL,
  });

  const modelCache = new OpenRouterModelCache(cacheRedis);

  // Initialize local embedding service for memory search
  const embeddingReady = await initializeEmbeddingService();
  if (embeddingReady) {
    logger.info('[Gateway] Local embedding service initialized');
  } else {
    logger.warn(
      {},
      '[Gateway] Local embedding service unavailable - memory search will use text fallback'
    );
  }

  // DATABASE_URL is validated in startup.ts, but TypeScript doesn't know that
  if (envConfig.DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL is required but was not provided');
  }
  const dbNotificationListener = new DatabaseNotificationListener(
    envConfig.DATABASE_URL,
    cacheInvalidationService
  );
  await dbNotificationListener.start();
  logger.info('[Gateway] Listening for database change notifications');

  return {
    cacheRedis,
    personalityService,
    retentionService,
    cacheInvalidationService,
    apiKeyCacheInvalidation,
    llmConfigCacheInvalidation,
    attachmentStorage,
    modelCache,
    dbNotificationListener,
  };
}

/**
 * Register all routes on the Express app
 */
function registerRoutes(app: Express, prisma: PrismaClient, services: ServicesContext): void {
  const {
    cacheRedis,
    retentionService,
    cacheInvalidationService,
    apiKeyCacheInvalidation,
    llmConfigCacheInvalidation,
    attachmentStorage,
    modelCache,
  } = services;

  // PUBLIC ROUTES (no authentication required)
  app.use('/health', createHealthRouter(startTime));
  app.use('/metrics', createMetricsRouter(aiQueue, startTime));
  app.use('/avatars', createAvatarRouter(prisma));

  // Serve temporary attachments from Railway volume
  app.use(
    '/temp-attachments',
    express.static('/data/temp-attachments', {
      maxAge: 0,
      etag: false,
      lastModified: false,
      fallthrough: false,
    })
  );

  // PROTECTED ROUTES (require service authentication)
  validateServiceAuthConfig();
  app.use(requireServiceAuth());
  logger.info('[Gateway] Service authentication middleware applied globally');

  app.use('/ai', createAIRouter(prisma, aiQueue, queueEvents, attachmentStorage));
  logger.info('[Gateway] AI routes registered');

  app.use('/wallet', createWalletRouter(prisma, cacheRedis, apiKeyCacheInvalidation));
  logger.info('[Gateway] Wallet routes registered (Redis rate limiting)');

  app.use(
    '/user',
    createUserRouter(prisma, llmConfigCacheInvalidation, cacheInvalidationService, cacheRedis)
  );
  logger.info('[Gateway] User routes registered (with personality cache invalidation, incognito)');

  app.use('/models', createModelsRouter(modelCache));
  logger.info('[Gateway] Models routes registered');

  app.use(
    '/admin',
    createAdminRouter(
      prisma,
      cacheInvalidationService,
      llmConfigCacheInvalidation,
      retentionService
    )
  );
  logger.info('[Gateway] Admin routes registered');

  // ERROR HANDLERS (must be last)
  app.use(notFoundHandler);
}

/**
 * Create graceful shutdown handler
 */
function createShutdownHandler(
  server: ReturnType<Express['listen']>,
  services: ServicesContext
): () => Promise<void> {
  const { cacheRedis, cacheInvalidationService, dbNotificationListener } = services;

  return async (): Promise<void> => {
    logger.info('[Gateway] Shutting down gracefully...');

    server.close(() => {
      logger.info('[Gateway] HTTP server closed');
    });

    disposeDeduplicationCache();
    logger.info('[Gateway] Request deduplication cache disposed');

    await dbNotificationListener.stop();
    logger.info('[Gateway] Database notification listener stopped');

    await cacheInvalidationService.unsubscribe();
    cacheRedis.disconnect();
    logger.info('[Gateway] Cache invalidation service closed');

    await shutdownEmbeddingService();
    logger.info('[Gateway] Embedding service shut down');

    await closeQueue();

    logger.info('[Gateway] Shutdown complete');
    process.exit(0);
  };
}

// ============================================================================
// MAIN
// ============================================================================

/**
 * Start the server
 */
async function main(): Promise<void> {
  const config = {
    port: envConfig.API_GATEWAY_PORT,
    env: envConfig.NODE_ENV,
    corsOrigins: envConfig.CORS_ORIGINS,
  };

  logger.info('[Gateway] Starting API Gateway service...');
  logger.info(
    { port: config.port, env: config.env, corsOrigins: config.corsOrigins },
    '[Gateway] Configuration:'
  );

  // Startup validation
  validateByokConfiguration();
  validateRequiredEnvVars();
  await ensureAvatarDirectory();
  await ensureTempAttachmentDirectory();
  await syncAvatars();

  // Create Express app with base middleware
  const app = express();
  const prisma = getPrismaClient();
  app.use(express.json({ limit: '10mb' }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- pino-http is imported via CommonJS require() and has 'any' type. Functionally correct, just lacks type definitions.
  app.use(pinoHttp({ logger }));
  app.use(createCorsMiddleware({ origins: config.corsOrigins }));

  // Initialize services and register routes
  const services = await initializeServices(prisma);
  registerRoutes(app, prisma, services);
  app.use(globalErrorHandler(config.env === 'production'));

  // Start server
  const server = app.listen(config.port, (err?: Error) => {
    if (err) {
      logger.error({ err }, '[Gateway] Failed to start server');
      process.exit(1);
    }
    logger.info(`[Gateway] Server listening on port ${config.port}`);
    logger.info(`[Gateway] Health check: http://localhost:${config.port}/health`);
  });

  server.on('error', (err: Error) => {
    logger.error({ err }, '[Gateway] Server error');
  });

  // Setup graceful shutdown
  const shutdown = createShutdownHandler(server, services);
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('uncaughtException', error => {
    logger.fatal({ err: error }, '[Gateway] Uncaught exception:');
    void shutdown();
  });
  process.on('unhandledRejection', reason => {
    logger.fatal({ reason }, '[Gateway] Unhandled rejection:');
    void shutdown();
  });

  logger.info('[Gateway] API Gateway is fully operational!');
}

// Start the server
main().catch((error: unknown) => {
  logger.fatal({ err: error }, '[Gateway] Fatal error during startup:');
  process.exit(1);
});
